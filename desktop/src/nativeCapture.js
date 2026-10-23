'use strict';

/**
 * Captura nativa de tela (DXGI zero-copy) -> textura compartilhada -> renderer.
 *
 * O addon (`startSharedCapture`) entrega, por frame, um HANDLE NT de textura D3D11 num anel de slots.
 * Aqui cada handle vira um `SharedTextureImported` (electron.sharedTexture) enviado ao renderer, onde
 * o preload o converte em VideoFrame sem tocar a CPU. O slot só volta ao addon quando todas as
 * referências são liberadas (`allReferencesReleased`).
 *
 * Tudo que depende do Electron/addon é injetado (`deps`), para testar sem GPU.
 */

const MAX_ID_LENGTH = 256;

function validateOptions(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  let fps = 60;
  if (o.fps !== undefined) {
    if (!Number.isInteger(o.fps) || o.fps < 1 || o.fps > 240) throw new Error('FPS inválido (1 a 240).');
    fps = o.fps;
  }
  let sourceId = null;
  if (o.sourceId !== undefined && o.sourceId !== null) {
    if (typeof o.sourceId !== 'string' || o.sourceId.length < 1 || o.sourceId.length > MAX_ID_LENGTH ||
        !/^[\w:.\-]+$/.test(o.sourceId)) {
      throw new Error('ID de fonte inválido.');
    }
    sourceId = o.sourceId;
  }
  return { fps, sourceId };
}

/**
 * @param {object} deps
 * @param {() => object|null} deps.getNative        addon (ou null se não carregou)
 * @param {object} deps.screen                      electron.screen
 * @param {object} deps.sharedTexture               electron.sharedTexture
 * @param {object} deps.desktopCapturer             electron.desktopCapturer
 * @param {() => import('electron').WebContents|null} deps.getTarget   webContents que recebe os frames
 * @param {string} deps.platform
 */
function createNativeCapture(deps) {
  let active = false;

  function isAvailable() {
    const n = deps.getNative();
    return deps.platform === 'win32' && !!n &&
      typeof n.startSharedCapture === 'function' &&
      !!deps.sharedTexture && typeof deps.sharedTexture.importSharedTexture === 'function';
  }

  async function resolveDisplay(sourceId) {
    if (!sourceId) return deps.screen.getPrimaryDisplay();
    if (!sourceId.startsWith('screen:')) throw new Error('A captura nativa só atende telas inteiras.');
    const sources = await deps.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const src = sources.find((s) => s.id === sourceId);
    const display = src && deps.screen.getAllDisplays().find((d) => String(d.id) === String(src.display_id));
    if (!display) throw new Error('Tela não encontrada.');
    return display;
  }

  function stop() {
    if (!active) return null;
    active = false;
    const n = deps.getNative();
    try { return n && n.stopSharedCapture ? n.stopSharedCapture() : null; } catch (err) {
      console.warn('[desktop] Falha ao parar a captura nativa:', err && err.message);
      return null;
    }
  }

  async function start(opts) {
    if (!isAvailable()) throw new Error('Captura nativa indisponível.');
    const { fps, sourceId } = validateOptions(opts);
    const target = deps.getTarget();
    if (!target || target.isDestroyed()) throw new Error('Janela principal indisponível.');

    const display = await resolveDisplay(sourceId);
    // O addon identifica a saída pelo canto superior esquerdo em pixels físicos; `bounds` do Electron é em DIP.
    const rect = deps.screen.dipToScreenRect ? deps.screen.dipToScreenRect(null, display.bounds) : display.bounds;

    stop();
    const n = deps.getNative();
    n.startSharedCapture({ fps, left: rect.x, top: rect.y, cursor: true }, (f) => {
      if (!active) {
        if (f && f.slot !== undefined) n.releaseSharedFrame(f.slot);
        return;
      }
      if (f.ended) {
        active = false;
        if (!target.isDestroyed()) target.send('native-capture:ended', { reason: String(f.reason || 'unknown') });
        return;
      }
      if (target.isDestroyed()) { n.releaseSharedFrame(f.slot); return; }
      let tex;
      try {
        tex = deps.sharedTexture.importSharedTexture({
          textureInfo: {
            codedSize: { width: f.width, height: f.height },
            pixelFormat: 'bgra',
            timestamp: f.timestampUs,
            handle: { ntHandle: f.handle },
          },
          allReferencesReleased: () => n.releaseSharedFrame(f.slot),
        });
      } catch (err) {
        n.releaseSharedFrame(f.slot);
        return;
      }
      deps.sharedTexture
        .sendSharedTexture({ frame: target.mainFrame, importedSharedTexture: tex })
        .catch(() => { /* renderer sumiu/recarregou: o frame é só descartado */ })
        .finally(() => tex.release());
    });
    active = true;
    return { left: rect.x, top: rect.y };
  }

  return { isAvailable, start, stop, isActive: () => active };
}

module.exports = { createNativeCapture, validateOptions };
