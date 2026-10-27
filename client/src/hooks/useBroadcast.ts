/**
 * Hook do apresentador: captura → sala → WebRTC → estatísticas → encerramento.
 *
 * O áudio passa sempre por um BroadcastAudio, cuja faixa de saída é criada no início e
 * nunca trocada. Mudar a seleção de fontes durante a live só altera o grafo de áudio
 * atrás dessa faixa — não há replaceTrack nem renegociação.
 *
 * Link fixo: o código da sala vem sempre de utils/permanentRoom (localStorage) e é enviado ao
 * servidor como `preferredCode`. Não há código alternativo: o apresentador usa sempre o mesmo link.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../services/SocketContext';
import { WebRTCBroadcaster } from '../services/webrtcService';
import { captureDisplay, stopStream, contentHintForQuality } from '../services/captureService';
import { getCaptureEndReason } from '../services/nativeCapture';
import { BroadcastAudio } from '../services/broadcastAudio';
import type { AudioSelectionItem } from '../services/broadcastAudio';
import { addJoinRequest, removeJoinRequest } from '../utils/joinRequests';
import { isCancellation, toMediaError, getErrorMessage } from '../services/mediaError';
import { getOrCreatePermanentRoomCode, savePermanentRoomCode } from '../utils/permanentRoom';
import { deriveE2eeKeys } from '../utils/e2eeCrypto';
import type { E2eeKeys } from '../utils/e2eeCrypto';
import { E2eeSession, isE2eeSupported } from '../services/e2ee';
import { addViewer, removeViewer, renameViewer } from '../utils/viewerList';
import type { ViewerItem } from '../utils/viewerList';
import type {
  KickViewerPayload,
  ResumeRoomPayload,
  RoomResumedPayload,
  ViewerJoinedPayload,
  ViewerRenamedPayload,
  VideoConfig,
  StreamStats,
  ConnectionState,
  CreateRoomPayload,
  RoomCreatedPayload,
  RoomErrorPayload,
  IceServerConfig,
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
  /** Servidores ICE da sala; reutilizados para receber a tela do co-apresentador */
  iceServers: IceServerConfig[];
  /** Espectadores conectados (id + apelido) */
  viewers: ViewerItem[];
  /** O código fixo pedido estava em uso e o servidor gerou outro */
  codeChanged: boolean;
  /** Sessão de criptografia de ponta a ponta (null = sala sem E2EE); reutilizada para receber o co-apresentador */
  e2ee: E2eeSession | null;
}

const ROOM_TIMEOUT_MS = 8000;
const RESUME_TIMEOUT_MS = 10000;
const NO_ICE_SERVERS: IceServerConfig[] = [];

