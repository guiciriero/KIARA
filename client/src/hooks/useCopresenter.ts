/**
 * Hook do co-apresentador: um espectador que, com aprovação do host, também transmite.
 *
 * Não cria sala: continua como viewer e, ao ser aprovado, captura a tela e envia o offer
 * WebRTC direto ao host (`broadcaster.connectToPeer(hostId)`), sem esperar `room:viewer-joined`.
 * O áudio passa por um BroadcastAudio, como em useBroadcast.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { WebRTCBroadcaster } from '../services/webrtcService';
import { captureDisplay, stopStream } from '../services/captureService';
import type { ContentHint } from '../services/captureService';
import { BroadcastAudio } from '../services/broadcastAudio';
import type { AudioSelectionItem } from '../services/broadcastAudio';
import { toMediaError } from '../services/mediaError';
import type {
  VideoConfig,
  IceServerConfig,
  CopresentRequestPayload,
  CopresentResponsePayload,
} from '@shared/index';

export interface CopresenterState {
  isSharing: boolean;
  isPaused: boolean;
  /** Cópia só de vídeo da captura, para o preview local */
  stream: MediaStream | null;
  error: string | null;
  /** Aguardando o host aprovar */
  pendingApproval: boolean;
  /** O host recusou */
  denied: boolean;
}

const INITIAL_STATE: CopresenterState = {
  isSharing: false,
  isPaused: false,
  stream: null,
  error: null,
  pendingApproval: false,
  denied: false,
};

/** 'high'/'ultra' priorizam nitidez (texto/código); 'low'/'medium' priorizam fluidez */
function contentHintFor(quality: VideoConfig['quality']): ContentHint {
  return quality === 'high' || quality === 'ultra' ? 'detail' : 'motion';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Ocorreu um erro inesperado. Tente novamente.';
}

export function useCopresenter(
  socket: Socket | null,
  hostId: string | null,
  iceServers: IceServerConfig[],
  videoConfig: VideoConfig,
  audioSelection: AudioSelectionItem[],
  /** (desktop) ID da tela/janela escolhida na interface */
  captureSourceId: string | null,
  /** Dados enviados com o pedido (ex.: apelido) */
  roomOptions?: CopresentRequestPayload,
) {
  const broadcasterRef = useRef<WebRTCBroadcaster | null>(null);
  const audioRef = useRef<BroadcastAudio | null>(null);
  /** Stream enviado ao WebRTC (vídeo + faixa estável do mixer) */
  const streamRef = useRef<MediaStream | null>(null);
  /** Stream bruto do getDisplayMedia; guarda as faixas de áudio do sistema no modo web */
  const captureStreamRef = useRef<MediaStream | null>(null);

  const latest = useRef({ hostId, iceServers, videoConfig, audioSelection, captureSourceId, roomOptions });
  latest.current = { hostId, iceServers, videoConfig, audioSelection, captureSourceId, roomOptions };

  const [state, setState] = useState<CopresenterState>(INITIAL_STATE);

  const release = useCallback(() => {
    broadcasterRef.current?.destroy();
    broadcasterRef.current = null;

    void audioRef.current?.destroy();
    audioRef.current = null;

    stopStream(streamRef.current);
    streamRef.current = null;
    stopStream(captureStreamRef.current);
    captureStreamRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  // Aplica ao vivo a seleção de fontes, volume e mute
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.sync(audioSelection).catch((err) => {
      setState((s) => ({ ...s, error: errorMessage(err) }));
    });
  }, [audioSelection]);

  /** Para a transmissão local sem sair da sala */
  const stopCopresent = useCallback(() => {
    release();
    setState(INITIAL_STATE);
  }, [release]);

  const startSharing = useCallback(async (targetId: string, targetIce: IceServerConfig[]) => {
    if (!socket) return;
    const cfg = latest.current;

    try {
      const host = window.screenShareHost;
      const capture = await captureDisplay(cfg.videoConfig, {
        withAudio: true,
        captureSourceId: cfg.captureSourceId,
        contentHint: contentHintFor(cfg.videoConfig.quality),
      });
      captureStreamRef.current = capture.stream;

      const audio = await BroadcastAudio.create(host);
      audioRef.current = audio;
      if (!host) audio.attachSystemAudio(capture.audioTracks);

      // Falha de áudio não impede a transmissão: o vídeo segue e o erro é exibido
      let audioError: string | null = null;
      try {
        await audio.sync(latest.current.audioSelection);
      } catch (err) {
        audioError = errorMessage(err);
      }

      const combined = new MediaStream([capture.videoTrack, audio.track]);
      streamRef.current = combined;

      // maxViewers 1: o co-apresentador só envia para o host, nunca para outros espectadores
      const broadcaster = new WebRTCBroadcaster(socket, cfg.videoConfig, {
        iceServers: targetIce,
        privacyMode: false,
        maxViewers: 1,
      });
      broadcaster.setLocalStream(combined);
      broadcasterRef.current = broadcaster;
      broadcaster.connectToPeer(targetId);

      // O usuário clicou em "Parar compartilhamento" no seletor nativo
      capture.videoTrack.onended = stopCopresent;

      setState({
        ...INITIAL_STATE,
        isSharing: true,
        stream: new MediaStream(combined.getVideoTracks()),
        error: audioError,
      });
    } catch (err) {
      release();
      setState({ ...INITIAL_STATE, error: toMediaError(err).message });
    }
  }, [socket, release, stopCopresent]);

  // Resposta do host ao pedido de co-apresentação
  useEffect(() => {
    if (!socket) return;
    const onResponse = (data: CopresentResponsePayload) => {
      if (!data.approved) {
        setState((s) => ({ ...s, pendingApproval: false, denied: true }));
        return;
      }
      const targetId = data.hostId ?? latest.current.hostId;
      if (!targetId) {
        setState((s) => ({
          ...s,
          pendingApproval: false,
          error: 'Não foi possível identificar o apresentador.',
        }));
        return;
      }
      setState((s) => ({ ...s, pendingApproval: false, denied: false }));
      void startSharing(targetId, data.iceServers ?? latest.current.iceServers);
    };
    socket.on('room:copresent-response', onResponse);
    return () => {
      socket.off('room:copresent-response', onResponse);
    };
  }, [socket, startSharing]);

  /** Pede ao host para também transmitir */
  const requestCopresent = useCallback(() => {
    if (!socket) {
      setState((s) => ({
        ...s,
        error: 'Não foi possível conectar ao servidor. Recarregue a página e tente novamente.',
      }));
      return;
    }
    setState({ ...INITIAL_STATE, pendingApproval: true });
    const payload: CopresentRequestPayload = { ...latest.current.roomOptions };
    socket.emit('room:request-copresent', payload);
  }, [socket]);

  const togglePause = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setState((s) => ({ ...s, isPaused: !s.isPaused }));
  }, []);

  /** Aplica ao vivo mudanças de qualidade de vídeo */
  const updateVideoConfig = useCallback(async (partial: Partial<VideoConfig>) => {
    await broadcasterRef.current?.updateVideoConfig(partial);
  }, []);

  return { state, requestCopresent, stopCopresent, togglePause, updateVideoConfig };
}
