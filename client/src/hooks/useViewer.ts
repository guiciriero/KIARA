/**
 * useViewer.ts
 * Hook para o modo espectador.
 * Gerencia: entrada na sala (senha/aprovação) → WebRTC → stream → reconexão automática.
 * A lógica de estados fica em viewerReducer.ts e o backoff em utils/reconnector.ts.
 */

import { useReducer, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../services/SocketContext';
import { WebRTCViewer } from '../services/webrtcService';
import { detectViewerHwDecode } from '../services/codecSelection';
import { createReconnector } from '../utils/reconnector';
import type { Reconnector } from '../utils/reconnector';
import { viewerReducer, INITIAL_VIEWER_STATE, isPasswordError } from './viewerReducer';
import type {
  StreamStats,
  ViewerQualityPreference,
  QualityRequestPayload,
  JoinRoomPayload,
  RoomJoinedPayload,
  RoomErrorPayload,
} from '@shared/index';

export type { ViewerState } from './viewerReducer';

const NAME_STORAGE_KEY = 'kiara:name';

export interface JoinOptions {
  password?: string;
  name?: string;
}

function readStoredName(): string | undefined {
  try {
    return localStorage.getItem(NAME_STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

function storeName(name: string): void {
  try {
    localStorage.setItem(NAME_STORAGE_KEY, name);
  } catch {
    // armazenamento indisponível: o nome vale só para esta sessão
  }
}

/** Alvo de altura e bitrate de cada preferência de qualidade */
function qualityLimits(pref: ViewerQualityPreference): { targetHeight: number | null; maxBitrateKbps: number | null } {
  switch (pref) {
    case '1080p': return { targetHeight: 1080, maxBitrateKbps: 8000 };
    case '720p':  return { targetHeight: 720, maxBitrateKbps: 4000 };
    case '480p':  return { targetHeight: 480, maxBitrateKbps: 1800 };
    case '360p':  return { targetHeight: 360, maxBitrateKbps: 1000 };
    case 'auto':
    default:      return { targetHeight: null, maxBitrateKbps: null };
  }
}

export function useViewer(roomCode: string | undefined) {
  const { socket } = useSocket();
  const [state, dispatch] = useReducer(viewerReducer, INITIAL_VIEWER_STATE);

  const viewerRef = useRef<WebRTCViewer | null>(null);
  const reconnectorRef = useRef<Reconnector | null>(null);
  /** Senha/nome já informados, reutilizados nas reconexões */
  const credsRef = useRef<JoinOptions>({});
  /** true entre o primeiro room:join e o leaveRoom/cleanup */
  const sessionRef = useRef(false);
  /** Envia room:join com as credenciais atuais (definida pelo efeito) */
  const sendJoinRef = useRef<(() => void) | null>(null);

  const destroyViewer = useCallback(() => {
    viewerRef.current?.destroy();
    viewerRef.current = null;
  }, []);

  useEffect(() => {
    if (!socket || !roomCode) return;
    let wasDisconnected = false;
    let cancelled = false;

    // Informa ao apresentador quais codecs este navegador decodifica por hardware (para o modo 'auto').
    // A detecção é única e em cache; no pior caso (timeout) o join segue sem o campo.
    const sendJoin = () => {
      void detectViewerHwDecode().then((hwDecode) => {
        if (cancelled) return;
        const payload: JoinRoomPayload = { code: roomCode };
        if (credsRef.current.password) payload.password = credsRef.current.password;
        if (credsRef.current.name) payload.name = credsRef.current.name;
        if (hwDecode) payload.hwDecode = hwDecode;
        socket.emit('room:join', payload);
      });
    };
    sendJoinRef.current = sendJoin;

    const reconnector = createReconnector({
      // Com o socket fora do ar o emit só ficaria no buffer; o 'connect' reenvia
      send: () => { if (socket.connected) sendJoin(); },
      onExhausted: () => {
        destroyViewer();
        dispatch({ type: 'reconnect-exhausted' });
      },
    });
    reconnectorRef.current = reconnector;

    const onJoined = (data: RoomJoinedPayload) => {
      reconnector.reset();
      dispatch({
        type: 'joined',
        viewerCount: data.viewerCount,
        hostId: data.hostId,
        iceServers: data.iceServers,
      });

      // Nunca dois WebRTCViewer ao mesmo tempo
      destroyViewer();
      const viewer = new WebRTCViewer(socket, data.hostId, data.iceServers);
      viewer.onStream((stream) => dispatch({ type: 'stream', stream }));
      viewerRef.current = viewer;
    };

    const onPendingApproval = () => dispatch({ type: 'pending-approval' });

    const onError = (data: RoomErrorPayload) => {
      // Qualquer erro encerra o ciclo de reconexão; senha apenas espera o usuário
      reconnector.cancel();
      if (!isPasswordError(data.code)) destroyViewer();
      dispatch({ type: 'error', message: data.message, code: data.code });
    };

    const onHostDisconnected = () => {
      reconnector.cancel();
      sessionRef.current = false;
      destroyViewer();
      dispatch({ type: 'host-disconnected' });
    };

    const onStats = (stats: StreamStats) => dispatch({ type: 'stats', stats });

    const onDisconnect = () => {
      if (!sessionRef.current) return;
      wasDisconnected = true;
      dispatch({ type: 'socket-disconnected' });
      reconnector.onDisconnect();
    };

    const onConnect = () => {
      // O 'connect' inicial não conta: o join do mount já está no buffer do socket
      if (!wasDisconnected || !sessionRef.current) return;
      wasDisconnected = false;
      reconnector.onConnect();
    };

    socket.on('room:joined', onJoined);
    socket.on('room:pending-approval', onPendingApproval);
    socket.on('room:error', onError);
    socket.on('room:host-disconnected', onHostDisconnected);
    socket.on('stream:stats', onStats);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);

    // Entrada automática, com o apelido salvo (se houver)
    credsRef.current = { name: readStoredName() };
    sessionRef.current = true;
    dispatch({ type: 'joining' });
    sendJoin();

    return () => {
      cancelled = true;
      socket.off('room:joined', onJoined);
      socket.off('room:pending-approval', onPendingApproval);
      socket.off('room:error', onError);
      socket.off('room:host-disconnected', onHostDisconnected);
      socket.off('stream:stats', onStats);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', onConnect);
      reconnector.cancel();
      reconnectorRef.current = null;
      sendJoinRef.current = null;
      sessionRef.current = false;
      destroyViewer();
    };
  }, [socket, roomCode, destroyViewer]);

  /** (Re)envia a entrada na sala, p. ex. com a senha digitada pelo espectador */
  const join = useCallback((opts: JoinOptions = {}) => {
    if (!sendJoinRef.current) return;
    if (opts.password !== undefined) credsRef.current.password = opts.password;
    if (opts.name !== undefined) {
      credsRef.current.name = opts.name;
      storeName(opts.name);
    }
    sessionRef.current = true;
    dispatch({ type: 'joining' });
    sendJoinRef.current();
  }, []);

  /** Define a preferência de resolução individual do espectador */
  const setQuality = useCallback(
    (pref: ViewerQualityPreference) => {
      dispatch({ type: 'quality', preference: pref });
      const payload: QualityRequestPayload = { ...qualityLimits(pref), preference: pref };
      socket?.emit('stream:quality-request', payload);
    },
    [socket],
  );

  /** Atualiza o apelido do espectador localmente e no servidor */
  const updateName = useCallback(
    (name: string) => {
      credsRef.current.name = name;
      storeName(name);
      socket?.emit('room:set-name', { name });
    },
    [socket],
  );

  /** Sai da sala voluntariamente */
  const leaveRoom = useCallback(() => {
    sessionRef.current = false;
    reconnectorRef.current?.cancel();
    socket?.emit('room:leave');
    destroyViewer();
    dispatch({ type: 'reset' });
  }, [socket, destroyViewer]);

  return { state, leaveRoom, setQuality, join, updateName, storedName: readStoredName() };
}
