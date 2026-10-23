/**
 * Handler de sinalização WebRTC e gerenciamento de salas KIARA.
 * Processa todos os eventos Socket.IO com validação estrita de payloads e tratamento de erros.
 */

import { randomUUID } from 'crypto';
import type { Server as SocketIOServer, Socket } from 'socket.io';
import type {
  ReactionEvent,
  RoomErrorPayload,
  RoomCreatedPayload,
  RoomJoinedPayload,
  JoinRequestPayload,
  JoinCancelledPayload,
  CopresentResponsePayload,
  CopresenterChangedPayload,
  VideoCodec,
  ViewerJoinedPayload,
} from '@screen-share/shared';
import type { RoomManager, ManagedRoom } from '../rooms/roomManager';
import { logger } from '../utils/logger';
import { buildInviteUrl } from '../utils/publicUrl';
import { getIceServers, isTurnConfigured } from '../utils/iceServers';
import {
  validateCreateRoomPayload,
  validateRoomFeaturesPayload,
  validateUpdateNamePayload,
  validateJoinRoomPayload,
  validateRespondJoinPayload,
  validateReactionPayload,
  validateOfferPayload,
  validateAnswerPayload,
  validateIceCandidatePayload,
  validateQualityRequestPayload,
  sanitizeStreamConfig,
  sanitizeStreamStats,
  sanitizeNickname,
  validateCopresentStartPayload,
} from '../utils/validators';

/** Mapa de socketId → roomId */
const socketRoomMap = new Map<string, string>();
/** Mapa de socketId → roomId onde o socket tem solicitação pendente de aprovação */
const socketPendingMap = new Map<string, string>();
/** Mapa de socketId → apelido */
const socketNicknames = new Map<string, string>();
/** Mapa de socketId → codecs que o espectador decodifica por hardware (informado em room:join) */
const socketHwDecode = new Map<string, VideoCodec[]>();

/** Anti-força-bruta: máximo de tentativas falhas de room:join por socket na janela */
const MAX_JOIN_FAILURES = 8;
const JOIN_FAILURE_WINDOW_MS = 60_000;
const joinFailures = new Map<string, number[]>();

/**
 * SEGURANÇA (anti-força-bruta além do socket): o limite por socket sozinho é contornado
 * reconectando. Por isso há também limites por IP e por sala (senha), mantidos por instância
 * de setupSignaling (ver dentro dela).
 */
const MAX_JOIN_FAILURES_PER_IP = 40;
const MAX_PASSWORD_FAILURES_PER_ROOM = 30;
const ROOM_PASSWORD_WINDOW_MS = 5 * 60_000;

/** Limite geral de eventos por socket (inunda ICE/stats/nome/qualidade): descarta o excesso */
const EVENT_WINDOW_MS = 10_000;
const EVENT_LIMIT = 600;
const EVENT_HARD_LIMIT = 3_000; // acima disto o socket é desconectado

/** Timestamps recentes de uma chave (poda os antigos) */
function recentHits(map: Map<string, number[]>, key: string, windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  const recent = (map.get(key) ?? []).filter((t) => t > cutoff);
  map.set(key, recent);
  return recent;
}

/** Remove chaves sem eventos recentes (evita crescimento ilimitado do mapa) */
function sweepHits(map: Map<string, number[]>, windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  for (const [key, list] of map) {
    if (!list.some((t) => t > cutoff)) map.delete(key);
  }
}

function recentJoinFailures(socketId: string): number[] {
  const cutoff = Date.now() - JOIN_FAILURE_WINDOW_MS;
  const recent = (joinFailures.get(socketId) ?? []).filter((t) => t > cutoff);
  joinFailures.set(socketId, recent);
  return recent;
}

function registerJoinFailure(socketId: string): void {
  recentJoinFailures(socketId).push(Date.now());
}

/** Rate limit para reações: 10 reações a cada 5 segundos por socket */
const REACTION_LIMIT_MAX = 10;
const REACTION_LIMIT_WINDOW_MS = 5_000;
const reactionTimestamps = new Map<string, number[]>();

