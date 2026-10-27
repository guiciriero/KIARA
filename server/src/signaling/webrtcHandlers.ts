/**
 * Handlers WebRTC: offer, answer, ice-candidate, ice-restart-request,
 * stream:config-update, stream:quality-request, stream:stats.
 * Inclui isSignalingAllowed.
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type { RoomManager, ManagedRoom } from '../rooms/roomManager';
import type { SignalingState } from './state';
import { logger } from '../utils/logger';
import {
  validateOfferPayload,
  validateAnswerPayload,
  validateIceCandidatePayload,
  validateQualityRequestPayload,
  sanitizeStreamConfig,
  sanitizeStreamStats,
} from '../utils/validators';
import { safe } from './safe';

/** Sinalização permitida: host↔viewer ou copresentador↔host */
export function isSignalingAllowed(
  room: ManagedRoom,
  senderId: string,
  targetId: string,
  roomManager: RoomManager,
): boolean {
  const senderIsCopresenter = roomManager.isCopresenter(room.id, senderId);
  const targetIsCopresenter = roomManager.isCopresenter(room.id, targetId);
  return (
    room.hostId === senderId ||
    room.hostId === targetId ||
    (senderIsCopresenter && targetId === room.hostId) ||
    (targetIsCopresenter && senderId === room.hostId)
  );
}

export interface WebRTCHandlerContext {
  io: SocketIOServer;
  roomManager: RoomManager;
  state: SignalingState;
}

export function registerWebRTCHandlers(socket: Socket, ctx: WebRTCHandlerContext): void {
  const { io, roomManager, state } = ctx;
  const { socketRoomMap } = state;

  // ── Offer WebRTC (apresentador ⇄ espectador) ─────────────────────────────
  socket.on(
    'webrtc:offer',
    safe(socket, (rawPayload: unknown) => {
      const data = validateOfferPayload(rawPayload);
      if (!data) return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.isActive) return;

      const targetRoomId = socketRoomMap.get(data.targetId);
      if (targetRoomId !== roomId) return; // Remetente e destino devem estar na mesma sala

      if (!isSignalingAllowed(room, socket.id, data.targetId, roomManager)) return;

      io.to(data.targetId).emit('webrtc:offer', {
        senderId: socket.id,
        offer: data.offer,
      });
    }),
  );

  // ── Answer WebRTC (espectador ⇄ apresentador) ────────────────────────────
  socket.on(
    'webrtc:answer',
    safe(socket, (rawPayload: unknown) => {
      const data = validateAnswerPayload(rawPayload);
      if (!data) return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.isActive) return;

      const targetRoomId = socketRoomMap.get(data.targetId);
      if (targetRoomId !== roomId) return;

      if (!isSignalingAllowed(room, socket.id, data.targetId, roomManager)) return;

      io.to(data.targetId).emit('webrtc:answer', {
        senderId: socket.id,
        answer: data.answer,
      });
    }),
  );

  // ── Pedido de ICE restart (espectador → apresentador) ─────────────────────
  // O viewer não pode criar offer (só o broadcaster pode), então sinaliza ao host
  // para que ele inicie um novo ICE restart/offer.
  socket.on(
    'webrtc:ice-restart-request',
    safe(socket, (rawPayload: unknown) => {
      if (!rawPayload || typeof rawPayload !== 'object') return;
      const data = rawPayload as Record<string, unknown>;
      if (typeof data.targetId !== 'string') return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.isActive) return;

      // Apenas espectadores da sala podem pedir restart ao host
      if (!room.viewers.has(socket.id)) return;
      if (data.targetId !== room.hostId) return;

      // Retransmite ao host com senderId para ele saber qual viewer precisa de restart
      io.to(room.hostId).emit('webrtc:ice-restart-request', {
        senderId: socket.id,
      });
      logger.debug(`Viewer ${socket.id.slice(0, 8)} pediu ICE restart na sala ${roomId}`);
    }),
  );

  // ── Candidato ICE ────────────────────────────────────────────────────────
  socket.on(
    'webrtc:ice-candidate',
    safe(socket, (rawPayload: unknown) => {
      const data = validateIceCandidatePayload(rawPayload);
      if (!data) return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || !room.isActive) return;

      const targetRoomId = socketRoomMap.get(data.targetId);
      if (targetRoomId !== roomId) return;

      if (!isSignalingAllowed(room, socket.id, data.targetId, roomManager)) return;

      io.to(data.targetId).emit('webrtc:ice-candidate', {
        senderId: socket.id,
        candidate: data.candidate,
      });
    }),
  );

  // ── Atualização de configuração de stream (apenas host) ───────────────────
  socket.on(
    'stream:config-update',
    safe(socket, (rawPayload: unknown) => {
      if (!rawPayload || typeof rawPayload !== 'object') return;
      const data = rawPayload as Record<string, unknown>;
      // Reconstrói a config só com campos conhecidos antes de retransmitir
      const cleanConfig = sanitizeStreamConfig(data.config);
      if (!cleanConfig) return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || room.hostId !== socket.id) return;

      socket.to(roomId).emit('stream:config-update', { config: cleanConfig });
      logger.debug(`Configuração de stream atualizada na sala ${roomId}`);
    }),
  );

  // ── Solicitação de qualidade individual (apenas espectador → apresentador)
  socket.on(
    'stream:quality-request',
    safe(socket, (rawPayload: unknown) => {
      const data = validateQualityRequestPayload(rawPayload);
      if (!data) return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || room.hostId === socket.id) return; // Apenas espectadores enviam ao host

      io.to(room.hostId).emit('stream:quality-request', {
        viewerId: socket.id,
        targetHeight: data.targetHeight,
        maxBitrateKbps: data.maxBitrateKbps,
        preference: data.preference,
      });
    }),
  );

  // ── Estatísticas de stream (apenas host) ──────────────────────────────────
  socket.on(
    'stream:stats',
    safe(socket, (rawPayload: unknown) => {
      // Reconstrói as estatísticas só com campos conhecidos antes de retransmitir
      const cleanStats = sanitizeStreamStats(rawPayload);
      if (!cleanStats) return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || room.hostId !== socket.id) return;

      socket.to(roomId).emit('stream:stats', cleanStats);
    }),
  );
}