const INITIAL_STATE: BroadcastState = {
  isSharing: false, isPaused: false,
  roomId: null, roomCode: null, inviteUrl: null,
  viewerCount: 0, connectionState: 'disconnected',
  stats: null, stream: null, error: null,
  activeAudioIds: [], audioFailures: 0,
  maxViewers: 0, hasPassword: false, requireApproval: false, privacyMode: false,
  pendingRequests: [],
  iceServers: NO_ICE_SERVERS,
  viewers: [], codeChanged: false, e2ee: null,
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

/**
 * Cria a sala. Em sala E2EE, a senha digitada NUNCA vai ao servidor: ela vira um token de entrada
 * (campo `password`) e uma chave de mídia que fica só aqui. O sal da derivação inclui o código da
 * sala; se o servidor atribuir outro código, a derivação é refeita com ele.
 */
async function createRoomWithKeys(
  socket: AppSocket,
  options: CreateRoomPayload | undefined,
  initialCode: string,
): Promise<{ room: RoomCreatedPayload; keys: E2eeKeys | null }> {
  const wantsE2ee = Boolean(options?.e2ee);
  if (!wantsE2ee) {
    return { room: await requestRoom(socket, { ...options, preferredCode: initialCode }), keys: null };
  }
  if (!options?.password) throw new Error('A criptografia de ponta a ponta exige uma senha.');
  if (!isE2eeSupported()) {
    throw new Error('Este navegador não suporta criptografia de ponta a ponta. Use o Chrome, o Edge ou o app para Windows.');
  }

  let code = initialCode;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const keys = await deriveE2eeKeys(options.password, code);
    const room = await requestRoom(socket, { ...options, password: keys.entryToken, preferredCode: code });
    // Fail-closed: sem confirmação do servidor a sala não seria E2EE de fato
    if (!room.e2ee) {
      socket.emit('room:leave');
      throw new Error('O servidor não confirmou a criptografia de ponta a ponta. A transmissão não foi iniciada.');
    }
    if (!room.codeChanged) return { room, keys };
    socket.emit('room:leave');
    code = room.code;
    savePermanentRoomCode(code);
  }
  throw new Error('Não foi possível reservar o código da sala. Tente novamente.');
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
  /** Credenciais da sala ativa: só em memória (nunca localStorage, logs ou URL) */
  const credentialsRef = useRef<ResumeRoomPayload | null>(null);
  const e2eeRef = useRef<E2eeSession | null>(null);

  const [state, setState] = useState<BroadcastState>(INITIAL_STATE);

  const release = useCallback(() => {
    credentialsRef.current = null;
    broadcasterRef.current?.destroy();
    broadcasterRef.current = null;
    e2eeRef.current?.destroy();
    e2eeRef.current = null;

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
          error: getErrorMessage(err),
          activeAudioIds: audio.activeIds,
          audioFailures: s.audioFailures + 1,
        }));
      },
    );
    return () => { cancelled = true; };
  }, [audioSelection]);

  useEffect(() => {
    if (!socket) return;
    const onJoined = (data: ViewerJoinedPayload) => {
      setState((s) => ({
        ...s,
        viewerCount: data.viewerCount,
        viewers: addViewer(s.viewers, { id: data.viewerId, name: data.name }),
      }));
    };
    const onLeft = (data: { viewerId?: string; viewerCount: number }) => {
      setState((s) => ({
        ...s,
        viewerCount: data.viewerCount,
        viewers: removeViewer(s.viewers, data.viewerId),
        pendingRequests: removeJoinRequest(s.pendingRequests, data.viewerId),
      }));
    };
    const onRenamed = (data: ViewerRenamedPayload) => {
      setState((s) => ({ ...s, viewers: renameViewer(s.viewers, data.viewerId, data.name) }));
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
    socket.on('room:viewer-renamed', onRenamed);
    socket.on('room:join-request', onJoinRequest);
    socket.on('room:join-cancelled', onJoinCancelled);
    return () => {
      socket.off('room:viewer-joined', onJoined);
      socket.off('room:viewer-left', onLeft);
      socket.off('room:viewer-renamed', onRenamed);
      socket.off('room:join-request', onJoinRequest);
      socket.off('room:join-cancelled', onJoinCancelled);
    };
  }, [socket]);

  const stopSharing = useCallback(() => {
    socket?.emit('room:leave');
    release();
    setState(INITIAL_STATE);
  }, [socket, release]);

  // Reconexão do apresentador: ao voltar a conexão com a live ativa, retoma a sala com o hostToken
  useEffect(() => {
    if (!socket) return;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    let resuming = false;

    const clearResume = () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = null;
      resuming = false;
    };
    const failResume = (message: string) => {
      clearResume();
      release();
      setState({ ...INITIAL_STATE, error: message });
    };

    const onDisconnect = () => {
      if (!credentialsRef.current) return;
      setState((s) => ({ ...s, connectionState: 'reconnecting' }));
    };
    const onConnect = () => {
      const credentials = credentialsRef.current;
      if (!credentials) return;
      resuming = true;
      socket.emit('room:resume', credentials);
      resumeTimer = setTimeout(
        () => failResume('Não foi possível retomar a transmissão após a queda de conexão. A live foi encerrada.'),
        RESUME_TIMEOUT_MS,
      );
    };
    const onResumed = (data: RoomResumedPayload) => {
      if (!resuming || !credentialsRef.current) return;
      clearResume();
      setState((s) => ({
        ...s,
        connectionState: 'connected',
        viewerCount: data.viewerCount,
        iceServers: data.iceServers,
        error: null,
      }));
      broadcasterRef.current?.onSignalingResumed();
    };
    const onRoomError = (e: RoomErrorPayload) => {
      if (!resuming) return;
      failResume(
        e.code === 'not-found' || e.code === 'closed'
          ? 'A sala expirou durante a queda de conexão. A live foi encerrada.'
          : 'Não foi possível retomar a transmissão após a queda de conexão. A live foi encerrada.',
      );
    };

    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);
    socket.on('room:resumed', onResumed);
    socket.on('room:error', onRoomError);
    return () => {
      clearResume();
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
      socket.off('room:resumed', onResumed);
      socket.off('room:error', onRoomError);
    };
  }, [socket, release]);

  /** Expulsa (ou bane, por IP) um espectador */
  const kickViewer = useCallback(
    (viewerId: string, ban = false) => {
      const payload: KickViewerPayload = { viewerId, ban };
      socket?.emit('room:kick-viewer', payload);
      setState((s) => ({ ...s, viewers: removeViewer(s.viewers, viewerId) }));
    },
    [socket],
  );

  // A faixa de vídeo terminou. Se foi a captura nativa que caiu (alt-tab, troca de modo de vídeo...), a live
  // continua: troca para o getDisplayMedia sem derrubar a sala. Se foi o usuário (ou o fallback também falhou), encerra.
  const swapToDisplayMediaRef = useRef<() => Promise<boolean>>(async () => false);
  const handleVideoEnded = useCallback(
    (track: MediaStreamTrack) => () => {
      if (!getCaptureEndReason(track) || !broadcasterRef.current) {
        stopSharing();
        return;
      }
      void swapToDisplayMediaRef.current().then((ok) => {
        if (!ok) stopSharing();
      });
    },
    [stopSharing],
  );

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
      const capture = await captureDisplay(videoConfig, {
        withAudio: true,
        captureSourceId,
        contentHint: contentHintForQuality(videoConfig.quality),
      });
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
        audioError = getErrorMessage(err);
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

      // Link fixo: sempre pede o mesmo código ao servidor
      const { room, keys } = await createRoomWithKeys(
        socket,
        roomOptionsRef.current,
        getOrCreatePermanentRoomCode(),
      );
      credentialsRef.current = { roomId: room.roomId, hostToken: room.hostToken };
      if (room.codeChanged) savePermanentRoomCode(room.code);
      const e2ee = keys ? new E2eeSession(keys.mediaKey) : null;
      e2eeRef.current = e2ee;

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
        viewers: [],
        codeChanged: room.codeChanged === true,
        iceServers: room.iceServers,
        e2ee,
        connectionState: 'connected',
        isSharing: true,
        isPaused: false,
      }));

      const broadcaster = new WebRTCBroadcaster(socket, videoConfig, {
        iceServers: room.iceServers,
        privacyMode: room.privacyMode,
        maxViewers: room.maxViewers,
        e2ee: e2ee ?? undefined,
      });
      broadcaster.setLocalStream(combined);
      broadcaster.onStats((stats) => {
        setState((s) => ({ ...s, stats }));
        socket.emit('stream:stats', stats);
      });
      broadcasterRef.current = broadcaster;

      // O usuário clicou em "Parar compartilhamento" no seletor nativo
      capture.videoTrack.onended = handleVideoEnded(capture.videoTrack);
    } catch (err) {
      release();
      setState((s) => ({
        ...s,
        error: toMediaError(err).message,
        connectionState: 'disconnected',
        stream: null,
      }));
    }
  }, [socket, videoConfig, captureSourceId, release, handleVideoEnded]);

  const togglePause = useCallback(() => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setState((s) => ({ ...s, isPaused: !s.isPaused }));
  }, []);

  /** Troca a tela ou janela sem derrubar a sala nem o áudio. Devolve true se a troca foi feita. */
  const changeCaptureSource = useCallback(async (newSourceId?: string | null, preferNative = true): Promise<boolean> => {
    const broadcaster = broadcasterRef.current;
    if (!broadcaster) return false;

    try {
      const { videoTrack } = await captureDisplay(videoConfig, {
        withAudio: false,
        captureSourceId: newSourceId ?? captureSourceId,
        contentHint: contentHintForQuality(videoConfig.quality),
        preferNative,
      });
      // O broadcaster troca a faixa no stream compartilhado e para a antiga
      await broadcaster.replaceVideoTrack(videoTrack);
      videoTrack.onended = handleVideoEnded(videoTrack);

      const current = streamRef.current;
      if (current) {
        setState((s) => ({ ...s, stream: new MediaStream(current.getVideoTracks()) }));
      }
      return true;
    } catch (err) {
      // Cancelar o seletor mantém a transmissão atual intacta
      if (!isCancellation(err)) setState((s) => ({ ...s, error: toMediaError(err).message }));
      return false;
    }
  }, [videoConfig, captureSourceId, handleVideoEnded]);

  swapToDisplayMediaRef.current = () => changeCaptureSource(undefined, false);

  const updateVideoConfig = useCallback(async (partial: Partial<VideoConfig>) => {
    await broadcasterRef.current?.updateVideoConfig(partial);
  }, []);

  return {
    state,
    startSharing,
    stopSharing,
    togglePause,
    changeCaptureSource,
    updateVideoConfig,
    respondJoin,
    kickViewer,
    /** Stream combinado (vídeo + faixa do mixer), usado pela gravação local */
    getCombinedStream: () => streamRef.current,
  };
}