function checkReactionRateLimit(socketId: string): boolean {
  const now = Date.now();
  const cutoff = now - REACTION_LIMIT_WINDOW_MS;
  const timestamps = (reactionTimestamps.get(socketId) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= REACTION_LIMIT_MAX) {
    return false;
  }
  timestamps.push(now);
  reactionTimestamps.set(socketId, timestamps);
  return true;
}

/** Wrapper para execução segura de handlers Socket.IO */
function safe(
  socket: Socket,
  fn: (...args: any[]) => Promise<void> | void,
  emitErrorOnThrow: boolean = true,
): (...args: any[]) => void {
  return (...args: any[]) => {
    try {
      const res = fn(...args);
      if (res && typeof res.catch === 'function') {
        res.catch((err: unknown) => {
          logger.error(`Exceção assíncrona no socket ${socket.id.slice(0, 8)}:`, err);
          if (emitErrorOnThrow && socket.connected) {
            const errorPayload: RoomErrorPayload = {
              code: 'internal',
              message: 'Ocorreu um erro interno ao processar a solicitação.',
            };
            socket.emit('room:error', errorPayload);
          }
        });
      }
    } catch (err) {
      logger.error(`Exceção síncrona no socket ${socket.id.slice(0, 8)}:`, err);
      if (emitErrorOnThrow && socket.connected) {
        const errorPayload: RoomErrorPayload = {
          code: 'internal',
          message: 'Ocorreu um erro interno ao processar a solicitação.',
        };
        socket.emit('room:error', errorPayload);
      }
    }
  };
}

