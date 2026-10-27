/**
 * Handlers de sala: create, join, respond-join, leave, set-name, kick.
 */

import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  RoomErrorPayload,
  RoomCreatedPayload,
  RoomJoinedPayload,
  JoinRequestPayload,
  JoinCancelledPayload,
  ViewerRenamedPayload,
} from '@screen-share/shared';
import type { RoomManager } from '../rooms/roomManager';
import type { SignalingState } from './state';
import { logger } from '../utils/logger';
import { buildInviteUrl } from '../utils/publicUrl';
import { getIceServers, isTurnConfigured } from '../utils/iceServers';
import {
  validateCreateRoomPayload,
  validateUpdateNamePayload,
  validateJoinRoomPayload,
  validateRespondJoinPayload,
  validateKickViewerPayload,
  sanitizeNickname,
} from '../utils/validators';
import { safe } from './safe';
import { admitViewerToRoom, leaveCurrentRoom } from './roomShared';
import {
  recentHits,
  recentJoinFailures,
  registerJoinFailure,
  MAX_JOIN_FAILURES,
  MAX_JOIN_FAILURES_PER_IP,
  MAX_PASSWORD_FAILURES_PER_ROOM,
  ROOM_PASSWORD_WINDOW_MS,
  JOIN_FAILURE_WINDOW_MS,
} from './rateLimit';

export interface RoomHandlerContext {
  io: SocketIOServer;
  roomManager: RoomManager;
  state: SignalingState;
  ipJoinFailures: Map<string, number[]>;
  roomPasswordFailures: Map<string, number[]>;
  creatingRoom: Set<string>;
}

