/**
 * useBroadcast.ts
 *
 * Hook principal do modo apresentador.
 * Gerencia o ciclo de vida completo da transmissão:
 * captura da tela → criação da sala → conexão WebRTC → estatísticas → encerramento.
 *
 * Correções aplicadas:
 *   - Removidos imports não utilizados (parseRTCStats, classifyQuality)
 *   - Race condition corrigida: roomId obtido diretamente do evento, não do state
 *   - Stream exposto via state (reativo) em vez de ref (não reativo)
 *   - Coleta de estatísticas implementada de fato via broadcaster.onStats()
 *   - Encerramento do stream de captura separado do encerramento WebRTC
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../services/SocketContext';
import { WebRTCBroadcaster } from '../services/webrtcService';
import { startScreenCapture, combineStreams, stopStream } from '../services/captureService';
import { AppAudioMixer } from '../services/appAudioMixer';
import type { VideoConfig, AudioConfig, StreamStats, ConnectionState } from '@shared/index';

export interface BroadcastState {
  isSharing: boolean;
  isPaused: boolean;
  roomId: string | null;
  roomCode: string | null;
  inviteUrl: string | null;
  viewerCount: number;
  connectionState: ConnectionState;
  stats: StreamStats | null;
  /** Stream local da captura (para preview no elemento <video>) */
  stream: MediaStream | null;
  error: string | null;
}

const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  width: 1920, height: 1080, frameRate: 30,
  codec: 'H264', bitrate: 4000, quality: 'high',
};

const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  sampleRate: 48000, bitrate: 128, codec: 'opus', sources: [],
};

/**
 * Seleção de áudio por aplicativo (somente app desktop).
 * Os PIDs valem no momento em que a transmissão INICIA: alterar a seleção de
 * apps durante a transmissão não adiciona/remove fontes (fora do escopo).
 * Já volume e mute são refletidos ao vivo no mixer.
 */
export interface AudioSelection {
  pids: number[];
  volumes: Record<number, number>;
  muted: Record<number, boolean>;
}

const EMPTY_AUDIO_SELECTION: AudioSelection = { pids: [], volumes: {}, muted: {} };

