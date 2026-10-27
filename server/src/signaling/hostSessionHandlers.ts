/**
 * Handler de retomada de sessão do host: room:resume.
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  RoomErrorPayload,
  RoomResumedPayload,
  HostResumedPayload,
  JoinRequestPayload,
} from '@screen-share/shared';
import type { RoomManager } from '../rooms/roomManager';
import type { SignalingState } from './state';
import { logger } from '../utils/logger';
import { buildInviteUrl } from '../utils/publicUrl';
import { getIceServers } from '../utils/iceServers';
import { validateResumeRoomPayload } from '../utils/validators';
import { safe } from './safe';
import { leaveCurrentRoom } from './roomShared';
import {
  recentHits,
  recentJoinFailures,
  registerJoinFailure,
  MAX_JOIN_FAILURES,
  MAX_JOIN_FAILURES_PER_IP,
  JOIN_FAILURE_WINDOW_MS,
} from './rateLimit';

export interface HostSessionHandlerContext {
  io: SocketIOServer;
  roomManager: RoomManager;
  state: SignalingState;
  ipJoinFailures: Map<string, number[]>;
}

export function registerHostSessionHandlers(
  socket: Socket,
  ctx: HostSessionHandlerContext,
): void {
  const { io, roomManager, state, ipJoinFailures } = ctx;
  const { socketRoomMap, socketNicknames } = state;
  const socketLogId = socket.id.slice(0, 8);
  const ipKey: string = (socket.data?.ip as string | undefined) ?? socket.handshake.address;

  /** Registra falha de entrada por socket E por IP */
  const registerFailure = (): void => {
    registerJoinFailure(state, socket.id);
    recentHits(ipJoinFailures, ipKey, JOIN_FAILURE_WINDOW_MS).push(Date.now());
  };

  /** true se o socket/IP excedeu o limite de tentativas falhas */
  const isFailureLimited = (): boolean =>
    recentJoinFailures(state, socket.id).length >= MAX_JOIN_FAILURES ||
    recentHits(ipJoinFailures, ipKey, JOIN_FAILURE_WINDOW_MS).length >= MAX_JOIN_FAILURES_PER_IP;

  // ── Retomar sala após queda do apresentador ──────────────────────────────
  socket.on(
    'room:resume',
    safe(socket, async (rawPayload: unknown) => {
      const notFound = (): void => {
        registerFailure();
        const errorPayload: RoomErrorPayload = {
          code: 'not-found',
          message: 'Não foi possível retomar a sala.',
        };
        socket.emit('room:error', errorPayload);
      };

      if (isFailureLimited()) {
        const errorPayload: RoomErrorPayload = {
          code: 'rate-limited',
          message: 'Muitas tentativas. Aguarde um minuto.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      const payload = validateResumeRoomPayload(rawPayload);
      if (!payload) {
        registerFailure();
        const errorPayload: RoomErrorPayload = {
          code: 'invalid-request',
          message: 'Requisição inválida para retomar a sala.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      // Sala inexistente e token errado são indistinguíveis (não revela se a sala existe)
      const target = roomManager.getRoom(payload.roomId);
      if (!target || !target.isActive || !roomManager.verifyHostToken(target, payload.hostToken)) {
        notFound();
        return;
      }

      const iceServers = await getIceServers(target.id);
      const room = roomManager.getRoom(target.id);
      if (!socket.connected || !room || !room.isActive) return;

      // Se este socket estava em outra sala (ex.: uma sala nova criada após a queda), sai antes
      if (socketRoomMap.get(socket.id) !== room.id) {
        leaveCurrentRoom(socket, io, roomManager, state);
      }

      // Host antigo ainda conectado: é substituído (sem fechar a sala)
      const oldHostId = room.hostId;
      room.hostId = socket.id;
      roomManager.cancelHostGrace(room.id);
      if (oldHostId !== socket.id) {
        socketRoomMap.delete(oldHostId);
        const oldSocket = io.sockets.sockets.get(oldHostId);
        if (oldSocket) oldSocket.disconnect(true);
      }

      socket.join(room.id);
      socketRoomMap.set(socket.id, room.id);
      socketNicknames.set(socket.id, 'Apresentador');

      const resumedPayload: RoomResumedPayload = {
        roomId: room.id,
        code: room.code,
        inviteUrl: buildInviteUrl(room.code),
        iceServers,
        maxViewers: room.maxViewers,
        hasPassword: Boolean(room.passwordHash),
        requireApproval: room.requireApproval,
        privacyMode: room.privacyMode,
        reactionsEnabled: room.reactionsEnabled,
        e2ee: room.e2ee,
        viewerCount: room.viewers.size,
      };
      socket.emit('room:resumed', resumedPayload);

      const resumedEvent: HostResumedPayload = { hostId: socket.id };
      socket.to(room.id).emit('room:host-resumed', resumedEvent);

      // Pedidos de entrada pendentes são reapresentados ao novo apresentador
      for (const pending of room.pendingViewers.values()) {
        const requestPayload: JoinRequestPayload = {
          viewerId: pending.viewerId,
          name: pending.name,
        };
        socket.emit('room:join-request', requestPayload);
      }
      logger.info(`Apresentador ${socketLogId} retomou a sala ${room.id}`);
    }),
  );
}
