/**
 * Estado em memória da sinalização, por instância de setupSignaling
 * (não é compartilhado entre servidores nem entre testes).
 */

import type { VideoCodec } from '@screen-share/shared';

export interface SignalingState {
  /** Mapa de socketId → roomId */
  socketRoomMap: Map<string, string>;
  /** Mapa de socketId → roomId onde o socket tem solicitação pendente de aprovação */
  socketPendingMap: Map<string, string>;
  /** Mapa de socketId → apelido */
  socketNicknames: Map<string, string>;
  /** Mapa de socketId → codecs que o espectador decodifica por hardware (informado em room:join) */
  socketHwDecode: Map<string, VideoCodec[]>;
  /** Anti-força-bruta: timestamps de tentativas falhas por socket */
  joinFailures: Map<string, number[]>;
}

export function createSignalingState(): SignalingState {
  return {
    socketRoomMap: new Map(),
    socketPendingMap: new Map(),
    socketNicknames: new Map(),
    socketHwDecode: new Map(),
    joinFailures: new Map(),
  };
}
