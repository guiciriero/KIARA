/**
 * useViewer.ts
 * Hook para o modo espectador.
 * Gerencia: entrada na sala (senha/aprovação) → WebRTC → stream → reconexão automática.
 * A lógica de estados fica em viewerReducer.ts e o backoff em utils/reconnector.ts.
 */

import { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import { useSocket } from '../services/SocketContext';
import { WebRTCViewer } from '../services/webrtcService';
import { detectViewerHwDecode } from '../services/codecSelection';
import { E2eeSession, isE2eeSupported } from '../services/e2ee';
import { deriveE2eeKeys } from '../utils/e2eeCrypto';
import type { E2eeKeys } from '../utils/e2eeCrypto';
import { createReconnector } from '../utils/reconnector';
import type { Reconnector } from '../utils/reconnector';
import { viewerReducer, INITIAL_VIEWER_STATE, isPasswordError, isRemovalError } from './viewerReducer';
import type {
  StreamStats,
  ViewerQualityPreference,
  QualityRequestPayload,
  JoinRoomPayload,
  RoomJoinedPayload,
  RoomErrorPayload,
  HostResumedPayload,
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

const E2EE_UNSUPPORTED_MESSAGE =
  'Esta sala usa criptografia de ponta a ponta, que este navegador não suporta. Use o Chrome, o Edge ou o app para Windows. Por segurança, a transmissão não é exibida sem cifra.';

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
  /** Última preferência de qualidade escolhida (reenviada a cada room:joined, inclusive nas reconexões) */
  const qualityRef = useRef<ViewerQualityPreference>('1080p');
  /** A sala é E2EE (anunciado pelo servidor no password-required): a senha vira token + chave */
  const e2eeRoomRef = useRef(false);
  /** Chaves derivadas da senha digitada; a senha em si não é guardada */
  const keysRef = useRef<E2eeKeys | null>(null);
  const e2eeSessionRef = useRef<E2eeSession | null>(null);
  /** Chave de mídia da sala E2EE (também usada pelo co-apresentador); null em sala comum */
  const [mediaKey, setMediaKey] = useState<CryptoKey | null>(null);

  const destroyViewer = useCallback(() => {
    viewerRef.current?.destroy();
    viewerRef.current = null;
    e2eeSessionRef.current?.destroy();
    e2eeSessionRef.current = null;
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

      // Nunca dois WebRTCViewer ao mesmo tempo
      destroyViewer();

      // Sala E2EE: sem chave ou sem suporte do navegador, recusa. Nunca assiste em silêncio sem cifra.
      let e2ee: E2eeSession | undefined;
      if (data.e2ee) {
        try {
          if (!keysRef.current || !isE2eeSupported()) throw new Error(E2EE_UNSUPPORTED_MESSAGE);
          e2ee = new E2eeSession(keysRef.current.mediaKey);
          e2eeSessionRef.current = e2ee;
          setMediaKey(keysRef.current.mediaKey);
        } catch (err) {
          sessionRef.current = false;
          reconnector.cancel();
          socket.emit('room:leave');
          dispatch({
            type: 'error',
            message: err instanceof Error ? err.message : E2EE_UNSUPPORTED_MESSAGE,
            code: 'internal',
            e2ee: true,
          });
          return;
        }
      } else {
        setMediaKey(null);
      }

      dispatch({
        type: 'joined',
        viewerCount: data.viewerCount,
        hostId: data.hostId,
        iceServers: data.iceServers,
        e2ee: Boolean(data.e2ee),
      });

      // Notifica o apresentador da preferência atual (padrão 1080p)
      const preference = qualityRef.current;
      socket.emit('stream:quality-request', { ...qualityLimits(preference), preference });

      const viewer = new WebRTCViewer(socket, data.hostId, data.iceServers, e2ee);
      viewer.onStream((stream) => dispatch({ type: 'stream', stream }));
      viewer.onVideoStatus((ok) => {
        if (cancelled || viewerRef.current !== viewer) return;
        if (ok) return;
        // Se após o timeout nenhum frame de vídeo foi recebido, reenvia a solicitação de qualidade
        // para pedir novo keyframe ao apresentador sem destruir a conexão nem piscar a tela com loading
        if (sessionRef.current) {
          const pref = qualityRef.current;
          socket.emit('stream:quality-request', { ...qualityLimits(pref), preference: pref });
        }
      });
      viewerRef.current = viewer;
    };

    const onPendingApproval = () => dispatch({ type: 'pending-approval' });

    const onError = (data: RoomErrorPayload) => {
      // Qualquer erro encerra o ciclo de reconexão; senha apenas espera o usuário
      reconnector.cancel();
      if (!isPasswordError(data.code)) destroyViewer();
      // Removido/banido pelo apresentador: encerra a sessão para que nenhuma reconexão reenvie o join
      if (isRemovalError(data.code)) sessionRef.current = false;
      if (data.e2ee) {
        e2eeRoomRef.current = true;
        // Navegador sem suporte: recusa já, em vez de pedir uma senha que não adiantaria
        if (!isE2eeSupported()) {
          sessionRef.current = false;
          dispatch({ type: 'error', message: E2EE_UNSUPPORTED_MESSAGE, code: 'internal', e2ee: true });
          return;
        }
      }
      dispatch({ type: 'error', message: data.message, code: data.code, e2ee: data.e2ee });
    };

    // O apresentador caiu, mas a sala aguarda a volta dele: mantém o vídeo e a sessão
    const onHostReconnecting = () => dispatch({ type: 'host-reconnecting' });

    const onHostResumed = (data: HostResumedPayload) => {
      dispatch({ type: 'host-resumed', hostId: data.hostId });
      viewerRef.current?.setHostId(data.hostId);
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
    socket.on('room:host-reconnecting', onHostReconnecting);
    socket.on('room:host-resumed', onHostResumed);
    socket.on('stream:stats', onStats);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', onConnect);

    // Entrada automática, com o apelido salvo (se houver). Cada sala começa sem E2EE conhecida.
    credsRef.current = { name: readStoredName() };
    e2eeRoomRef.current = false;
    keysRef.current = null;
    sessionRef.current = true;
    dispatch({ type: 'joining' });
    sendJoin();

    return () => {
      cancelled = true;
      socket.off('room:joined', onJoined);
      socket.off('room:pending-approval', onPendingApproval);
      socket.off('room:error', onError);
      socket.off('room:host-disconnected', onHostDisconnected);
      socket.off('room:host-reconnecting', onHostReconnecting);
      socket.off('room:host-resumed', onHostResumed);
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

  /**
   * (Re)envia a entrada na sala, p. ex. com a senha digitada pelo espectador. Em sala E2EE a senha
   * é derivada aqui (PBKDF2): só o token de entrada vai ao servidor, e a chave de mídia fica na memória.
   */
  const join = useCallback(async (opts: JoinOptions = {}) => {
    if (!sendJoinRef.current) return;
    if (opts.name !== undefined) {
      credsRef.current.name = opts.name;
      storeName(opts.name);
    }
    sessionRef.current = true;
    dispatch({ type: 'joining' });

    if (opts.password !== undefined) {
      if (e2eeRoomRef.current && roomCode) {
        try {
          const keys = await deriveE2eeKeys(opts.password, roomCode);
          keysRef.current = keys;
          credsRef.current.password = keys.entryToken;
        } catch (err) {
          sessionRef.current = false;
          dispatch({
            type: 'error',
            message: err instanceof Error ? err.message : 'Não foi possível derivar a chave da sala.',
            code: 'internal',
            e2ee: true,
          });
          return;
        }
      } else {
        credsRef.current.password = opts.password;
      }
    }
    sendJoinRef.current?.();
  }, [roomCode]);

  /** Define a preferência de resolução individual do espectador */
  const setQuality = useCallback(
    (pref: ViewerQualityPreference) => {
      qualityRef.current = pref;
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
    keysRef.current = null;
    setMediaKey(null);
    dispatch({ type: 'reset' });
  }, [socket, destroyViewer]);

  return { state, leaveRoom, setQuality, join, updateName, mediaKey, storedName: readStoredName() };
}
