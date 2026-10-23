import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createNativeCapture, validateOptions } = require('./nativeCapture.js');

function setup(over: Record<string, unknown> = {}) {
  let cb: (f: Record<string, unknown>) => void = () => undefined;
  const native = {
    startSharedCapture: vi.fn((_cfg: unknown, c: typeof cb) => { cb = c; }),
    stopSharedCapture: vi.fn(() => ({ sent: 1, dropped: 0 })),
    releaseSharedFrame: vi.fn(),
  };
  const imported = { release: vi.fn() };
  let allReleased: (() => void) | undefined;
  const sharedTexture = {
    importSharedTexture: vi.fn((o: { allReferencesReleased: () => void }) => { allReleased = o.allReferencesReleased; return imported; }),
    sendSharedTexture: vi.fn(async () => undefined),
  };
  const target = { isDestroyed: () => false, mainFrame: { id: 'frame' }, send: vi.fn() };
  const display = { id: 7, bounds: { x: 100, y: 50, width: 2560, height: 1440 } };
  const screen = {
    getPrimaryDisplay: () => display,
    getAllDisplays: () => [display],
    dipToScreenRect: (_w: unknown, r: { x: number; y: number }) => ({ x: r.x * 2, y: r.y * 2 }),
  };
  const desktopCapturer = { getSources: vi.fn(async () => [{ id: 'screen:1:0', display_id: '7' }]) };
  const deps = { getNative: () => native, screen, sharedTexture, desktopCapturer, getTarget: () => target, platform: 'win32', ...over };
  return { cap: createNativeCapture(deps), native, sharedTexture, target, imported, desktopCapturer, emit: (f: Record<string, unknown>) => cb(f), release: () => allReleased?.() };
}

const frame = { slot: 2, handle: Buffer.alloc(8), width: 2560, height: 1440, timestampUs: 10 };

describe('validateOptions', () => {
  it('aceita padrão e valida fps/sourceId', () => {
    expect(validateOptions(undefined)).toEqual({ fps: 60, sourceId: null });
    expect(validateOptions({ fps: 120, sourceId: 'screen:1:0' })).toEqual({ fps: 120, sourceId: 'screen:1:0' });
    expect(() => validateOptions({ fps: 0 })).toThrow();
    expect(() => validateOptions({ fps: 241 })).toThrow();
    expect(() => validateOptions({ fps: 1.5 })).toThrow();
    expect(() => validateOptions({ sourceId: '../x y' })).toThrow();
    expect(() => validateOptions({ sourceId: 42 })).toThrow();
  });
});

describe('createNativeCapture', () => {
  it('indisponível fora do Windows, sem addon ou sem sharedTexture', () => {
    expect(setup({ platform: 'darwin' }).cap.isAvailable()).toBe(false);
    expect(setup({ getNative: () => null }).cap.isAvailable()).toBe(false);
    expect(setup({ sharedTexture: undefined }).cap.isAvailable()).toBe(false);
    expect(setup().cap.isAvailable()).toBe(true);
  });

  it('start usa as coordenadas físicas da tela principal e importa/envia/libera cada frame', async () => {
    const s = setup();
    await s.cap.start({ fps: 60 });
    expect(s.native.startSharedCapture).toHaveBeenCalledWith({ fps: 60, left: 200, top: 100, cursor: true }, expect.any(Function));
    s.emit(frame);
    expect(s.sharedTexture.importSharedTexture).toHaveBeenCalledTimes(1);
    expect(s.sharedTexture.importSharedTexture.mock.calls[0][0].textureInfo).toMatchObject({
      codedSize: { width: 2560, height: 1440 }, pixelFormat: 'bgra', timestamp: 10,
    });
    expect(s.sharedTexture.sendSharedTexture).toHaveBeenCalledWith({ frame: s.target.mainFrame, importedSharedTexture: s.imported });
    await Promise.resolve(); await Promise.resolve();
    expect(s.imported.release).toHaveBeenCalled();
    s.release();
    expect(s.native.releaseSharedFrame).toHaveBeenCalledWith(2);
  });

  it('escolhe a tela pelo sourceId e rejeita janelas', async () => {
    const s = setup();
    await s.cap.start({ fps: 60, sourceId: 'screen:1:0' });
    expect(s.desktopCapturer.getSources).toHaveBeenCalled();
    await expect(setup().cap.start({ fps: 60, sourceId: 'window:1:0' })).rejects.toThrow(/telas inteiras/);
    const s2 = setup({ desktopCapturer: { getSources: async () => [] } });
    await expect(s2.cap.start({ fps: 60, sourceId: 'screen:9:0' })).rejects.toThrow(/não encontrada/);
  });

  it('falha de importação devolve o slot ao addon', async () => {
    const s = setup();
    s.sharedTexture.importSharedTexture.mockImplementation(() => { throw new Error('boom'); });
    await s.cap.start({ fps: 60 });
    s.emit(frame);
    expect(s.native.releaseSharedFrame).toHaveBeenCalledWith(2);
  });

  it('aviso de fim do addon é repassado ao renderer; frames depois dele são devolvidos', async () => {
    const s = setup();
    await s.cap.start({ fps: 60 });
    s.emit({ ended: true, reason: 'access-lost' });
    expect(s.target.send).toHaveBeenCalledWith('native-capture:ended', { reason: 'access-lost' });
    expect(s.cap.isActive()).toBe(false);
    s.emit(frame);
    expect(s.native.releaseSharedFrame).toHaveBeenCalledWith(2);
  });

  it('stop é idempotente e chama stopSharedCapture uma vez', async () => {
    const s = setup();
    await s.cap.start({ fps: 60 });
    s.cap.stop();
    s.cap.stop();
    expect(s.native.stopSharedCapture).toHaveBeenCalledTimes(1);
  });

  it('nova captura para a anterior antes de iniciar', async () => {
    const s = setup();
    await s.cap.start({ fps: 60 });
    await s.cap.start({ fps: 60 });
    expect(s.native.stopSharedCapture).toHaveBeenCalledTimes(1);
    expect(s.native.startSharedCapture).toHaveBeenCalledTimes(2);
  });
});
