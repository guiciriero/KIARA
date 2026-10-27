/**
 * Handlers de co-apresentação: start-copresent, stop-copresent.
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { CopresentResponsePayload, CopresenterChangedPayload } from '@screen-share/shared';
import type { RoomManager } from '../rooms/roomManager';
import type { SignalingState } from './state';
import { logger } from '../utils/logger';
import { validateCopresentStartPayload } from '../utils/validators';
import { safe } from './safe';

export interface CopresentHandlerContext {
  io: SocketIOServer;
  roomManager: RoomManager;
  state: SignalingState;
}

export function registerCopresentHandlers(socket: Socket, ctx: CopresentHandlerContext): void {
  const { io, roomManager, state } = ctx;
  const { socketRoomMap, socketNicknames } = state;
  const socketLogId = socket.id.slice(0, 8);

  // ── Iniciar co-apresentação (viewer → servidor), direto e sem aprovação ───
  socket.on(
    'room:start-copresent',
    safe(socket, (rawPayload: unknown) => {
      const data = validateCopresentStartPayload(rawPayload);
      if (data === null) return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.isActive) return;

      // Apenas espectadores admitidos podem co-apresentar (não o host)
      if (room.hostId === socket.id || !room.viewers.has(socket.id)) return;

      // Idempotência: já é co-apresentador
      if (roomManager.isCopresenter(roomId, socket.id)) {
        const again: CopresentResponsePayload = { accepted: true, hostId: room.hostId };
        socket.emit('room:copresent-response', again);
        return;
      }

      // Vaga única: addCopresenter recusa quando já está ocupada
      if (!roomManager.addCopresenter(roomId, socket.id)) {
        const busy: CopresentResponsePayload = { accepted: false };
        socket.emit('room:copresent-response', busy);
        return;
      }

      const name =
        data.name || socketNicknames.get(socket.id) || room.viewerNames.get(socket.id) || 'Convidado';

      const accepted: CopresentResponsePayload = { accepted: true, hostId: room.hostId };
      socket.emit('room:copresent-response', accepted);

      const joinedPayload: CopresenterChangedPayload = { copresenterId: socket.id, name };
      io.to(roomId).emit('room:copresenter-joined', joinedPayload);
      logger.info(`Co-apresentador ${socketLogId} iniciou transmissão na sala ${roomId}`);
    }),
  );

  // ── Encerrar co-apresentação (viewer → servidor): libera a vaga ───────────
  socket.on(
    'room:stop-copresent',
    safe(socket, () => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room || !roomManager.removeCopresenter(roomId, socket.id)) return;

      const name =
        socketNicknames.get(socket.id) || room.viewerNames.get(socket.id) || 'Convidado';
      const leftPayload: CopresenterChangedPayload = { copresenterId: socket.id, name };
      io.to(roomId).emit('room:copresenter-left', leftPayload);
    }),
  );
}
