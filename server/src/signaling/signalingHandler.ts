/**
 * Handler de sinalização WebRTC.
 * Processa todos os eventos Socket.IO relacionados a:
 *   - Criação e entrada em salas
 *   - Troca de offer/answer/ICE candidate entre peers
 *   - Atualização de configurações de stream
 *   - Desconexão e reconexão
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  RTCOfferPayload,
  RTCAnswerPayload,
  RTCIceCandidatePayload,
  StreamConfig,
  StreamStats,
} from '@screen-share/shared';
import type { RoomManager } from '../rooms/roomManager';
import { logger } from '../utils/logger';
import { buildInviteUrl } from '../utils/publicUrl';

/** Mapa de socketId → roomId para rastrear em qual sala cada socket está */
const socketRoomMap = new Map<string, string>();

/** Anti-força-bruta: máximo de tentativas falhas de room:join por socket na janela */
const MAX_JOIN_FAILURES = 8;
const JOIN_FAILURE_WINDOW_MS = 60_000;
/** socketId → timestamps (ms) das tentativas falhas recentes */
const joinFailures = new Map<string, number[]>();

function recentJoinFailures(socketId: string): number[] {
  const cutoff = Date.now() - JOIN_FAILURE_WINDOW_MS;
  const recent = (joinFailures.get(socketId) ?? []).filter((t) => t > cutoff);
  joinFailures.set(socketId, recent);
  return recent;
}

function registerJoinFailure(socketId: string): void {
  recentJoinFailures(socketId).push(Date.now());
}

