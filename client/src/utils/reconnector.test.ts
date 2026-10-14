import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createReconnector,
  viewerReconnectDelayMs,
  MAX_VIEWER_RECONNECT_ATTEMPTS,
} from './reconnector';

describe('viewerReconnectDelayMs', () => {
  it('backoff 3 s, 6 s, 12 s, 24 s e teto de 30 s', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(viewerReconnectDelayMs)).toEqual([3000, 6000, 12000, 24000, 30000, 30000, 30000]);
  });
});

describe('createReconnector', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reenvia nos tempos do backoff e esgota após 5 tentativas', () => {
    const send = vi.fn();
    const onExhausted = vi.fn();
    const r = createReconnector({ send, onExhausted });
    r.onDisconnect();

    vi.advanceTimersByTime(2999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(6000);
    expect(send).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(12000);
    vi.advanceTimersByTime(24000);
    vi.advanceTimersByTime(30000);
    expect(send).toHaveBeenCalledTimes(MAX_VIEWER_RECONNECT_ATTEMPTS);
    expect(onExhausted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30000);
    expect(onExhausted).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(MAX_VIEWER_RECONNECT_ATTEMPTS);
    vi.advanceTimersByTime(120000);
    expect(onExhausted).toHaveBeenCalledTimes(1);
  });

  it('reset zera o contador e cancela timers', () => {
    const send = vi.fn();
    const r = createReconnector({ send, onExhausted: vi.fn() });
    r.onDisconnect();
    vi.advanceTimersByTime(3000);
    expect(r.attempts).toBe(1);
    r.reset();
    expect(r.attempts).toBe(0);
    vi.advanceTimersByTime(120000);
    expect(send).toHaveBeenCalledTimes(1);
    r.onDisconnect();
    vi.advanceTimersByTime(3000);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('onDisconnect repetido não duplica timers', () => {
    const send = vi.fn();
    const r = createReconnector({ send, onExhausted: vi.fn() });
    r.onDisconnect();
    r.onDisconnect();
    vi.advanceTimersByTime(3000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('onConnect reenvia na hora e cancela o timer pendente', () => {
    const send = vi.fn();
    const r = createReconnector({ send, onExhausted: vi.fn() });
    r.onDisconnect();
    r.onConnect();
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60000);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('cancel limpa o timer', () => {
    const send = vi.fn();
    const onExhausted = vi.fn();
    const r = createReconnector({ send, onExhausted });
    r.onDisconnect();
    r.cancel();
    vi.advanceTimersByTime(300000);
    expect(send).not.toHaveBeenCalled();
    expect(onExhausted).not.toHaveBeenCalled();
  });
});
