import { describe, it, expect, vi } from 'vitest';
import {
  copyStyleSheets,
  isDocumentPipSupported,
  openDocumentPip,
  pipSizeFor,
  togglePipFullscreen,
  type DocumentPipHost,
  type PipExpandMemory,
  type PipWindowLike,
} from './documentPip';
import { formatPipStats } from './pipStats';
import type { StreamStats } from '@shared/index';

describe('isDocumentPipSupported', () => {
  it('detecta requestWindow', () => {
    const host: DocumentPipHost = { documentPictureInPicture: { requestWindow: vi.fn() } };
    expect(isDocumentPipSupported(host)).toBe(true);
  });

  it('é falso sem a API', () => {
    expect(isDocumentPipSupported({})).toBe(false);
  });

  it('é falso no Electron, onde a janela fecha na hora; vale o PiP nativo', () => {
    const host: DocumentPipHost = { documentPictureInPicture: { requestWindow: vi.fn() } };
    const electronUa =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) KIARA/1.0.73 Chrome/152.0.7977.149 Electron/44.7.2 Safari/537.36';
    const chromeUa =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';
    expect(isDocumentPipSupported(host, electronUa)).toBe(false);
    expect(isDocumentPipSupported(host, chromeUa)).toBe(true);
  });
});

describe('pipSizeFor', () => {
  it('usa 16:9 sem dimensões do vídeo', () => {
    expect(pipSizeFor()).toEqual({ width: 480, height: 270 });
  });

  it('acompanha a proporção do vídeo', () => {
    expect(pipSizeFor(1920, 1080).height).toBe(270);
    expect(pipSizeFor(1440, 1080).height).toBe(360);
  });

  it('limita a altura de telas muito altas ou muito largas', () => {
    expect(pipSizeFor(1000, 3000).height).toBe(540);
    expect(pipSizeFor(3440, 800).height).toBe(200);
  });
});

describe('openDocumentPip', () => {
  it('abre com o tamanho pedido', async () => {
    const fakeWindow = {} as Window;
    const requestWindow = vi.fn().mockResolvedValue(fakeWindow);
    const win = await openDocumentPip({ width: 480, height: 270 }, { documentPictureInPicture: { requestWindow } });
    expect(win).toBe(fakeWindow);
    expect(requestWindow).toHaveBeenCalledWith({ width: 480, height: 270 });
  });

  it('devolve null se o navegador recusar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const requestWindow = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    const win = await openDocumentPip({ width: 480, height: 270 }, { documentPictureInPicture: { requestWindow } });
    expect(win).toBeNull();
    warn.mockRestore();
  });

  it('devolve null sem a API', async () => {
    expect(await openDocumentPip({ width: 480, height: 270 }, {})).toBeNull();
  });
});

describe('copyStyleSheets', () => {
  function target() {
    const appended: Array<Record<string, unknown>> = [];
    return {
      appended,
      doc: {
        head: { appendChild: (n: unknown) => appended.push(n as Record<string, unknown>) },
        createElement: () => ({}) as Record<string, string>,
      },
    };
  }

  it('copia as regras CSS legíveis como <style>', () => {
    const t = target();
    const n = copyStyleSheets(
      { styleSheets: [{ cssRules: [{ cssText: '.a{color:red}' }, { cssText: '.b{color:blue}' }] }] },
      t.doc,
    );
    expect(n).toBe(1);
    expect(t.appended[0].textContent).toBe('.a{color:red}\n.b{color:blue}');
  });

  it('usa <link> quando as regras não podem ser lidas', () => {
    const t = target();
    const unreadable = {
      href: 'https://cdn.exemplo/x.css',
      get cssRules(): never {
        throw new Error('SecurityError');
      },
    };
    const n = copyStyleSheets({ styleSheets: [unreadable] }, t.doc);
    expect(n).toBe(1);
    expect(t.appended[0].href).toBe('https://cdn.exemplo/x.css');
    expect(t.appended[0].rel).toBe('stylesheet');
  });

  it('ignora folha ilegível e sem href', () => {
    const t = target();
    const n = copyStyleSheets(
      {
        styleSheets: [
          {
            get cssRules(): never {
              throw new Error('SecurityError');
            },
          },
        ],
      },
      t.doc,
    );
    expect(n).toBe(0);
    expect(t.appended).toHaveLength(0);
  });
});

