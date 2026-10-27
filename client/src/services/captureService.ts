/**
 * Captura de tela via getDisplayMedia.
 *
 * No desktop (Electron, `window.screenShareHost`) o áudio NÃO vem daqui: é capturado
 * por aplicativo e mixado pelo BroadcastAudio. No navegador, o áudio do sistema
 * chega junto com o vídeo.
 */

import type { VideoConfig } from '@shared/index';
import { MediaError, toMediaError } from './mediaError';
import { canUseNativeCapture, startNativeVideoTrack } from './nativeCapture';

export interface CaptureResult {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  audioTracks: MediaStreamTrack[];
}

export type ContentHint = 'motion' | 'detail';

/**
 * 'detail' → browser prioriza nitidez (bom para apresentações e texto/código).
 * 'motion' → browser prioriza fluidez/FPS (jogos e movimento rápido).
 */
export function contentHintForQuality(quality: VideoConfig['quality']): ContentHint {
  return quality === 'high' ? 'detail' : 'motion';
}

export interface CaptureOptions {
  withAudio: boolean;
  /** (desktop) fonte escolhida na interface; vale só para esta chamada */
  captureSourceId?: string | null;
  /** 'motion' prioriza fluidez; 'detail' prioriza nitidez de texto/código (padrão: 'motion') */
  contentHint?: ContentHint;
  /** (desktop) false pula a captura nativa e vai direto ao getDisplayMedia (padrão: true) */
  preferNative?: boolean;
}

export function isMacOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform || '';
  return /^Mac/i.test(platform) || (!platform && /Mac OS X|Macintosh/i.test(navigator.userAgent || ''));
}

function buildConstraints(config: VideoConfig, withAudio: boolean): DisplayMediaStreamOptions {
  const targetFps = config.frameRate || 60;
  const mac = isMacOS();
  const retina = mac && (window.devicePixelRatio || 1) > 1;
  // Em telas Retina a captura nativa é 2x; limitar ao tamanho pedido evita encodar o dobro de pixels
  const maxWidth = retina ? config.width : 3840;
  const maxHeight = retina ? config.height : 2160;
  return {
    video: {
      width: { ideal: config.width, max: maxWidth },
      height: { ideal: config.height, max: maxHeight },
      frameRate: { ideal: targetFps, max: Math.max(targetFps, 120) },
      // macOS: deixa o navegador escalar a captura Retina; demais: resolução nativa sem reescala
      resizeMode: mac ? 'crop-and-scale' : 'none',
      cursor: 'always',
    } as MediaTrackConstraints,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    // Sem processamento: eco/ruído/AGC degradam o áudio de jogos e músicas
    audio: withAudio
      ? ({
          suppressLocalAudioPlayback: false,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints)
      : false,
  } as DisplayMediaStreamOptions;
}

function logCapture(config: VideoConfig, track: MediaStreamTrack, source: 'native' | 'display-media' = 'display-media'): void {
  if (!import.meta.env.DEV) return;
  const settings = track.getSettings?.() ?? {};
  // eslint-disable-next-line no-console
  console.debug('[KIARA capture]', {
    source,
    requested: { width: config.width, height: config.height, frameRate: config.frameRate || 60 },
    actual: { width: settings.width, height: settings.height, frameRate: settings.frameRate },
    devicePixelRatio: window.devicePixelRatio,
    macOS: isMacOS(),
    contentHint: track.contentHint,
  });
}

/**
 * Abre o seletor de tela/janela.
 *
 * @param withAudio       pede o áudio do sistema (somente navegador)
 * @param captureSourceId (desktop) fonte escolhida na interface; vale só para esta chamada
 */
/** Navegadores de celular (Android/iOS) não implementam getDisplayMedia */
export function isDisplayCaptureSupported(): boolean {
  return typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

export async function captureDisplay(
  config: VideoConfig,
  { withAudio, captureSourceId, contentHint = 'motion', preferNative = true }: CaptureOptions,
): Promise<CaptureResult> {
  const host = window.screenShareHost;

  if (!isDisplayCaptureSupported()) throw new MediaError('unsupported');

  try {
    // Desktop/Windows: captura nativa zero-copy (60 fps estáveis). Qualquer falha cai no getDisplayMedia.
    if (host && preferNative && (await canUseNativeCapture(host, captureSourceId))) {
      try {
        const videoTrack = await startNativeVideoTrack(host, {
          fps: config.frameRate || 60,
          sourceId: captureSourceId ?? null,
        });
        videoTrack.contentHint = contentHint;
        const stream = new MediaStream([videoTrack]);
        logCapture(config, videoTrack, 'native');
        return { stream, videoTrack, audioTracks: [] };
      } catch (err) {
        console.warn('[KIARA] Captura nativa indisponível, usando getDisplayMedia:', err);
      }
    }

    if (host && captureSourceId) {
      await host.capture.selectSource(captureSourceId);
    }
    const stream = await navigator.mediaDevices.getDisplayMedia(
      buildConstraints(config, withAudio && !host),
    );
    const [videoTrack] = stream.getVideoTracks();
    if (!videoTrack) {
      stopStream(stream);
      throw new MediaError('no-video');
    }
    videoTrack.contentHint = contentHint;

    // Tenta aplicar restrições de frameRate diretamente na faixa para garantir que o browser não limite a 30fps
    try {
      const targetFps = config.frameRate || 60;
      await videoTrack.applyConstraints({
        frameRate: { ideal: targetFps, max: Math.max(targetFps, 120) },
      });
    } catch {
      // Ignora se o browser/driver não aceitar applyConstraints dinâmico
    }

    logCapture(config, videoTrack);

    return { stream, videoTrack, audioTracks: stream.getAudioTracks() };
  } catch (err) {
    throw toMediaError(err);
  }
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => {
    if (track.readyState === 'live') track.stop();
  });
}