export function registerRoomHandlers(socket: Socket, ctx: RoomHandlerContext): void {
  const { io, roomManager, state, ipJoinFailures, roomPasswordFailures, creatingRoom } = ctx;
  const { socketRoomMap, socketPendingMap, socketNicknames, socketHwDecode } = state;
  const socketLogId = socket.id.slice(0, 8);
  const ipKey: string = (socket.data?.ip as string | undefined) ?? socket.handshake.address;

  /** Registra falha de entrada por socket E por IP (reconectar não zera o contador do IP) */
  const registerFailure = (): void => {
    registerJoinFailure(state, socket.id);
    recentHits(ipJoinFailures, ipKey, JOIN_FAILURE_WINDOW_MS).push(Date.now());
  };

  /** true se o socket/IP excedeu o limite de tentativas falhas (join/resume) */
  const isFailureLimited = (): boolean =>
    recentJoinFailures(state, socket.id).length >= MAX_JOIN_FAILURES ||
    recentHits(ipJoinFailures, ipKey, JOIN_FAILURE_WINDOW_MS).length >= MAX_JOIN_FAILURES_PER_IP;

  // ── Criar sala (apresentador) ────────────────────────────────────────────
  socket.on(
    'room:create',
    safe(socket, async (rawPayload: unknown) => {
      // SEGURANÇA (race condition): vários room:create simultâneos do mesmo socket criariam
      // várias salas, e só a última ficaria rastreada (as outras vazariam até expirar).
      if (creatingRoom.has(socket.id)) return;
      creatingRoom.add(socket.id);
      try {
        const validation = validateCreateRoomPayload(rawPayload);
        if (!validation.valid) {
          const errorPayload: RoomErrorPayload = {
            code: 'invalid-request',
            message: validation.invalidPassword
              ? 'A senha deve ter entre 4 e 64 caracteres.'
              : validation.invalidE2ee
                ? 'Sala com criptografia de ponta a ponta exige senha.'
                : 'Requisição inválida para criação de sala.',
          };
          socket.emit('room:error', errorPayload);
          return;
        }

        // Se o socket já estiver em alguma sala, sai antes
        leaveCurrentRoom(socket, io, roomManager, state);

        let room;
        let hostToken: string;
        let codeChanged: boolean;
        try {
          const turnAvailable = isTurnConfigured();
          const privacyRequested = Boolean(validation.payload?.privacyMode);
          const privacyEffective = privacyRequested && turnAvailable;

          const created = await roomManager.createRoom(socket.id, {
            password: validation.payload?.password,
            requireApproval: validation.payload?.requireApproval,
            privacyMode: privacyEffective,
            reactionsEnabled: validation.payload?.reactionsEnabled,
            e2ee: validation.payload?.e2ee,
            preferredCode: validation.payload?.preferredCode,
          });
          room = created.room;
          hostToken = created.hostToken;
          codeChanged = created.codeChanged;
        } catch (err: unknown) {
          if ((err as { code?: string } | null)?.code === 'SERVER_BUSY') {
            const errorPayload: RoomErrorPayload = {
              code: 'server-busy',
              message: 'O servidor está com a capacidade máxima de salas atingida.',
            };
            socket.emit('room:error', errorPayload);
            return;
          }
          throw err;
        }

        // O socket pode ter desconectado durante o hash da senha (await): não deixa sala órfã
        if (!socket.connected) {
          roomManager.closeRoom(room.id);
          return;
        }

        socket.join(room.id);
        socketRoomMap.set(socket.id, room.id);
        socketNicknames.set(socket.id, 'Apresentador');

        const iceServers = await getIceServers(room.id);

        if (!socket.connected) {
          leaveCurrentRoom(socket, io, roomManager, state);
          return;
        }

        const createdPayload: RoomCreatedPayload = {
          roomId: room.id,
          code: room.code,
          hostToken,
          ...(codeChanged ? { codeChanged: true } : {}),
          inviteUrl: buildInviteUrl(room.code),
          iceServers,
          maxViewers: room.maxViewers,
          hasPassword: Boolean(room.passwordHash),
          requireApproval: room.requireApproval,
          privacyMode: room.privacyMode,
          reactionsEnabled: room.reactionsEnabled,
          e2ee: room.e2ee,
        };

        socket.emit('room:created', createdPayload);
        // SEGURANÇA: o código da sala é o "segredo" de convite; não vai para os logs
        logger.info(`Apresentador ${socketLogId} criou sala ${room.id}`);
      } finally {
        creatingRoom.delete(socket.id);
      }
    }),
  );

  // ── Entrar em sala (espectador) ──────────────────────────────────────────
  socket.on(
    'room:join',
    safe(socket, async (rawPayload: unknown) => {
      if (isFailureLimited()) {
        const errorPayload: RoomErrorPayload = {
          code: 'rate-limited',
          message: 'Muitas tentativas. Aguarde um minuto.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      const payload = validateJoinRoomPayload(rawPayload);
      if (!payload) {
        registerJoinFailure(state, socket.id);
        const errorPayload: RoomErrorPayload = {
          code: 'invalid-code',
          message: 'O código informado não é válido.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      const room = roomManager.getRoomByCode(payload.code);
      if (!room) {
        registerJoinFailure(state, socket.id);
        const errorPayload: RoomErrorPayload = {
          code: 'not-found',
          message: 'Sala não encontrada. Verifique o código e tente novamente.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      if (!room.isActive) {
        registerJoinFailure(state, socket.id);
        const errorPayload: RoomErrorPayload = {
          code: 'closed',
          message: 'Esta sala já foi encerrada pelo apresentador.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      // IP banido pelo apresentador desta sala
      if (room.bannedIps.has(ipKey)) {
        const errorPayload: RoomErrorPayload = {
          code: 'banned',
          message: 'Você foi banido desta sala pelo apresentador.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      // Host não pode entrar como espectador na sua própria sala
      if (room.hostId === socket.id) {
        const errorPayload: RoomErrorPayload = {
          code: 'invalid-request',
          message: 'O apresentador já está nesta sala.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      // Idempotência: se já está na sala como espectador aprovado
      if (room.viewers.has(socket.id)) {
        const iceServers = await getIceServers(room.id);
        const joinedPayload: RoomJoinedPayload = {
          roomId: room.id,
          hostId: room.hostId,
          viewerCount: room.viewers.size,
          iceServers,
          reactionsEnabled: room.reactionsEnabled,
          e2ee: room.e2ee,
        };
        socket.emit('room:joined', joinedPayload);
        return;
      }

      // Validação de senha se a sala possuir senha
      if (room.passwordHash) {
        // SEGURANÇA: trava de tentativas POR SALA (qualquer socket/IP). Impede grind distribuído
        // da senha (mín. 4 caracteres) mesmo reconectando ou usando vários IPs.
        if (
          recentHits(roomPasswordFailures, room.id, ROOM_PASSWORD_WINDOW_MS).length >=
          MAX_PASSWORD_FAILURES_PER_ROOM
        ) {
          const errorPayload: RoomErrorPayload = {
            code: 'rate-limited',
            message: 'Muitas tentativas de senha nesta sala. Tente novamente mais tarde.',
          };
          socket.emit('room:error', errorPayload);
          return;
        }

        if (!payload.password) {
          registerFailure();
          const errorPayload: RoomErrorPayload = {
            code: 'password-required',
            message: 'Esta sala exige senha para entrar.',
            // O espectador só descobre que a sala é E2EE aqui: então deriva o token e reenvia
            ...(room.e2ee ? { e2ee: true } : {}),
          };
          socket.emit('room:error', errorPayload);
          return;
        }

        const passwordOk = await roomManager.verifyPassword(room, payload.password);
        if (!passwordOk) {
          registerFailure();
          recentHits(roomPasswordFailures, room.id, ROOM_PASSWORD_WINDOW_MS).push(Date.now());
          const errorPayload: RoomErrorPayload = {
            code: 'wrong-password',
            message: 'Senha incorreta. Verifique e tente novamente.',
            ...(room.e2ee ? { e2ee: true } : {}),
          };
          socket.emit('room:error', errorPayload);
          return;
        }
      }

      // O socket pode ter desconectado durante o hash da senha: não registra espectador fantasma
      if (!socket.connected) return;

      // Revalida a sala após operações assíncronas (concorrência)
      const freshRoom = roomManager.getRoom(room.id);
      if (!freshRoom || !freshRoom.isActive) {
        const errorPayload: RoomErrorPayload = {
          code: 'closed',
          message: 'Esta sala já foi encerrada.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      // Verifica capacidade de espectadores aprovados
      if (freshRoom.viewers.size >= freshRoom.maxViewers) {
        const errorPayload: RoomErrorPayload = {
          code: 'room-full',
          message: 'A sala atingiu o limite de espectadores.',
        };
        socket.emit('room:error', errorPayload);
        return;
      }

      // Se o socket estiver em outra sala ou pendente em outra sala, sai antes
      leaveCurrentRoom(socket, io, roomManager, state);

      const nickname = sanitizeNickname(payload.name, false);
      socketNicknames.set(socket.id, nickname);
      if (payload.hwDecode) socketHwDecode.set(socket.id, payload.hwDecode);
      else socketHwDecode.delete(socket.id);

      // Se a sala exigir aprovação do apresentador
      if (freshRoom.requireApproval) {
        const pendingRoomId = freshRoom.id;
        const added = roomManager.addPendingViewer(pendingRoomId, socket.id, nickname, () => {
          // Callback de timeout disparado quando o apresentador não responde a tempo
          socketPendingMap.delete(socket.id);
          roomManager.removePendingViewer(pendingRoomId, socket.id);
          const cancelPayload: JoinCancelledPayload = { viewerId: socket.id };
          // O host pode ter mudado (room:resume): usa o atual
          const currentHostId = roomManager.getRoom(pendingRoomId)?.hostId;
          if (currentHostId) io.to(currentHostId).emit('room:join-cancelled', cancelPayload);
          if (socket.connected) {
            const errorPayload: RoomErrorPayload = {
              code: 'denied',
              message: 'A solicitação de entrada expirou.',
            };
            socket.emit('room:error', errorPayload);
          }
        });

        if (!added) {
          const errorPayload: RoomErrorPayload = {
            code: 'room-full',
            message: 'Muitas solicitações pendentes na sala. Tente novamente mais tarde.',
          };
          socket.emit('room:error', errorPayload);
          return;
        }

        socketPendingMap.set(socket.id, freshRoom.id);
        socket.emit('room:pending-approval');

        const requestPayload: JoinRequestPayload = {
          viewerId: socket.id,
          name: nickname,
        };
        io.to(freshRoom.hostId).emit('room:join-request', requestPayload);
        logger.info(`Espectador ${socketLogId} aguarda aprovação na sala ${freshRoom.id}`);
        return;
      }

      // Entrada direta (sem aprovação)
      await admitViewerToRoom(socket, freshRoom, nickname, io, roomManager, state);
    }),
  );

  // ── Resposta de aprovação (apresentador → servidor) ───────────────────────
  socket.on(
    'room:respond-join',
    safe(socket, async (rawPayload: unknown) => {
      const payload = validateRespondJoinPayload(rawPayload);
      if (!payload) return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;

      const room = roomManager.getRoom(roomId);
      if (!room || room.hostId !== socket.id) return; // Apenas o host da sala pode responder

      const pending = roomManager.removePendingViewer(roomId, payload.viewerId);
      if (!pending) return; // Solicitação inexistente ou já resolvida/expirada

      socketPendingMap.delete(payload.viewerId);

      const viewerSocket = io.sockets.sockets.get(payload.viewerId);

      if (!payload.approved) {
        if (viewerSocket && viewerSocket.connected) {
          const errorPayload: RoomErrorPayload = {
            code: 'denied',
            message: 'Sua solicitação de entrada foi recusada pelo apresentador.',
          };
          viewerSocket.emit('room:error', errorPayload);
        }
        return;
      }

      if (!viewerSocket || !viewerSocket.connected) return;

      if (room.viewers.size >= room.maxViewers) {
        const errorPayload: RoomErrorPayload = {
          code: 'room-full',
          message: 'A sala atingiu o limite de espectadores.',
        };
        viewerSocket.emit('room:error', errorPayload);
        return;
      }

      await admitViewerToRoom(viewerSocket, room, pending.name, io, roomManager, state);
    }),
  );

  // ── Expulsar/banir espectador (apenas host) ──────────────────────────────
  socket.on(
    'room:kick-viewer',
    safe(socket, (rawPayload: unknown) => {
      const data = validateKickViewerPayload(rawPayload);
      if (!data) return;

      const roomId = socketRoomMap.get(socket.id);
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room || !room.isActive || room.hostId !== socket.id) return;
      if (data.viewerId === socket.id) return;

      const inRoom = room.viewers.has(data.viewerId) || room.pendingViewers.has(data.viewerId);
      if (!inRoom) return;

      const viewerSocket = io.sockets.sockets.get(data.viewerId);
      if (data.ban) {
        // Mesma chave usada em room:join (IP real do middleware, ou o endereço do handshake)
        const viewerIp =
          (viewerSocket?.data?.ip as string | undefined) ?? viewerSocket?.handshake.address;
        if (viewerIp) room.bannedIps.add(viewerIp);
      }

      if (viewerSocket) {
        // Tira da sala e limpa mapas/pendência/co-apresentação, sem desconectar o socket
        leaveCurrentRoom(viewerSocket, io, roomManager, state);
        const errorPayload: RoomErrorPayload = data.ban
          ? { code: 'banned', message: 'Você foi banido da sala pelo apresentador.' }
          : { code: 'kicked', message: 'Você foi removido da sala pelo apresentador.' };
        viewerSocket.emit('room:error', errorPayload);
      } else {
        roomManager.removePendingViewer(roomId, data.viewerId);
        roomManager.removeViewer(roomId, data.viewerId);
      }
      logger.info(
        `Apresentador ${socketLogId} ${data.ban ? 'baniu' : 'expulsou'} um espectador da sala ${roomId}`,
      );
    }),
  );

  // ── Atualização de nome do espectador ─────────────────────────────────────
  socket.on(
    'room:set-name',
    safe(socket, (rawPayload: unknown) => {
      const data = validateUpdateNamePayload(rawPayload);
      if (!data) return;

      const roomId = socketRoomMap.get(socket.id);
      const room = roomId ? roomManager.getRoom(roomId) : undefined;
      // Fora de qualquer sala: ignora (não escreve em socketNicknames)
      if (!roomId || !room) return;
      const isHost = room.hostId === socket.id;

      const nickname = sanitizeNickname(data.name, isHost);
      socketNicknames.set(socket.id, nickname);
      if (!isHost) {
        room.viewerNames.set(socket.id, nickname);
        if (room.viewers.has(socket.id)) {
          const renamed: ViewerRenamedPayload = { viewerId: socket.id, name: nickname };
          io.to(room.hostId).emit('room:viewer-renamed', renamed);
        }
      }
    }),
  );

  // ── Sair da sala voluntariamente ─────────────────────────────────────────
  socket.on('room:leave', () => {
    leaveCurrentRoom(socket, io, roomManager, state);
  });
}
