/**
 * viewerReducer.ts
 * Máquina de estados pura do espectador (sem React, sem socket): cada evento do
 * servidor ou do WebRTC vira uma ação. O hook useViewer só despacha ações.
 */

import type {
  StreamStats,
  ConnectionState,
  ViewerQualityPreference,
  RoomErrorCode,
  IceServerConfig,
} from '@shared/index';

export interface ViewerState {
  remoteStream: MediaStream | null;
  viewerCount: number;
  connectionState: ConnectionState;
  stats: StreamStats | null;
  error: string | null;
  /** Código estável do último room:error (null quando não há erro) */
  errorCode: RoomErrorCode | null;
  /** A sala exige senha (ausente ou incorreta) */
  needsPassword: boolean;
  /** A última senha enviada estava incorreta */
  wrongPassword: boolean;
  /** Aguardando o apresentador aprovar a entrada */
  pendingApproval: boolean;
  /** A sala acabou: apresentador saiu ou as tentativas de reconexão se esgotaram */
  roomClosed: boolean;
  hostDisconnected: boolean;
  /** O apresentador perdeu a conexão e o servidor aguarda ele voltar (a sala continua aberta) */
  hostReconnecting: boolean;
  selectedQuality: ViewerQualityPreference;
  /** Socket ID do host (destino do offer WebRTC do co-apresentador) */
  hostId: string | null;
  iceServers: IceServerConfig[];
  /** A sala usa criptografia de ponta a ponta (descoberto ao pedir a senha ou ao entrar) */
  e2ee: boolean;
}

export const INITIAL_VIEWER_STATE: ViewerState = {
  remoteStream: null,
  viewerCount: 0,
  connectionState: 'disconnected',
  stats: null,
  error: null,
  errorCode: null,
  needsPassword: false,
  wrongPassword: false,
  pendingApproval: false,
  roomClosed: false,
  hostDisconnected: false,
  hostReconnecting: false,
  selectedQuality: '1080p',
  hostId: null,
  iceServers: [],
  e2ee: false,
};

export type ViewerAction =
  | { type: 'joining' }
  | {
      type: 'joined';
      viewerCount: number;
      hostId?: string;
      iceServers?: IceServerConfig[];
      e2ee?: boolean;
    }
  | { type: 'stream'; stream: MediaStream }
  | { type: 'pending-approval' }
  | { type: 'error'; message: string; code: RoomErrorCode; e2ee?: boolean }
  | { type: 'host-disconnected' }
  | { type: 'host-reconnecting' }
  | { type: 'host-resumed'; hostId: string }
  | { type: 'socket-disconnected' }
  | { type: 'reconnect-exhausted' }
  | { type: 'stats'; stats: StreamStats }
  | { type: 'quality'; preference: ViewerQualityPreference }
  | { type: 'reset' };

/** Erros em que o espectador fica esperando a senha em vez de falhar */
export function isPasswordError(code: RoomErrorCode | undefined | null): boolean {
  return code === 'password-required' || code === 'wrong-password';
}

/** Erros em que o espectador foi barrado pelo apresentador: nunca reentra sozinho */
export function isRemovalError(code: RoomErrorCode | undefined | null): boolean {
  return code === 'kicked' || code === 'banned';
}

export function viewerReducer(state: ViewerState, action: ViewerAction): ViewerState {
  switch (action.type) {
    case 'joining':
      return {
        ...state,
        connectionState: 'connecting',
        error: null,
        errorCode: null,
        needsPassword: false,
        wrongPassword: false,
        pendingApproval: false,
      };

    case 'joined':
      return {
        ...state,
        viewerCount: action.viewerCount,
        hostId: action.hostId !== undefined ? action.hostId : state.hostId,
        iceServers: action.iceServers !== undefined ? action.iceServers : state.iceServers,
        e2ee: action.e2ee ?? state.e2ee,
        connectionState: 'connecting',
        error: null,
        errorCode: null,
        needsPassword: false,
        wrongPassword: false,
        pendingApproval: false,
        roomClosed: false,
        hostDisconnected: false,
        hostReconnecting: false,
      };

    case 'stream':
      return { ...state, remoteStream: action.stream, connectionState: 'connected' };

    case 'pending-approval':
      return { ...state, pendingApproval: true, connectionState: 'connecting', error: null, errorCode: null };

    case 'error':
      return {
        ...state,
        error: action.message,
        errorCode: action.code,
        e2ee: action.e2ee ?? state.e2ee,
        needsPassword: isPasswordError(action.code),
        wrongPassword: action.code === 'wrong-password',
        pendingApproval: false,
        hostReconnecting: false,
        // Senha pedida/errada: continua 'connecting' esperando o usuário digitar
        connectionState: isPasswordError(action.code) ? 'connecting' : 'failed',
      };

    case 'host-reconnecting':
      // Sala já encerrada: nada a aguardar. Mantém stream e último frame.
      if (state.roomClosed) return state;
      return { ...state, hostReconnecting: true };

    case 'host-resumed':
      return { ...state, hostReconnecting: false, hostId: action.hostId };

    case 'host-disconnected':
      return {
        ...state,
        hostDisconnected: true,
        hostReconnecting: false,
        roomClosed: true,
        pendingApproval: false,
        connectionState: 'disconnected',
      };

    case 'socket-disconnected':
      // Sala encerrada ou já falhou: não volta para 'reconnecting'
      if (state.roomClosed || state.connectionState === 'failed') return state;
      return { ...state, connectionState: 'reconnecting' };

    case 'reconnect-exhausted':
      return { ...state, roomClosed: true, pendingApproval: false, connectionState: 'failed' };

    case 'stats':
      return { ...state, stats: action.stats };

    case 'quality':
      return { ...state, selectedQuality: action.preference };

    case 'reset':
      return INITIAL_VIEWER_STATE;
  }
}
