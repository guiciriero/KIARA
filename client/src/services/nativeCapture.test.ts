import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NativeCaptureTexture, ScreenShareHostApi } from '@shared/index';
import {
  canUseNativeCapture,
  getCaptureEndReason,
  getCaptureSize,
  startNativeVideoTrack,
  IDLE_REPEAT_MS,
  FIRST_FRAME_TIMEOUT_MS,
  NATIVE_CAPTURE_STORAGE_KEY,
} from './nativeCapture';
import { computeScaleDown } from './webrtcService';

class FakeFrame {
  closed = false;
  constructor(public displayWidth = 2560, public displayHeight = 1440) {}
  clone(): FakeFrame { return new FakeFrame(this.displayWidth, this.displayHeight); }
  close(): void { this.closed = true; }
}

function makeGenerator() {
  const written: FakeFrame[] = [];
  const events: string[] = [];
  const gen = {
    kind: 'video',
    writable: {
      getWriter: () => ({
        write: vi.fn(async (f: FakeFrame) => { written.push(f); }),
        close: vi.fn(async () => undefined),
      }),
    },
    stop: vi.fn(),
    dispatchEvent: (e: Event) => { events.push(e.type); return true; },
  };
  return { gen: gen as unknown as MediaStreamTrack & { writable: WritableStream<VideoFrame> }, written, events };
}

function makeTexture(w = 2560, h = 1440) {
  const frame = new FakeFrame(w, h);
  const tex = { getVideoFrame: vi.fn(() => frame), release: vi.fn() };
  return { tex: tex as unknown as NativeCaptureTexture, frame, raw: tex };
}

function makeHost(overrides: Partial<NonNullable<ScreenShareHostApi['nativeCapture']>> = {}) {
  let onTexture: (t: NativeCaptureTexture) => void = () => undefined;
  let onEnded: (r: string) => void = () => undefined;
  const nativeCapture = {
    isAvailable: vi.fn(async () => true),
    start: vi.fn(async (_o: unknown, t: (x: NativeCaptureTexture) => void, e: (r: string) => void) => { onTexture = t; onEnded = e; }),
    stop: vi.fn(async () => undefined),
    ...overrides,
  };
  const host = { nativeCapture } as unknown as ScreenShareHostApi;
  return { host, nativeCapture, push: (t: NativeCaptureTexture) => onTexture(t), end: (r: string) => onEnded(r) };
}

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
  });
  vi.stubGlobal('MediaStreamTrackGenerator', function Gen() { return undefined; });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('canUseNativeCapture', () => {
  it('false sem host ou sem API nativeCapture', async () => {
    expect(await canUseNativeCapture(undefined, null)).toBe(false);
    expect(await canUseNativeCapture({} as ScreenShareHostApi, null)).toBe(false);
  });

  it('true quando o host informa disponibilidade', async () => {
    expect(await canUseNativeCapture(makeHost().host, null)).toBe(true);
    expect(await canUseNativeCapture(makeHost().host, 'screen:0:0')).toBe(true);
  });

  it('false para janelas (só telas inteiras), indisponível e erro do IPC', async () => {
    expect(await canUseNativeCapture(makeHost().host, 'window:123:0')).toBe(false);
    expect(await canUseNativeCapture(makeHost({ isAvailable: vi.fn(async () => false) }).host, null)).toBe(false);
    expect(await canUseNativeCapture(makeHost({ isAvailable: vi.fn(async () => { throw new Error('x'); }) }).host, null)).toBe(false);
  });

  it('interruptor localStorage desliga a captura nativa', async () => {
    store.set(NATIVE_CAPTURE_STORAGE_KEY, '0');
    expect(await canUseNativeCapture(makeHost().host, null)).toBe(false);
  });

  it('false sem MediaStreamTrackGenerator', async () => {
    vi.stubGlobal('MediaStreamTrackGenerator', undefined);
    expect(await canUseNativeCapture(makeHost().host, null)).toBe(false);
  });
});

