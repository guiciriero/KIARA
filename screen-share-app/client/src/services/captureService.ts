/**
 * captureService.ts
 * Abstrai a captura de tela e áudio usando as APIs do navegador:
 *   - getDisplayMedia(): captura de vídeo da tela com seleção de janela/monitor
 *   - AudioContext + MediaStreamTrackProcessor: processamento de áudio (Chrome 94+)
 *
 * Em ambiente Electron, este serviço seria substituído pelo módulo nativo C++.
 * No navegador, usamos as APIs Web padrão (sem acesso a áudio por app individual
 * — essa funcionalidade está disponível apenas via Electron + módulo nativo).
 */

import type { VideoConfig } from '@shared/index';

export interface CaptureResult {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  audioTracks: MediaStreamTrack[];
}

/**
 * Inicia a captura de tela.
 *
 * - Web: abre o seletor nativo do navegador (janela, monitor, aba) e captura
 *   também o áudio do sistema.
 * - Desktop (Electron, `window.screenShareHost` presente): o áudio NÃO vem do
 *   getDisplayMedia (`audio: false`) — ele é capturado por aplicativo e mixado pelo
 *   AppAudioMixer. Se `captureSourceId` for informado, ele é registrado no host
 *   (selectSource, uso único) antes do getDisplayMedia.
 *
 * @param videoConfig      Configurações de resolução e FPS desejados
 * @param captureSourceId  (desktop) ID da tela/janela escolhida na interface
 */
export async function startScreenCapture(
  videoConfig: VideoConfig,
  captureSourceId?: string | null,
): Promise<CaptureResult> {
  const host = window.screenShareHost;
  const targetFps = videoConfig.frameRate || 60;

  const constraints: DisplayMediaStreamOptions = {
    video: {
      width:     { ideal: videoConfig.width,     max: 3840 },
      height:    { ideal: videoConfig.height,    max: 2160 },
      frameRate: { ideal: targetFps,             max: 60 },
    },
    audio: host
      ? false
      // O áudio do sistema via getDisplayMedia é suportado no Chrome (Windows/macOS)
      : ({
          suppressLocalAudioPlayback: false,
          echoCancellation: false,
          noiseSuppression: false,
          sampleRate: 48000,
        } as MediaTrackConstraints),
  };

  try {
    if (host && captureSourceId) {
      await host.capture.selectSource(captureSourceId);
    }
    const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    const videoTrack = stream.getVideoTracks()[0];
    const audioTracks = stream.getAudioTracks();

    if (!videoTrack) {
      throw new Error('Nenhuma faixa de vídeo foi encontrada. Verifique se você selecionou uma janela ou tela válida.');
    }

    // Configura o contentHint para 'motion' para priorizar fluidez a 60 FPS
    if ('contentHint' in videoTrack) {
      videoTrack.contentHint = 'motion';
    }

    return { stream, videoTrack, audioTracks };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new Error('Você precisa permitir o compartilhamento de tela quando o navegador solicitar.');
    }
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      throw new Error('Nenhuma fonte de captura encontrada. Verifique se há uma tela ou janela disponível.');
    }
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Você cancelou a seleção de tela. Clique em "Iniciar" novamente para tentar de novo.');
    }
    throw err;
  }
}

/**
 * Captura apenas uma nova faixa de vídeo da tela ou janela (usada para troca em tempo real).
 * Não captura nem interrompe as faixas de áudio existentes.
 */
export async function captureSingleVideoTrack(
  videoConfig: VideoConfig,
  captureSourceId?: string | null,
): Promise<MediaStreamTrack> {
  const host = window.screenShareHost;
  const targetFps = videoConfig.frameRate || 60;

  const constraints: DisplayMediaStreamOptions = {
    video: {
      width:     { ideal: videoConfig.width,     max: 3840 },
      height:    { ideal: videoConfig.height,    max: 2160 },
      frameRate: { ideal: targetFps,             max: 60 },
    },
    audio: false,
  };

  try {
    if (host && captureSourceId) {
      await host.capture.selectSource(captureSourceId);
    }
    const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
    const videoTrack = stream.getVideoTracks()[0];

    if (!videoTrack) {
      throw new Error('Nenhuma faixa de vídeo foi capturada.');
    }

    if ('contentHint' in videoTrack) {
      videoTrack.contentHint = 'motion';
    }

    return videoTrack;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      throw new Error('Seleção de tela cancelada.');
    }
    throw err;
  }
}

/**
 * Cria um MediaStream combinado de vídeo da tela + áudio de múltiplas fontes.
 * Usa AudioContext para mixar as faixas de áudio.
 *
 * @param videoTrack  Faixa de vídeo da captura de tela
 * @param audioTracks Faixas de áudio a serem mixadas
 */
export function combineStreams(
  videoTrack: MediaStreamTrack,
  audioTracks: MediaStreamTrack[],
): MediaStream {
  if (audioTracks.length === 0) {
    return new MediaStream([videoTrack]);
  }

  if (audioTracks.length === 1) {
    return new MediaStream([videoTrack, audioTracks[0]]);
  }

  // Múltiplas fontes: usa AudioContext para mixagem
  const audioCtx = new AudioContext({ sampleRate: 48000 });
  const destination = audioCtx.createMediaStreamDestination();

  for (const track of audioTracks) {
    const source = audioCtx.createMediaStreamSource(new MediaStream([track]));
    source.connect(destination);
  }

  const mixedAudioTrack = destination.stream.getAudioTracks()[0];
  return new MediaStream([videoTrack, mixedAudioTrack]);
}

/**
 * Solicita acesso ao microfone do usuário (para áudio adicional).
 */
export async function getMicrophoneTrack(): Promise<MediaStreamTrack> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      sampleRate: 48000,
    },
  });
  return stream.getAudioTracks()[0];
}

/**
 * Para uma faixa de mídia com segurança.
 */
export function stopTrack(track: MediaStreamTrack | null): void {
  if (track && track.readyState === 'live') {
    track.stop();
  }
}

/**
 * Para todas as faixas de um MediaStream.
 */
export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach(stopTrack);
}
