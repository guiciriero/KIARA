/**
 * Captura de tela via getDisplayMedia.
 *
 * No desktop (Electron, `window.screenShareHost`) o áudio NÃO vem daqui: é capturado
 * por aplicativo e mixado pelo BroadcastAudio. No navegador, o áudio do sistema
 * chega junto com o vídeo.
 */

import type { VideoConfig } from '@shared/index';
import { MediaError, toMediaError } from './mediaError';

export interface CaptureResult {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  audioTracks: MediaStreamTrack[];
}

function buildConstraints(config: VideoConfig, withAudio: boolean): DisplayMediaStreamOptions {
  const targetFps = config.frameRate || 60;
  return {
    video: {
      width: { ideal: config.width, max: 3840 },
      height: { ideal: config.height, max: 2160 },
      frameRate: { ideal: targetFps, max: Math.max(targetFps, 120) },
      // Otimizações de renderização/captura: evita throttling artificial do compositor
      resizeMode: 'none',
      cursor: 'always',
    } as MediaTrackConstraints,
    // Sem processamento: eco/ruído/AGC degradam o áudio de jogos e músicas
    audio: withAudio
      ? ({
          suppressLocalAudioPlayback: false,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as MediaTrackConstraints)
      : false,
  };
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
  { withAudio, captureSourceId }: { withAudio: boolean; captureSourceId?: string | null },
): Promise<CaptureResult> {
  const host = window.screenShareHost;

  if (!isDisplayCaptureSupported()) throw new MediaError('unsupported');

  try {
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
    // 'motion' prioriza fluidez e taxa máxima de FPS sobre nitidez estática
    videoTrack.contentHint = 'motion';

    // Tenta aplicar restrições de frameRate diretamente na faixa para garantir que o browser não limite a 30fps
    try {
      const targetFps = config.frameRate || 60;
      await videoTrack.applyConstraints({
        frameRate: { ideal: targetFps, max: Math.max(targetFps, 120) },
      });
    } catch {
      // Ignora se o browser/driver não aceitar applyConstraints dinâmico
    }

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