describe('startNativeVideoTrack', () => {
  it('resolve no primeiro frame, grava o tamanho real e libera a textura', async () => {
    const { host, nativeCapture, push } = makeHost();
    const { gen, written } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60, sourceId: 'screen:0:0' }, { createGenerator: () => gen });
    await vi.advanceTimersByTimeAsync(0);
    const t = makeTexture();
    push(t.tex);
    const track = await p;
    expect(track).toBe(gen);
    expect(nativeCapture.start).toHaveBeenCalledWith({ fps: 60, sourceId: 'screen:0:0' }, expect.any(Function), expect.any(Function));
    expect(getCaptureSize(track)).toEqual({ width: 2560, height: 1440 });
    expect(t.raw.release).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toHaveLength(1);
  });

  it('rejeita e para o addon se nenhum frame chegar a tempo (fallback)', async () => {
    const { host, nativeCapture } = makeHost();
    const { gen } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    const assertion = expect(p).rejects.toThrow(/não entregou frames/);
    await vi.advanceTimersByTimeAsync(FIRST_FRAME_TIMEOUT_MS + 10);
    await assertion;
    expect(nativeCapture.stop).toHaveBeenCalled();
  });

  it('rejeita se o addon encerrar antes do primeiro frame', async () => {
    const { host, end } = makeHost();
    const { gen } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    const assertion = expect(p).rejects.toThrow(/unsupported-format/);
    await vi.advanceTimersByTimeAsync(0);
    end('unsupported-format');
    await assertion;
  });

  it('rejeita se start() falhar', async () => {
    const { host } = makeHost({ start: vi.fn(async () => { throw new Error('Monitor rotacionado nao suportado'); }) });
    const { gen } = makeGenerator();
    await expect(startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen })).rejects.toThrow(/rotacionado/);
  });

  it('descarta frames enquanto uma escrita está em andamento (sem acumular latência)', async () => {
    const { host, push } = makeHost();
    const { gen } = makeGenerator();
    let release: () => void = () => undefined;
    (gen as unknown as { writable: { getWriter: () => unknown } }).writable.getWriter = () => ({
      write: vi.fn(() => new Promise<void>((r) => { release = r; })),
      close: vi.fn(async () => undefined),
    });
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    await vi.advanceTimersByTimeAsync(0);
    push(makeTexture().tex);
    await p;
    const second = makeTexture();
    push(second.tex);
    expect(second.frame.closed).toBe(true);
    release();
  });

  it('repete o último frame quando a tela fica parada', async () => {
    const { host, push } = makeHost();
    const { gen, written } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    await vi.advanceTimersByTimeAsync(0);
    push(makeTexture().tex);
    await p;
    await vi.advanceTimersByTimeAsync(0);
    const before = written.length;
    await vi.advanceTimersByTimeAsync(IDLE_REPEAT_MS * 3);
    expect(written.length).toBeGreaterThan(before);
  });

  it('track.stop() encerra o addon', async () => {
    const { host, nativeCapture, push } = makeHost();
    const { gen } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    await vi.advanceTimersByTimeAsync(0);
    push(makeTexture().tex);
    const track = await p;
    track.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(nativeCapture.stop).toHaveBeenCalledTimes(1);
  });

  it('reinicia após access-lost e encerra a faixa após esgotar as tentativas consecutivas', async () => {
    const { host, nativeCapture, push, end } = makeHost();
    const { gen, events } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    await vi.advanceTimersByTimeAsync(0);
    push(makeTexture().tex);
    await p;
    for (let i = 2; i <= 6; i++) {
      end('access-lost');
      await vi.advanceTimersByTimeAsync(600);
      expect(nativeCapture.start).toHaveBeenCalledTimes(i);
      expect(events).not.toContain('ended');
    }
    end('access-lost');
    await vi.advanceTimersByTimeAsync(600);
    expect(events).toContain('ended');
    expect(nativeCapture.stop).toHaveBeenCalled();
  });

  it('zera o contador de reinícios depois que a captura fica estável (alt-tab repetido)', async () => {
    const { host, nativeCapture, push, end } = makeHost();
    const { gen, events } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    await vi.advanceTimersByTimeAsync(0);
    push(makeTexture().tex);
    await p;
    for (let i = 0; i < 8; i++) {
      end('access-lost');
      await vi.advanceTimersByTimeAsync(600);
      push(makeTexture().tex); // frame logo após o reinício
      await vi.advanceTimersByTimeAsync(5100);
      push(makeTexture().tex); // 5 s depois, ainda chegando: estável
    }
    expect(nativeCapture.start).toHaveBeenCalledTimes(9);
    expect(events).not.toContain('ended');
  });

  it('falha ao reiniciar (DXGI ainda ocupado) tenta de novo em vez de encerrar a faixa', async () => {
    const { host, nativeCapture, push, end } = makeHost();
    const { gen, events } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    await vi.advanceTimersByTimeAsync(0);
    push(makeTexture().tex);
    await p;
    vi.mocked(nativeCapture.start).mockRejectedValueOnce(new Error('DXGI ocupado'));
    end('access-lost');
    await vi.advanceTimersByTimeAsync(600);
    expect(events).not.toContain('ended');
    await vi.advanceTimersByTimeAsync(600);
    expect(nativeCapture.start).toHaveBeenCalledTimes(3);
    expect(events).not.toContain('ended');
  });

  it('razão não recuperável encerra a faixa sem reiniciar', async () => {
    const { host, nativeCapture, push, end } = makeHost();
    const { gen, events } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    await vi.advanceTimersByTimeAsync(0);
    push(makeTexture().tex);
    await p;
    end('motivo-desconhecido');
    await vi.advanceTimersByTimeAsync(700);
    expect(events).toContain('ended');
    expect(getCaptureEndReason(gen)).toBe('motivo-desconhecido');
    expect(nativeCapture.start).toHaveBeenCalledTimes(1);
  });
});

describe('computeScaleDown', () => {
  it('sem captura nativa usa a altura configurada (1 = sem reduzir)', () => {
    expect(computeScaleDown(1080, null, {} as MediaStreamTrack)).toBe(1);
    expect(computeScaleDown(1080, 720, {} as MediaStreamTrack)).toBeCloseTo(1.5);
    expect(computeScaleDown(1080, 1080, null)).toBe(1);
    expect(computeScaleDown(undefined, null, null)).toBe(1);
  });

  it('com captura nativa maior que o alvo reduz até a altura configurada', async () => {
    const { host, push } = makeHost();
    const { gen } = makeGenerator();
    const p = startNativeVideoTrack(host, { fps: 60 }, { createGenerator: () => gen });
    await vi.advanceTimersByTimeAsync(0);
    push(makeTexture(2560, 1440).tex);
    const track = await p;
    expect(computeScaleDown(1080, null, track)).toBeCloseTo(1440 / 1080);
    expect(computeScaleDown(1080, 720, track)).toBeCloseTo(2);
    expect(computeScaleDown(1440, null, track)).toBe(1);
  });
});