export function setupSignaling(io: SocketIOServer, roomManager: RoomManager): () => void {
  // Estado por instância (não compartilhado entre servidores/testes)
  const ipJoinFailures = new Map<string, number[]>();
  const roomPasswordFailures = new Map<string, number[]>();
  const eventBuckets = new Map<string, { start: number; count: number }>();
  /** Sockets com room:create em andamento (evita criar várias salas em paralelo) */
  const creatingRoom = new Set<string>();

  // Limpeza periódica de salas expiradas a cada 5 minutos
  const pruneInterval = setInterval(() => {
    roomManager.pruneStaleRooms((expiredRoom) => {
      logger.warn(`Encerrando sala expirada por limite de tempo: ${expiredRoom.id}`);
      notifyRoomClosed(io, expiredRoom, 'A sala expirou por limite de tempo.');
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

    /** Registra falha de entrada por socket E por IP (reconectar não zera o contador do IP) */
    const registerFailure = (): void => {
      registerJoinFailure(socket.id);
      recentHits(ipJoinFailures, ipKey, JOIN_FAILURE_WINDOW_MS).push(Date.now());
    };

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
                : 'Requisição inválida para criação de sala.',
            };
            socket.emit('room:error', errorPayload);
            return;
          }

          // Se o socket já estiver em alguma sala, sai antes
          leaveCurrentRoom(socket, io, roomManager);

          let room: ManagedRoom;
          try {
            const turnAvailable = isTurnConfigured();
            const privacyRequested = Boolean(validation.payload?.privacyMode);
            const privacyEffective = privacyRequested && turnAvailable;

            room = await roomManager.createRoom(socket.id, {
              password: validation.payload?.password,
              requireApproval: validation.payload?.requireApproval,
              privacyMode: privacyEffective,
              reactionsEnabled: validation.payload?.reactionsEnabled,
              preferredCode: validation.payload?.preferredCode,
            });
          } catch (err: any) {
            if (err?.code === 'SERVER_BUSY') {
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
            leaveCurrentRoom(socket, io, roomManager);
            return;
          }

          const createdPayload: RoomCreatedPayload = {
            roomId: room.id,
            code: room.code,
            inviteUrl: buildInviteUrl(room.code),
            iceServers,
            maxViewers: room.maxViewers,
            hasPassword: Boolean(room.passwordHash),
            requireApproval: room.requireApproval,
            privacyMode: room.privacyMode,
            reactionsEnabled: room.reactionsEnabled,
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
        if (
          recentJoinFailures(socket.id).length >= MAX_JOIN_FAILURES ||
          recentHits(ipJoinFailures, ipKey, JOIN_FAILURE_WINDOW_MS).length >= MAX_JOIN_FAILURES_PER_IP
        ) {
          const errorPayload: RoomErrorPayload = {
            code: 'rate-limited',
            message: 'Muitas tentativas. Aguarde um minuto.',
          };
          socket.emit('room:error', errorPayload);
          return;
        }

        const payload = validateJoinRoomPayload(rawPayload);
        if (!payload) {
          registerJoinFailure(socket.id);
          const errorPayload: RoomErrorPayload = {
            code: 'invalid-code',
            message: 'O código informado não é válido.',
          };
          socket.emit('room:error', errorPayload);
          return;
        }

        const room = roomManager.getRoomByCode(payload.code);
        if (!room) {
          registerJoinFailure(socket.id);
          const errorPayload: RoomErrorPayload = {
            code: 'not-found',
            message: 'Sala não encontrada. Verifique o código e tente novamente.',
          };
          socket.emit('room:error', errorPayload);
          return;
        }

        if (!room.isActive) {
          registerJoinFailure(socket.id);
          const errorPayload: RoomErrorPayload = {
            code: 'closed',
            message: 'Esta sala já foi encerrada pelo apresentador.',
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
        leaveCurrentRoom(socket, io, roomManager);

        const nickname = sanitizeNickname(payload.name, false);
        socketNicknames.set(socket.id, nickname);
        if (payload.hwDecode) socketHwDecode.set(socket.id, payload.hwDecode);
        else socketHwDecode.delete(socket.id);

        // Se a sala exigir aprovação do apresentador
        if (freshRoom.requireApproval) {
          const pendingRoomId = freshRoom.id;
          const pendingHostId = freshRoom.hostId;
          const added = roomManager.addPendingViewer(pendingRoomId, socket.id, nickname, () => {
            // Callback de timeout disparado quando o apresentador não responde a tempo
            socketPendingMap.delete(socket.id);
            roomManager.removePendingViewer(pendingRoomId, socket.id);
            const cancelPayload: JoinCancelledPayload = { viewerId: socket.id };
            io.to(pendingHostId).emit('room:join-cancelled', cancelPayload);
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
        await admitViewerToRoom(socket, freshRoom, nickname, io, roomManager);
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

        await admitViewerToRoom(viewerSocket, room, pending.name, io, roomManager);
      }),
    );

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

        // Sinalização permitida: host↔viewer ou copresentador↔host
        const senderIsCopresenter = roomManager.isCopresenter(roomId, socket.id);
        const targetIsCopresenter = roomManager.isCopresenter(roomId, data.targetId);
        const signalingAllowed =
          room.hostId === socket.id ||
          room.hostId === data.targetId ||
          (senderIsCopresenter && data.targetId === room.hostId) ||
          (targetIsCopresenter && socket.id === room.hostId);
        if (!signalingAllowed) return;

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

        // Sinalização permitida: host↔viewer ou copresentador↔host
        const senderIsCopresenter = roomManager.isCopresenter(roomId, socket.id);
        const targetIsCopresenter = roomManager.isCopresenter(roomId, data.targetId);
        const signalingAllowed =
          room.hostId === socket.id ||
          room.hostId === data.targetId ||
          (senderIsCopresenter && data.targetId === room.hostId) ||
          (targetIsCopresenter && socket.id === room.hostId);
        if (!signalingAllowed) return;

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

        // Sinalização permitida: host↔viewer ou copresentador↔host
        const senderIsCopresenter = roomManager.isCopresenter(roomId, socket.id);
        const targetIsCopresenter = roomManager.isCopresenter(roomId, data.targetId);
        const signalingAllowed =
          room.hostId === socket.id ||
          room.hostId === data.targetId ||
          (senderIsCopresenter && data.targetId === room.hostId) ||
          (targetIsCopresenter && socket.id === room.hostId);
        if (!signalingAllowed) return;

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

    // ── Atualização de funcionalidades da sala (reações) (apenas host) ─────────
    socket.on(
      'room:update-features',
      safe(socket, (rawPayload: unknown) => {
        const data = validateRoomFeaturesPayload(rawPayload);
        if (!data) return;

        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room || !room.isActive || room.hostId !== socket.id) return;

        room.reactionsEnabled = data.reactionsEnabled;

        io.to(roomId).emit('room:features-update', {
          reactionsEnabled: room.reactionsEnabled,
        });
        logger.info(
          `Sala ${roomId}: features atualizadas (reações: ${room.reactionsEnabled})`,
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
        const isHost = room ? room.hostId === socket.id : false;

        const nickname = sanitizeNickname(data.name, isHost);
        socketNicknames.set(socket.id, nickname);
        if (roomId && room && !isHost) {
          room.viewerNames.set(socket.id, nickname);
        }
      }),
    );

    // ── Reação com emoji ─────────────────────────────────────────────────────
    socket.on(
      'chat:reaction',
      safe(socket, (rawPayload: unknown) => {
        const data = validateReactionPayload(rawPayload);
        if (!data) return;

        const roomId = socketRoomMap.get(socket.id);
        if (!roomId) return;

        const room = roomManager.getRoom(roomId);
        if (!room || !room.isActive) return;

        // Se as reações foram desativadas pelo apresentador
        if (!room.reactionsEnabled) return;

        if (!checkReactionRateLimit(socket.id)) return; // Excedente descartado em silêncio

        const isHost = room.hostId === socket.id;
        const senderName = isHost
          ? 'Apresentador'
          : socketNicknames.get(socket.id) || room.viewerNames.get(socket.id) || 'Convidado';

        const reaction: ReactionEvent = {
          id: randomUUID(),
          senderId: socket.id,
          name: senderName,
          emoji: data.emoji,
          timestamp: Date.now(),
        };

        io.to(roomId).emit('chat:reaction', reaction);
      }),
    );

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

    // ── Sair da sala voluntariamente ─────────────────────────────────────────
    socket.on('room:leave', () => {
      leaveCurrentRoom(socket, io, roomManager);
    });

    // ── Desconexão do Socket ─────────────────────────────────────────────────
    socket.on('disconnect', (reason) => {
      logger.info(`Conexão encerrada: ${socketLogId} (motivo: ${reason})`);
      joinFailures.delete(socket.id);
      reactionTimestamps.delete(socket.id);
      // SEGURANÇA (vazamento de memória): estes mapas nunca eram limpos na desconexão
      socketNicknames.delete(socket.id);
      socketHwDecode.delete(socket.id);
      eventBuckets.delete(socket.id);
      creatingRoom.delete(socket.id);
      leaveCurrentRoom(socket, io, roomManager);
    });
  };

  io.on('connection', onConnection);

  return () => {
    clearInterval(pruneInterval);
    io.off('connection', onConnection);
  };
}

/** Notifica espectadores (aprovados e pendentes) que a sala foi encerrada e limpa o estado dos sockets */
function notifyRoomClosed(io: SocketIOServer, room: ManagedRoom, message: string): void {
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
async function admitViewerToRoom(
  socket: Socket,
  room: ManagedRoom,
  nickname: string,
  io: SocketIOServer,
  roomManager: RoomManager,
): Promise<void> {
  // Socket desconectado não pode ocupar vaga da sala
  if (!socket.connected) return;
  roomManager.addViewer(room.id, socket.id, nickname);
  socket.join(room.id);
  socketRoomMap.set(socket.id, room.id);

  const iceServers = await getIceServers(room.id);
  if (!socket.connected) {
    leaveCurrentRoom(socket, io, roomManager);
    return;
  }

  const joinedPayload: RoomJoinedPayload = {
    roomId: room.id,
    hostId: room.hostId,
    viewerCount: room.viewers.size,
    iceServers,
    reactionsEnabled: room.reactionsEnabled,
  };
  socket.emit('room:joined', joinedPayload);

  const viewerJoined: ViewerJoinedPayload = {
    viewerId: socket.id,
    viewerCount: room.viewers.size,
  };
  const hwDecode = socketHwDecode.get(socket.id);
  if (hwDecode) viewerJoined.hwDecode = hwDecode;
  io.to(room.hostId).emit('room:viewer-joined', viewerJoined);

  logger.info(`Espectador ${socket.id.slice(0, 8)} entrou na sala ${room.id}`);
}

/** Remove o socket de qualquer sala ou estado pendente ativo */
function leaveCurrentRoom(
  socket: Socket,
  io: SocketIOServer,
  roomManager: RoomManager,
): void {
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
    // Apresentador saiu: encerra a sala e notifica todos os espectadores
    notifyRoomClosed(io, room, 'O apresentador encerrou o compartilhamento de tela.');
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
