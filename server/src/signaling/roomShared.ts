/**
 * Funções compartilhadas de gerenciamento de sala:
 * notifyRoomClosed, admitViewerToRoom, leaveCurrentRoom.
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  RoomErrorPayload,
  RoomJoinedPayload,
  ViewerJoinedPayload,
  JoinCancelledPayload,
  HostReconnectingPayload,
  CopresenterChangedPayload,
} from '@screen-share/shared';
import type { RoomManager, ManagedRoom } from '../rooms/roomManager';
import type { SignalingState } from './state';
import { logger } from '../utils/logger';
import { getIceServers } from '../utils/iceServers';
import { getHostGraceMs } from '../rooms/roomManager';

/** Notifica espectadores (aprovados e pendentes) que a sala foi encerrada e limpa o estado dos sockets */
export function notifyRoomClosed(
  state: SignalingState,
  io: SocketIOServer,
  room: ManagedRoom,
  message: string,
): void {
  const { socketPendingMap, socketRoomMap } = state;
  io.to(room.id).emit('room:host-disconnected', { message });

  for (const pendingId of room.pendingViewers.keys()) {
    socketPendingMap.delete(pendingId);
    io.to(pendingId).emit('room:error', {
      code: 'closed',
      message: 'Esta sala já foi encerrada.',
    } satisfies RoomErrorPayload);
  }
  for (const viewerId of room.viewers) {
    socketRoomMap.delete(viewerId);
  }
  socketRoomMap.delete(room.hostId);
  io.socketsLeave(room.id);
}

/** Admite espectador aprovado na sala Socket.IO e WebRTC */
export async function admitViewerToRoom(
  socket: Socket,
  room: ManagedRoom,
  nickname: string,
  io: SocketIOServer,
  roomManager: RoomManager,
  state: SignalingState,
): Promise<void> {
  // Socket desconectado não pode ocupar vaga da sala
  if (!socket.connected) return;
  roomManager.addViewer(room.id, socket.id, nickname);
  socket.join(room.id);
  state.socketRoomMap.set(socket.id, room.id);

  const iceServers = await getIceServers(room.id);
  if (!socket.connected) {
    leaveCurrentRoom(socket, io, roomManager, state);
    return;
  }

  const joinedPayload: RoomJoinedPayload = {
    roomId: room.id,
    hostId: room.hostId,
    viewerCount: room.viewers.size,
    iceServers,
    reactionsEnabled: room.reactionsEnabled,
    e2ee: room.e2ee,
  };
  socket.emit('room:joined', joinedPayload);

  const viewerJoined: ViewerJoinedPayload = {
    viewerId: socket.id,
    viewerCount: room.viewers.size,
    name: nickname,
  };
  const hwDecode = state.socketHwDecode.get(socket.id);
  if (hwDecode) viewerJoined.hwDecode = hwDecode;
  io.to(room.hostId).emit('room:viewer-joined', viewerJoined);

  logger.info(`Espectador ${socket.id.slice(0, 8)} entrou na sala ${room.id}`);
}

/** Remove o socket de qualquer sala ou estado pendente ativo */
export function leaveCurrentRoom(
  socket: Socket,
  io: SocketIOServer,
  roomManager: RoomManager,
  state: SignalingState,
  opts?: { hostGraceMs?: number },
): void {
  const { socketPendingMap, socketRoomMap, socketNicknames } = state;
  // 1. Trata se estava pendente de aprovação
  const pendingRoomId = socketPendingMap.get(socket.id);
  if (pendingRoomId) {
    socketPendingMap.delete(socket.id);
    const room = roomManager.getRoom(pendingRoomId);
    if (room) {
      roomManager.removePendingViewer(pendingRoomId, socket.id);
      const cancelPayload: JoinCancelledPayload = { viewerId: socket.id };
      io.to(room.hostId).emit('room:join-cancelled', cancelPayload);
    }
  }

  // 2. Trata se estava em uma sala ativa (host ou espectador)
  const roomId = socketRoomMap.get(socket.id);
  if (!roomId) return;

  socketRoomMap.delete(socket.id);
  socket.leave(roomId);

  const room = roomManager.getRoom(roomId);
  if (!room) return;

  if (room.hostId === socket.id) {
    // Queda de conexão: mantém a sala por um período de graça à espera de room:resume
    const graceMs = opts?.hostGraceMs ?? 0;
    if (graceMs > 0) {
      const started = roomManager.startHostGrace(roomId, graceMs, (expired) => {
        notifyRoomClosed(state, io, expired, 'O apresentador encerrou o compartilhamento de tela.');
        roomManager.closeRoom(expired.id);
        logger.info(`Sala ${expired.id} encerrada: apresentador não voltou a tempo`);
      });
      if (started) {
        const reconnecting: HostReconnectingPayload = { graceMs };
        io.to(roomId).emit('room:host-reconnecting', reconnecting);
        logger.info(`Apresentador da sala ${roomId} caiu; aguardando ${graceMs}ms`);
        return;
      }
    }
    // Apresentador saiu: encerra a sala e notifica todos os espectadores
    notifyRoomClosed(state, io, room, 'O apresentador encerrou o compartilhamento de tela.');
    roomManager.closeRoom(roomId);
    logger.info(`Sala ${roomId} encerrada porque o apresentador saiu`);
  } else {
    // Se era co-apresentador, remove e notifica a sala
    if (roomManager.isCopresenter(roomId, socket.id)) {
      roomManager.removeCopresenter(roomId, socket.id);
      const name = socketNicknames.get(socket.id) || room.viewerNames.get(socket.id) || 'Convidado';
      const leftPayload: CopresenterChangedPayload = { copresenterId: socket.id, name };
      io.to(roomId).emit('room:copresenter-left', leftPayload);
    }

    // Espectador saiu: notifica o apresentador
    roomManager.removeViewer(roomId, socket.id);
    io.to(room.hostId).emit('room:viewer-left', {
      viewerId: socket.id,
      viewerCount: room.viewers.size,
    });
  }
}

// Re-exporta getHostGraceMs para que hostSessionHandlers não precise importar de roomManager diretamente
export { getHostGraceMs };