describe('togglePipFullscreen', () => {
  function fakeWindow(overrides: Partial<PipWindowLike['document']> = {}) {
    const win = {
      document: {
        documentElement: { requestFullscreen: vi.fn().mockResolvedValue(undefined) },
        fullscreenElement: null,
        fullscreenEnabled: true,
        exitFullscreen: vi.fn().mockResolvedValue(undefined),
        ...overrides,
      },
      screen: { availWidth: 1920, availHeight: 1040, availLeft: 0, availTop: 0 },
      outerWidth: 480,
      outerHeight: 300,
      screenX: 1400,
      screenY: 700,
      resizeTo: vi.fn<(width: number, height: number) => void>(),
      moveTo: vi.fn<(x: number, y: number) => void>(),
    };
    return win satisfies PipWindowLike;
  }

  it('entra em tela cheia de verdade quando permitido', async () => {
    const win = fakeWindow();
    const memory: PipExpandMemory = {};
    expect(await togglePipFullscreen(win, memory)).toBe('fullscreen');
    expect(win.resizeTo).not.toHaveBeenCalled();
  });

  it('sai da tela cheia se já estiver nela', async () => {
    const win = fakeWindow({ fullscreenElement: {} });
    expect(await togglePipFullscreen(win, {})).toBe('exited');
    expect(win.document.exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('amplia a janela quando a Fullscreen API é recusada e depois restaura', async () => {
    const win = fakeWindow({
      documentElement: { requestFullscreen: vi.fn().mockRejectedValue(new TypeError('negado')) },
    });
    const memory: PipExpandMemory = {};

    expect(await togglePipFullscreen(win, memory)).toBe('expanded');
    expect(win.resizeTo).toHaveBeenLastCalledWith(1920, 1040);
    expect(win.moveTo).toHaveBeenLastCalledWith(0, 0);
    expect(memory.previous).toEqual({ width: 480, height: 300, x: 1400, y: 700 });

    expect(await togglePipFullscreen(win, memory)).toBe('restored');
    expect(win.resizeTo).toHaveBeenLastCalledWith(480, 300);
    expect(win.moveTo).toHaveBeenLastCalledWith(1400, 700);
    expect(memory.previous).toBeUndefined();
  });

  it('amplia a janela quando fullscreenEnabled é falso', async () => {
    const win = fakeWindow({ fullscreenEnabled: false });
    expect(await togglePipFullscreen(win, {})).toBe('expanded');
  });
});

describe('formatPipStats', () => {
  const base: StreamStats = {
    fps: 60,
    videoBitrate: 7900,
    audioBitrate: 190,
    latencyMs: 24,
    packetsLost: 0,
    lossPercent: 0,
    jitterMs: 3,
    qualityLimitation: 'none',
    connectionQuality: 'excellent',
    timestamp: 0,
    encodedWidth: 1920,
    encodedHeight: 1080,
  };

  it('formata os valores e marca os tons', () => {
    const items = formatPipStats(base);
    expect(items.map((i) => i.label)).toEqual(['FPS', 'Resolução', 'Vídeo', 'Latência', 'Perda', 'Jitter']);
    expect(items.find((i) => i.label === 'Vídeo')?.value).toBe('7.9 Mbps');
    expect(items.find((i) => i.label === 'Resolução')?.value).toBe('1920×1080');
    expect(items.find((i) => i.label === 'FPS')?.tone).toBe('good');
  });

  it('sinaliza FPS baixo, perda e latência altas', () => {
    const items = formatPipStats({ ...base, fps: 30, lossPercent: 5, latencyMs: 250, jitterMs: 50 });
    expect(items.find((i) => i.label === 'FPS')?.tone).toBe('bad');
    expect(items.find((i) => i.label === 'Perda')?.tone).toBe('bad');
    expect(items.find((i) => i.label === 'Latência')?.tone).toBe('warn');
    expect(items.find((i) => i.label === 'Jitter')?.tone).toBe('warn');
  });

  it('omite a resolução quando desconhecida', () => {
    expect(
      formatPipStats({ ...base, encodedWidth: undefined, encodedHeight: undefined } as StreamStats).some(
        (i) => i.label === 'Resolução',
      ),
    ).toBe(false);
  });
});
