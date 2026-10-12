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
  return {
    video: {
      width:     { ideal: config.width,  max: 3840 },
      height:    { ideal: config.height, max: 2160 },
      frameRate: { ideal: config.frameRate || 60, max: 60 },
    },
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
export async function captureDisplay(
  config: VideoConfig,
  { withAudio, captureSourceId }: { withAudio: boolean; captureSourceId?: string | null },
): Promise<CaptureResult> {
  const host = window.screenShareHost;

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
    // 'motion' prioriza fluidez (60 FPS) sobre nitidez de texto
    videoTrack.contentHint = 'motion';
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
