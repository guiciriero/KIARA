/**
 * fullscreen.ts
 * Tela cheia compatível com celulares.
 *
 * - Android/desktop: Fullscreen API padrão no container (mantém nossos controles e o chat).
 * - Safari (iPad/macOS antigo): API com prefixo `webkit`.
 * - iPhone: só o <video> entra em tela cheia, via `webkitEnterFullscreen()` (player nativo).
 * Funções puras sobre objetos mínimos, para testar sem DOM.
 */

export interface FullscreenDocument {
  fullscreenElement?: Element | null;
  webkitFullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitExitFullscreen?: () => Promise<void> | void;
}

export interface FullscreenTarget {
  requestFullscreen?: (options?: { navigationUI?: 'hide' | 'show' | 'auto' }) => Promise<void>;
  webkitRequestFullscreen?: () => Promise<void> | void;
}

export interface FullscreenVideo {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
}

/** Elemento atualmente em tela cheia (padrão ou prefixado) */
export function getFullscreenElement(doc: FullscreenDocument): Element | null {
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/** O aparelho consegue algum tipo de tela cheia? */
export function canFullscreen(target: FullscreenTarget, video?: FullscreenVideo | null): boolean {
  return (
    typeof target.requestFullscreen === 'function' ||
    typeof target.webkitRequestFullscreen === 'function' ||
    typeof video?.webkitEnterFullscreen === 'function'
  );
}

/** Suporte do aparelho, sem depender de elementos já montados (usa os protótipos do DOM) */
export function deviceSupportsFullscreen(): boolean {
  if (typeof document === 'undefined') return false;
  const elementProto = (typeof Element !== 'undefined' ? Element.prototype : {}) as FullscreenTarget;
  const videoProto = (typeof HTMLVideoElement !== 'undefined' ? HTMLVideoElement.prototype : {}) as FullscreenVideo;
  return canFullscreen(elementProto, videoProto);
}

export type FullscreenResult = 'entered' | 'exited' | 'video-native' | 'unsupported';

/**
 * Alterna a tela cheia. Tenta o container (preserva controles), depois o container
 * com prefixo e, por fim, o player nativo do <video> (iPhone).
 */
export async function toggleFullscreen(
  doc: FullscreenDocument,
  target: FullscreenTarget,
  video?: FullscreenVideo | null,
): Promise<FullscreenResult> {
  if (getFullscreenElement(doc)) {
    if (typeof doc.exitFullscreen === 'function') await doc.exitFullscreen();
    else if (typeof doc.webkitExitFullscreen === 'function') await doc.webkitExitFullscreen();
    return 'exited';
  }

  if (video?.webkitDisplayingFullscreen) {
    video.webkitExitFullscreen?.();
    return 'exited';
  }

  if (typeof target.requestFullscreen === 'function') {
    await target.requestFullscreen({ navigationUI: 'hide' });
    return 'entered';
  }
  if (typeof target.webkitRequestFullscreen === 'function') {
    await target.webkitRequestFullscreen();
    return 'entered';
  }
  if (typeof video?.webkitEnterFullscreen === 'function') {
    video.webkitEnterFullscreen();
    return 'video-native';
  }
  return 'unsupported';
}

interface LockableOrientation {
  lock?: (orientation: 'landscape') => Promise<void>;
  unlock?: () => void;
}

/** Em tela cheia no celular, trava em paisagem (só onde o navegador permite; falhas são ignoradas) */
export async function setLandscapeLock(
  orientation: LockableOrientation | undefined,
  enable: boolean,
): Promise<void> {
  if (!orientation) return;
  try {
    if (enable) await orientation.lock?.('landscape');
    else orientation.unlock?.();
  } catch {
    // iOS e navegadores desktop recusam o lock: sem problema
  }
}
