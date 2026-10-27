/**
 * Handler de sinalização WebRTC e gerenciamento de salas KIARA.
 * Orquestra os módulos de domínio; mantém o estado por instância na closure.
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import { getHostGraceMs, type RoomManager } from '../rooms/roomManager';
import { createSignalingState } from './state';
import { logger } from '../utils/logger';
import { notifyRoomClosed, leaveCurrentRoom } from './roomShared';
import {
  sweepHits,
  JOIN_FAILURE_WINDOW_MS,
  ROOM_PASSWORD_WINDOW_MS,
  EVENT_WINDOW_MS,
  EVENT_LIMIT,
  EVENT_HARD_LIMIT,
} from './rateLimit';
import { registerRoomHandlers } from './roomHandlers';
import { registerHostSessionHandlers } from './hostSessionHandlers';
import { registerWebRTCHandlers } from './webrtcHandlers';
import { registerCopresentHandlers } from './copresentHandlers';

export function setupSignaling(io: SocketIOServer, roomManager: RoomManager): () => void {
  // Estado por instância (não compartilhado entre servidores/testes)
  const state = createSignalingState();
  const { joinFailures } = state;
  const ipJoinFailures = new Map<string, number[]>();
  const roomPasswordFailures = new Map<string, number[]>();
  const eventBuckets = new Map<string, { start: number; count: number }>();
  /** Sockets com room:create em andamento (evita criar várias salas em paralelo) */
  const creatingRoom = new Set<string>();

  // Limpeza periódica de salas expiradas a cada 5 minutos
  const pruneInterval = setInterval(() => {
    roomManager.pruneStaleRooms((expiredRoom) => {
      logger.warn(`Encerrando sala expirada por limite de tempo: ${expiredRoom.id}`);
      notifyRoomClosed(state, io, expiredRoom, 'A sala expirou por limite de tempo.');
    });
    sweepHits(ipJoinFailures, JOIN_FAILURE_WINDOW_MS);
    sweepHits(roomPasswordFailures, ROOM_PASSWORD_WINDOW_MS);
  }, 5 * 60 * 1000);

  if (typeof pruneInterval.unref === 'function') {
    pruneInterval.unref();
  }

  const onConnection = (socket: Socket) => {
    const socketLogId = socket.id.slice(0, 8);
    logger.info(`Nova conexão estabelecida: ${socketLogId}`);

    // connectionStateRecovery devolve o mesmo id e as salas do adapter, mas nosso estado
    // (mapas) foi limpo no disconnect. Tira o socket das salas para manter tudo consistente:
    // espectadores entram de novo com room:join; o apresentador usa room:resume.
    if (socket.recovered) {
      for (const joinedRoom of socket.rooms) {
        if (joinedRoom !== socket.id) socket.leave(joinedRoom);
      }
    }

    // IP real (já considerando TRUST_PROXY) definido pelo middleware de conexão em app.ts
    const ipKey: string = (socket.data?.ip as string | undefined) ?? socket.handshake.address;

    // SEGURANÇA: o erro de middleware abaixo é só para descartar o pacote; sem este ouvinte
    // o Socket.IO imprimiria "Missing error handler" no console a cada excesso.
    socket.on('error', () => {});

    // ── Limite geral de eventos por socket (DoS por inundação de eventos) ────
    socket.use((_packet, next) => {
      const now = Date.now();
      let bucket = eventBuckets.get(socket.id);
      if (!bucket || now - bucket.start > EVENT_WINDOW_MS) {
        bucket = { start: now, count: 0 };
        eventBuckets.set(socket.id, bucket);
      }
      bucket.count += 1;
      if (bucket.count > EVENT_HARD_LIMIT) {
        socket.disconnect(true);
        return;
      }
      if (bucket.count > EVENT_LIMIT) {
        next(new Error('rate-limited'));
        return;
      }
      next();
    });

    // ── Registra handlers por domínio ────────────────────────────────────────
    registerRoomHandlers(socket, {
      io,
      roomManager,
      state,
      ipJoinFailures,
      roomPasswordFailures,
      creatingRoom,
    });

    registerHostSessionHandlers(socket, {
      io,
      roomManager,
      state,
      ipJoinFailures,
    });

    registerWebRTCHandlers(socket, { io, roomManager, state });

    registerCopresentHandlers(socket, { io, roomManager, state });

    // ── Desconexão do Socket ─────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.info(`Conexão encerrada: ${socketLogId} (motivo: ${reason})`);
      joinFailures.delete(socket.id);
      // SEGURANÇA (vazamento de memória): estes mapas nunca eram limpos na desconexão
      state.socketNicknames.delete(socket.id);
      state.socketHwDecode.delete(socket.id);
      eventBuckets.delete(socket.id);
      creatingRoom.delete(socket.id);
      // Qualquer desconexão do host (exceto room:leave explícito) dá período de graça
      leaveCurrentRoom(socket, io, roomManager, state, { hostGraceMs: getHostGraceMs() });
    });

    // Suprime warning de IP não utilizado (é usado pelos handlers via socket.data)
    void ipKey;
  };

  io.on('connection', onConnection);

  return () => {
    clearInterval(pruneInterval);
    io.off('connection', onConnection);
    for (const room of roomManager.listRooms()) roomManager.cancelHostGrace(room.id);
  };
}