export function setupSignaling(io: SocketIOServer, roomManager: RoomManager): void {

  // Limpa salas expiradas a cada hora
  setInterval(() => roomManager.pruneStaleRooms(), 60 * 60 * 1000);

  io.on('connection', (socket: Socket) => {
    logger.info(`Nova conexão estabelecida: ${socket.id}`);

    // ── Criar sala (apresentador) ────────────────────────────────────────────
    socket.on('room:create', () => {
      try {
        const room = roomManager.createRoom(socket.id);

        // Entra na sala Socket.IO correspondente
        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);

        socket.emit('room:created', {
          roomId: room.id,
          code: room.code,
          inviteUrl: buildInviteUrl(room.code),
        });

        logger.info(`Apresentador ${socket.id} criou sala ${room.id} (${room.code})`);
      } catch (err) {
        logger.error('Erro ao criar sala:', err);
        socket.emit('room:error', { message: 'Não foi possível criar a sala. Tente novamente em alguns instantes.' });
      }
    });

    // ── Entrar em sala (espectador) ──────────────────────────────────────────
    socket.on('room:join', (data: { code: string }) => {
      try {
        if (recentJoinFailures(socket.id).length >= MAX_JOIN_FAILURES) {
          socket.emit('room:error', { message: 'Muitas tentativas. Aguarde um minuto.' });
          return;
        }

        if (!data?.code || typeof data.code !== 'string') {
          registerJoinFailure(socket.id);
          socket.emit('room:error', { message: 'O código informado não é válido. Verifique e tente novamente.' });
          return;
        }

        const room = roomManager.getRoomByCode(data.code);

        if (!room) {
          registerJoinFailure(socket.id);
          socket.emit('room:error', { message: 'Sala não encontrada. Verifique o código e tente novamente.' });
          return;
        }

        if (!room.isActive) {
          registerJoinFailure(socket.id);
          socket.emit('room:error', { message: 'Esta sala já foi encerrada pelo apresentador.' });
          return;
        }

        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);
        roomManager.addViewer(room.id);

        // Notifica o espectador que entrou com sucesso
        socket.emit('room:joined', {
          roomId: room.id,
          hostId: room.hostId,
          viewerCount: room.viewerCount,
        });

        // Notifica o apresentador que um novo espectador entrou
        socket.to(room.hostId).emit('room:viewer-joined', {
          viewerId: socket.id,
          viewerCount: room.viewerCount,
        });

        logger.info(`Espectador ${socket.id} entrou na sala ${room.id}`);
      } catch (err) {
        logger.error('Erro ao entrar em sala:', err);
        socket.emit('room:error', { message: 'Não foi possível entrar na sala. Tente novamente.' });
      }
    });

    // ── Offer WebRTC (apresentador → espectador) ─────────────────────────────
    socket.on('webrtc:offer', (data: { targetId: string; offer: RTCOfferPayload }) => {
      if (!data?.targetId || !data?.offer) return;

      logger.debug(`Offer de ${socket.id} para ${data.targetId}`);
      io.to(data.targetId).emit('webrtc:offer', {
        senderId: socket.id,
        offer: data.offer,
      });
    });

    // ── Answer WebRTC (espectador → apresentador) ────────────────────────────
    socket.on('webrtc:answer', (data: { targetId: string; answer: RTCAnswerPayload }) => {
      if (!data?.targetId || !data?.answer) return;

      logger.debug(`Answer de ${socket.id} para ${data.targetId}`);
      io.to(data.targetId).emit('webrtc:answer', {
        senderId: socket.id,
        answer: data.answer,
      });
    });

    // ── Candidato ICE ────────────────────────────────────────────────────────
    socket.on(
      'webrtc:ice-candidate',
      (data: { targetId: string; candidate: RTCIceCandidatePayload }) => {
        if (!data?.targetId || !data?.candidate) return;

        io.to(data.targetId).emit('webrtc:ice-candidate', {
          senderId: socket.id,
          candidate: data.candidate,
        });
      },
    );

    // ── Atualização de configuração de stream ────────────────────────────────
    socket.on('stream:config-update', (data: { config: StreamConfig }) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || room.hostId !== socket.id) return; // Apenas o apresentador pode atualizar

      // Repassa a nova configuração para todos os espectadores na sala
      socket.to(roomId).emit('stream:config-update', { config: data.config });
      logger.debug(`Configuração de stream atualizada na sala ${roomId}`);
    });

    // ── Solicitação de qualidade individual (espectador -> apresentador) ───────
    socket.on('stream:quality-request', (data: { targetHeight?: number | null; maxBitrateKbps?: number | null; preference: string }) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || room.hostId === socket.id) return; // Apenas espectadores enviam ao apresentador

      io.to(room.hostId).emit('stream:quality-request', {
        viewerId: socket.id,
        targetHeight: typeof data?.targetHeight === 'number' ? data.targetHeight : null,
        maxBitrateKbps: typeof data?.maxBitrateKbps === 'number' ? data.maxBitrateKbps : null,
        preference: data?.preference || 'auto',
      });
      logger.debug(`Espectador ${socket.id} solicitou qualidade: ${data?.preference} (${data?.targetHeight}p)`);
    });

    // ── Estatísticas de stream ───────────────────────────────────────────────
    socket.on('stream:stats', (stats: StreamStats) => {
      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      // Repassa stats do apresentador para os espectadores (para exibição no overlay)
      socket.to(roomId).emit('stream:stats', stats);
    });

    // ── Sair da sala voluntariamente ─────────────────────────────────────────
    socket.on('room:leave', () => {
      handleDisconnect(socket, io, roomManager);
    });

    // ── Desconexão ───────────────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.info(`Conexão encerrada: ${socket.id} (motivo: ${reason})`);
      joinFailures.delete(socket.id);
      handleDisconnect(socket, io, roomManager);
    });
  });
}

/**
 * Lida com a saída de um socket da sala (voluntária ou por desconexão).
 * Se for o apresentador, encerra a sala e notifica todos os espectadores.
 * Se for um espectador, notifica o apresentador.
 */
function handleDisconnect(
  socket: Socket,
  io: SocketIOServer,
  roomManager: RoomManager,
): void {
  const roomId = socketRoomMap.get(socket.id);
  if (!roomId) return;

  socketRoomMap.delete(socket.id);
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  if (room.hostId === socket.id) {
    // Apresentador saiu: encerra a sala e notifica espectadores
    io.to(roomId).emit('room:host-disconnected', {
      message: 'O apresentador encerrou o compartilhamento de tela.',
    });
    io.socketsLeave(roomId); // Remove todos os sockets da sala Socket.IO
    roomManager.closeRoom(roomId);
    logger.info(`Sala ${roomId} encerrada porque o apresentador saiu`);
  } else {
    // Espectador saiu: notifica o apresentador
    roomManager.removeViewer(roomId);
    const updatedRoom = roomManager.getRoom(roomId);
    io.to(room.hostId).emit('room:viewer-left', {
      viewerId: socket.id,
      viewerCount: updatedRoom?.viewerCount ?? 0,
    });
  }
}