export function useBroadcast(
  videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG,
  _audioConfig: AudioConfig = DEFAULT_AUDIO_CONFIG,
  audioSelection: AudioSelection = EMPTY_AUDIO_SELECTION,
  /** (desktop) ID da tela/janela escolhida na interface */
  captureSourceId: string | null = null,
) {
  const { socket } = useSocket();
  const broadcasterRef = useRef<WebRTCBroadcaster | null>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  /** Stream bruto retornado pelo getDisplayMedia (garante parar o vídeo mesmo em erro) */
  const captureStreamRef = useRef<MediaStream | null>(null);
  const mixerRef         = useRef<AppAudioMixer | null>(null);
  const audioStartedRef  = useRef(false);
  const stopSharingRef   = useRef<() => void>(() => undefined);
  /** Sempre com a seleção mais recente (usada em callbacks assíncronos) */
  const audioSelectionRef = useRef(audioSelection);
  audioSelectionRef.current = audioSelection;

  const [state, setState] = useState<BroadcastState>({
    isSharing: false, isPaused: false,
    roomId: null, roomCode: null, inviteUrl: null,
    viewerCount: 0, connectionState: 'disconnected',
    stats: null, stream: null, error: null,
  });

  // Libera recursos ao desmontar o componente
  useEffect(() => {
    return () => cleanupAllRef.current();
  }, []);

  // Reflete volume/mute no mixer ao vivo durante a transmissão
  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;
    for (const pid of audioSelection.pids) {
      mixer.setVolume(pid, audioSelection.volumes[pid] ?? 1);
      mixer.setMuted(pid, audioSelection.muted[pid] ?? false);
    }
  }, [audioSelection]);

  // Escuta eventos do servidor relacionados à sala
  useEffect(() => {
    if (!socket) return;

    socket.on('room:viewer-joined', (data: { viewerCount: number }) => {
      setState((s) => ({ ...s, viewerCount: data.viewerCount }));
    });

    socket.on('room:viewer-left', (data: { viewerCount: number }) => {
      setState((s) => ({ ...s, viewerCount: data.viewerCount }));
    });

    return () => {
      socket.off('room:viewer-joined');
      socket.off('room:viewer-left');
    };
  }, [socket]);

  /** Inicia a captura da tela e o compartilhamento para a sala */
  const startSharing = useCallback(async () => {
    if (!socket) {
      setState((s) => ({
        ...s,
        error: 'Não foi possível conectar ao servidor. Recarregue a página e tente novamente.',
      }));
      return;
    }

    setState((s) => ({ ...s, connectionState: 'connecting', error: null }));

    try {
      // 1. Captura a tela — o navegador abrirá o seletor nativo
      const host = window.screenShareHost;
      const { stream: captureStream, videoTrack, audioTracks } =
        await startScreenCapture(videoConfig, captureSourceId);
      captureStreamRef.current = captureStream;

      let combined: MediaStream;
      const selection = audioSelectionRef.current;
      if (host) {
        // Desktop: o áudio vem do processo nativo (por PID) e é mixado no renderer.
        // Sem nenhum app selecionado, transmite SEM áudio.
        if (selection.pids.length > 0) {
          const mixer = await AppAudioMixer.create();
          mixerRef.current = mixer;
          for (const pid of selection.pids) {
            mixer.addSource(pid);
            mixer.setVolume(pid, selection.volumes[pid] ?? 1);
            mixer.setMuted(pid, selection.muted[pid] ?? false);
          }
          // Marca antes: se start() falhar parcialmente, o cleanup ainda chama stop()
          audioStartedRef.current = true;
          await host.audio.start(selection.pids, (chunk) => mixer.push(chunk));
          combined = new MediaStream([videoTrack, mixer.track]);
        } else {
          combined = new MediaStream([videoTrack]);
        }
      } else {
        // Web: áudio do sistema inteiro vindo do getDisplayMedia
        combined = combineStreams(videoTrack, audioTracks);
      }
      streamRef.current = combined;

      // Atualiza o stream no state para o preview ser reativo
      setState((s) => ({ ...s, stream: combined }));

      // 2. Pede ao servidor para criar uma sala e aguarda a confirmação
      socket.emit('room:create');

      // Aguarda o evento 'room:created' (ou erro) com timeout de 8 segundos
      const roomData = await new Promise<{ roomId: string; code: string; inviteUrl: string }>(
        (resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('O servidor demorou muito para responder. Tente novamente.')),
            8000,
          );
          socket.once('room:created', (data) => { clearTimeout(timeout); resolve(data); });
          socket.once('room:error',   (e)    => { clearTimeout(timeout); reject(new Error(e.message)); });
        },
      );

      // 3. Atualiza o state com os dados da sala recebidos diretamente do evento
      // (evita race condition com state.roomId que ainda seria null nesse momento)
      setState((s) => ({
        ...s,
        roomId: roomData.roomId,
        roomCode: roomData.code,
        inviteUrl: roomData.inviteUrl,
        connectionState: 'connected',
        isSharing: true,
        isPaused: false,
      }));

      // 4. Cria o broadcaster e envia o stream
      const broadcaster = new WebRTCBroadcaster(socket);
      broadcaster.setLocalStream(combined);

      // Registra callback de estatísticas — atualiza o overlay em tempo real
      broadcaster.onStats((stats) => {
        setState((s) => ({ ...s, stats }));
        // Propaga as stats para os espectadores via servidor
        socket.emit('stream:stats', stats);
      });

      broadcasterRef.current = broadcaster;

      // Se o usuário clicar em "Parar" no seletor nativo do browser
      videoTrack.onended = () => stopSharingRef.current();

    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Ocorreu um erro inesperado. Tente novamente.';
      setState((s) => ({ ...s, error: message, connectionState: 'disconnected', stream: null }));
      cleanupAllRef.current();
    }
  }, [socket, videoConfig, captureSourceId]);

  /** Congela ou retoma o vídeo sem encerrar a transmissão */
  const togglePause = useCallback(() => {
    const videoTrack = streamRef.current?.getVideoTracks()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    setState((s) => ({ ...s, isPaused: !s.isPaused }));
  }, []);

  /** Encerra completamente a transmissão e libera todos os recursos */
  const stopSharing = useCallback(() => {
    socket?.emit('room:leave');
    cleanupAllRef.current();
    setState({
      isSharing: false, isPaused: false,
      roomId: null, roomCode: null, inviteUrl: null,
      viewerCount: 0, connectionState: 'disconnected',
      stats: null, stream: null, error: null,
    });
  }, [socket]);

  stopSharingRef.current = stopSharing;

  // useRef para a função de limpeza evita avisos de dependência nos useCallbacks
  const cleanupAllRef = useRef(() => {
    broadcasterRef.current?.destroy();
    broadcasterRef.current = null;

    // Para a captura nativa de áudio e libera o mixer (se existirem)
    if (audioStartedRef.current) {
      audioStartedRef.current = false;
      window.screenShareHost?.audio.stop().catch(() => undefined);
    }
    if (mixerRef.current) {
      void mixerRef.current.destroy();
      mixerRef.current = null;
    }

    stopStream(streamRef.current);
    streamRef.current = null;
    stopStream(captureStreamRef.current);
    captureStreamRef.current = null;
  });

  return { state, startSharing, stopSharing, togglePause };
}
