import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HEALTH_POLL_MS,
  WAKE_DELAY_MS,
  startServerWakeMonitor,
  type ServerWakeState,
} from './useServerWake';

describe('startServerWakeMonitor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('não avisa antes do atraso e cancelar evita qualquer efeito', async () => {
    const onChange = vi.fn();
    const checkHealth = vi.fn(() => Promise.resolve(false));
    const stop = startServerWakeMonitor({ onChange, checkHealth });

    await vi.advanceTimersByTimeAsync(WAKE_DELAY_MS - 1);
    expect(onChange).not.toHaveBeenCalled();
    stop();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange).not.toHaveBeenCalled();
    expect(checkHealth).not.toHaveBeenCalled();
  });

  it('após ~3 s sinaliza waking, conta segundos e consulta /health a cada 5 s', async () => {
    const states: ServerWakeState[] = [];
    const checkHealth = vi.fn(() => Promise.resolve(false));
    const stop = startServerWakeMonitor({ onChange: (s) => states.push(s), checkHealth });

    await vi.advanceTimersByTimeAsync(WAKE_DELAY_MS);
    expect(states[states.length - 1]).toEqual({ waking: true, seconds: 0 });
    expect(checkHealth).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(states[states.length - 1]).toEqual({ waking: true, seconds: 3 });
    expect(checkHealth).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS - 3000);
    expect(checkHealth).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS);
    expect(checkHealth).toHaveBeenCalledTimes(3);
    stop();
  });

  it('para de consultar quando /health responde ok e avisa onHealthy', async () => {
    const onHealthy = vi.fn();
    const checkHealth = vi
      .fn<(s: AbortSignal) => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('rede'))
      .mockResolvedValueOnce(true);
    const stop = startServerWakeMonitor({ onChange: vi.fn(), onHealthy, checkHealth });

    await vi.advanceTimersByTimeAsync(WAKE_DELAY_MS); // 1ª consulta falha
    expect(onHealthy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS); // 2ª ok
    expect(onHealthy).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HEALTH_POLL_MS * 4);
    expect(checkHealth).toHaveBeenCalledTimes(2);
    stop();
  });

  it('cancelar interrompe contador e consultas e aborta a requisição em andamento', async () => {
    const onChange = vi.fn();
    let signal: AbortSignal | undefined;
    const checkHealth = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<boolean>(() => {}); // nunca responde
    });
    const stop = startServerWakeMonitor({ onChange, checkHealth });

    await vi.advanceTimersByTimeAsync(WAKE_DELAY_MS + 2000);
    const chamadas = onChange.mock.calls.length;
    expect(signal?.aborted).toBe(false);

    stop();
    expect(signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange).toHaveBeenCalledTimes(chamadas);
    expect(checkHealth).toHaveBeenCalledTimes(1);
  });

  it('não empilha consultas enquanto a anterior não terminou', async () => {
    const checkHealth = vi.fn(() => new Promise<boolean>(() => {}));
    const stop = startServerWakeMonitor({ onChange: vi.fn(), checkHealth });

    await vi.advanceTimersByTimeAsync(WAKE_DELAY_MS + HEALTH_POLL_MS * 3);
    expect(checkHealth).toHaveBeenCalledTimes(1);
    stop();
  });
});
