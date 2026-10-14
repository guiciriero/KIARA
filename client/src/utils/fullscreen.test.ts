import { describe, expect, it, vi } from 'vitest';
import { canFullscreen, getFullscreenElement, setLandscapeLock, toggleFullscreen } from './fullscreen';

const el = {} as Element;

describe('fullscreen', () => {
  it('usa a API padrão do container quando existe', async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    const result = await toggleFullscreen({}, { requestFullscreen });
    expect(result).toBe('entered');
    expect(requestFullscreen).toHaveBeenCalledOnce();
  });

  it('cai para a API com prefixo webkit', async () => {
    const webkitRequestFullscreen = vi.fn();
    expect(await toggleFullscreen({}, { webkitRequestFullscreen })).toBe('entered');
    expect(webkitRequestFullscreen).toHaveBeenCalledOnce();
  });

  it('no iPhone usa o player nativo do <video>', async () => {
    const webkitEnterFullscreen = vi.fn();
    expect(await toggleFullscreen({}, {}, { webkitEnterFullscreen })).toBe('video-native');
    expect(webkitEnterFullscreen).toHaveBeenCalledOnce();
  });

  it('informa quando não há suporte', async () => {
    expect(await toggleFullscreen({}, {}, {})).toBe('unsupported');
    expect(canFullscreen({}, {})).toBe(false);
    expect(canFullscreen({}, { webkitEnterFullscreen: () => {} })).toBe(true);
  });

  it('sai da tela cheia padrão ou prefixada', async () => {
    const exitFullscreen = vi.fn().mockResolvedValue(undefined);
    expect(await toggleFullscreen({ fullscreenElement: el, exitFullscreen }, {})).toBe('exited');
    expect(exitFullscreen).toHaveBeenCalledOnce();

    const webkitExitFullscreen = vi.fn();
    expect(await toggleFullscreen({ webkitFullscreenElement: el, webkitExitFullscreen }, {})).toBe('exited');
    expect(webkitExitFullscreen).toHaveBeenCalledOnce();
  });

  it('sai da tela cheia nativa do vídeo', async () => {
    const webkitExitFullscreen = vi.fn();
    const video = { webkitDisplayingFullscreen: true, webkitExitFullscreen };
    expect(await toggleFullscreen({}, {}, video)).toBe('exited');
    expect(webkitExitFullscreen).toHaveBeenCalledOnce();
  });

  it('lê o elemento em tela cheia padrão ou prefixado', () => {
    expect(getFullscreenElement({})).toBeNull();
    expect(getFullscreenElement({ webkitFullscreenElement: el })).toBe(el);
  });

  it('trava e destrava a orientação ignorando recusas', async () => {
    const lock = vi.fn().mockRejectedValue(new Error('NotSupportedError'));
    const unlock = vi.fn();
    await expect(setLandscapeLock({ lock, unlock }, true)).resolves.toBeUndefined();
    await setLandscapeLock({ lock, unlock }, false);
    expect(unlock).toHaveBeenCalledOnce();
    await expect(setLandscapeLock(undefined, true)).resolves.toBeUndefined();
  });
});
