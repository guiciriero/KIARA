/**
 * Hook do apresentador: captura → sala → WebRTC → estatísticas → encerramento.
 *
 * O áudio passa sempre por um BroadcastAudio, cuja faixa de saída é criada no início e
 * nunca trocada. Mudar a seleção de fontes durante a live só altera o grafo de áudio
 * atrás dessa faixa — não há replaceTrack nem renegociação.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../services/SocketContext';
import { WebRTCBroadcaster } from '../services/webrtcService';
import { captureDisplay, stopStream } from '../services/captureService';
import { BroadcastAudio } from '../services/broadcastAudio';
import type { AudioSelectionItem } from '../services/broadcastAudio';
import { addJoinRequest, removeJoinRequest } from '../utils/joinRequests';
import { isCancellation, toMediaError } from '../services/mediaError';
import type {
  VideoConfig,
  StreamStats,
  ConnectionState,
  CreateRoomPayload,
  RoomCreatedPayload,
  RoomErrorPayload,
  JoinRequestPayload,
  RespondJoinPayload,
} from '@shared/index';

export type { AudioSelectionItem };

export interface BroadcastState {
  isSharing: boolean;
  isPaused: boolean;
  roomId: string | null;
  roomCode: string | null;
  inviteUrl: string | null;
  viewerCount: number;
  connectionState: ConnectionState;
  stats: StreamStats | null;
  /** Cópia só de vídeo da captura, para o preview local */
  stream: MediaStream | null;
  error: string | null;
  /** Fontes de áudio realmente roteadas (verdade do mixer, não da interface) */
  activeAudioIds: string[];
  /** Incrementa a cada falha de sincronização, para a interface reconciliar a seleção */
  audioFailures: number;
  /** Limite de espectadores da sala (0 antes da sala existir) */
  maxViewers: number;
  /** O que o servidor atendeu de fato (não o que foi pedido) */
  hasPassword: boolean;
  requireApproval: boolean;
  privacyMode: boolean;
  /** Espectadores aguardando aprovação (salas com aprovação) */
  pendingRequests: JoinRequestPayload[];
}

const ROOM_TIMEOUT_MS = 8000;

const INITIAL_STATE: BroadcastState = {
  isSharing: false, isPaused: false,
  roomId: null, roomCode: null, inviteUrl: null,
  viewerCount: 0, connectionState: 'disconnected',
  stats: null, stream: null, error: null,
  activeAudioIds: [], audioFailures: 0,
  maxViewers: 0, hasPassword: false, requireApproval: false, privacyMode: false,
  pendingRequests: [],
};

type AppSocket = NonNullable<ReturnType<typeof useSocket>['socket']>;

function requestRoom(socket: AppSocket, options?: CreateRoomPayload): Promise<RoomCreatedPayload> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      socket.off('room:created', onCreated);
      socket.off('room:error', onError);
    };
    const onCreated = (data: RoomCreatedPayload) => { done(); resolve(data); };
    const onError = (e: RoomErrorPayload) => { done(); reject(new Error(e.message)); };
    const timer = setTimeout(() => {
      done();
      reject(new Error('O servidor demorou muito para responder. Tente novamente.'));
    }, ROOM_TIMEOUT_MS);

    socket.on('room:created', onCreated);
    socket.on('room:error', onError);
    socket.emit('room:create', options ?? {});
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Ocorreu um erro inesperado. Tente novamente.';
}

export function useBroadcast(
  videoConfig: VideoConfig,
  audioSelection: AudioSelectionItem[],
  /** (desktop) ID da tela/janela escolhida na interface */
  captureSourceId: string | null,
  /** Opções da sala: senha, aprovação, modo privacidade */
  roomOptions?: CreateRoomPayload,
) {
  const { socket } = useSocket();
  const broadcasterRef = useRef<WebRTCBroadcaster | null>(null);
  const audioRef = useRef<BroadcastAudio | null>(null);
  /** Stream enviado ao WebRTC (vídeo + faixa estável do mixer) */
  const streamRef = useRef<MediaStream | null>(null);
  /** Stream bruto do getDisplayMedia; guarda as faixas de áudio do sistema no modo web */
  const captureStreamRef = useRef<MediaStream | null>(null);
  const selectionRef = useRef(audioSelection);
  selectionRef.current = audioSelection;
  const roomOptionsRef = useRef(roomOptions);
  roomOptionsRef.current = roomOptions;

  const [state, setState] = useState<BroadcastState>(INITIAL_STATE);

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
    let cancelled = false;

    audio.sync(audioSelection).then(
      () => {
        if (!cancelled) setState((s) => ({ ...s, activeAudioIds: audio.activeIds }));
      },
      (err) => {
        if (cancelled) return;
        setState((s) => ({
          ...s,
          error: errorMessage(err),
          activeAudioIds: audio.activeIds,
          audioFailures: s.audioFailures + 1,
        }));
      },
    );
    return () => { cancelled = true; };
  }, [audioSelection]);

  useEffect(() => {
    if (!socket) return;
    const onJoined = (data: { viewerCount: number }) => {
      setState((s) => ({ ...s, viewerCount: data.viewerCount }));
    };
    const onLeft = (data: { viewerId?: string; viewerCount: number }) => {
      setState((s) => ({
        ...s,
        viewerCount: data.viewerCount,
        pendingRequests: removeJoinRequest(s.pendingRequests, data.viewerId),
      }));
    };
    const onJoinRequest = (req: JoinRequestPayload) => {
      setState((s) => ({ ...s, pendingRequests: addJoinRequest(s.pendingRequests, req) }));
    };
    const onJoinCancelled = (data: { viewerId: string }) => {
      setState((s) => ({
        ...s,
        pendingRequests: removeJoinRequest(s.pendingRequests, data.viewerId),
      }));
    };
    socket.on('room:viewer-joined', onJoined);
    socket.on('room:viewer-left', onLeft);
    socket.on('room:join-request', onJoinRequest);
    socket.on('room:join-cancelled', onJoinCancelled);
    return () => {
      socket.off('room:viewer-joined', onJoined);
      socket.off('room:viewer-left', onLeft);
      socket.off('room:join-request', onJoinRequest);
      socket.off('room:join-cancelled', onJoinCancelled);
    };
  }, [socket]);

  const stopSharing = useCallback(() => {
    socket?.emit('room:leave');
    release();
    setState(INITIAL_STATE);
  }, [socket, release]);

  /** Aprova ou recusa um espectador que aguarda entrada */
  const respondJoin = useCallback(
    (viewerId: string, approved: boolean) => {
      const payload: RespondJoinPayload = { viewerId, approved };
      socket?.emit('room:respond-join', payload);
      setState((s) => ({ ...s, pendingRequests: removeJoinRequest(s.pendingRequests, viewerId) }));
    },
    [socket],
  );

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
      const host = window.screenShareHost;
      const capture = await captureDisplay(videoConfig, { withAudio: true, captureSourceId });
      captureStreamRef.current = capture.stream;

      const audio = await BroadcastAudio.create(host);
      audioRef.current = audio;
      if (!host) audio.attachSystemAudio(capture.audioTracks);

      // Falha de áudio não impede a live: o vídeo segue e o erro é exibido
      let audioError: string | null = null;
      let audioFailed = false;
      try {
        await audio.sync(selectionRef.current);
      } catch (err) {
        audioError = errorMessage(err);
        audioFailed = true;
      }

      const combined = new MediaStream([capture.videoTrack, audio.track]);
      streamRef.current = combined;
      setState((s) => ({
        ...s,
        stream: new MediaStream(combined.getVideoTracks()),
        activeAudioIds: audio.activeIds,
        audioFailures: audioFailed ? s.audioFailures + 1 : s.audioFailures,
        error: audioError,
      }));

      const room = await requestRoom(socket, roomOptionsRef.current);
      setState((s) => ({
        ...s,
        roomId: room.roomId,
        roomCode: room.code,
        inviteUrl: room.inviteUrl,
        maxViewers: room.maxViewers,
        hasPassword: room.hasPassword,
        requireApproval: room.requireApproval,
        privacyMode: room.privacyMode,
        pendingRequests: [],
        connectionState: 'connected',
        isSharing: true,
        isPaused: false,
      }));

      const broadcaster = new WebRTCBroadcaster(socket, videoConfig, {
        iceServers: room.iceServers,
        privacyMode: room.privacyMode,
        maxViewers: room.maxViewers,
      });
      broadcaster.setLocalStream(combined);
      broadcaster.onStats((stats) => {
        setState((s) => ({ ...s, stats }));
        socket.emit('stream:stats', stats);
      });
      broadcasterRef.current = broadcaster;

      // O usuário clicou em "Parar compartilhamento" no seletor nativo
      capture.videoTrack.onended = stopSharing;
    } catch (err) {
      release();
      setState((s) => ({
        ...s,
        error: toMediaError(err).message,
        connectionState: 'disconnected',
        stream: null,
      }));
    }
  }, [socket, videoConfig, captureSourceId, release, stopSharing]);

  const togglePause = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setState((s) => ({ ...s, isPaused: !s.isPaused }));
  }, []);

  /** Troca a tela ou janela sem derrubar a sala nem o áudio */
  const changeCaptureSource = useCallback(async (newSourceId?: string | null) => {
    const broadcaster = broadcasterRef.current;
    if (!broadcaster) return;

    try {
      const { videoTrack } = await captureDisplay(videoConfig, {
        withAudio: false,
        captureSourceId: newSourceId ?? captureSourceId,
      });
      // O broadcaster troca a faixa no stream compartilhado e para a antiga
      await broadcaster.replaceVideoTrack(videoTrack);
      videoTrack.onended = stopSharing;

      const current = streamRef.current;
      if (current) {
        setState((s) => ({ ...s, stream: new MediaStream(current.getVideoTracks()) }));
      }
    } catch (err) {
      // Cancelar o seletor mantém a transmissão atual intacta
      if (isCancellation(err)) return;
      setState((s) => ({ ...s, error: toMediaError(err).message }));
    }
  }, [videoConfig, captureSourceId, stopSharing]);

  const updateVideoConfig = useCallback(async (partial: Partial<VideoConfig>) => {
    await broadcasterRef.current?.updateVideoConfig(partial);
  }, []);

  return { state, startSharing, stopSharing, togglePause, changeCaptureSource, updateVideoConfig, respondJoin };
}
