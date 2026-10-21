/**
 * Gerenciador de salas de compartilhamento KIARA.
 * Responsável por criar, buscar, atualizar e remover salas em memória.
 */

import { randomInt, randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import type { Room } from '@screen-share/shared';
import { logger } from '../utils/logger';

const scryptAsync = promisify(nodeScrypt);

export interface PendingViewer {
  viewerId: string;
  name: string;
  timeout: NodeJS.Timeout;
}

export interface ManagedRoom extends Room {
  passwordSalt?: Buffer;
  passwordHash?: Buffer;
  requireApproval: boolean;
  privacyMode: boolean;
  chatEnabled: boolean;
  reactionsEnabled: boolean;
  maxViewers: number;
  viewers: Set<string>;
  viewerNames: Map<string, string>;
  pendingViewers: Map<string, PendingViewer>;
}

export function getMaxViewersPerRoom(): number {
  const envVal = process.env.MAX_VIEWERS_PER_ROOM;
  if (!envVal) return 8;
  const parsed = parseInt(envVal, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 50) return 8;
  return parsed;
}

export function getRoomMaxHours(): number {
  const envVal = process.env.ROOM_MAX_HOURS;
  if (!envVal) return 12;
  const parsed = parseFloat(envVal);
  if (isNaN(parsed) || parsed <= 0) return 12;
  return parsed;
}

export function getJoinApprovalTimeoutMs(): number {
  const envVal = process.env.JOIN_APPROVAL_TIMEOUT_MS;
  if (!envVal) return 60_000;
  const parsed = parseInt(envVal, 10);
  if (isNaN(parsed) || parsed <= 0) return 60_000;
  return parsed;
}

export function getMaxPendingPerRoom(): number {
  const envVal = process.env.MAX_PENDING_PER_ROOM;
  if (!envVal) return 10;
  const parsed = parseInt(envVal, 10);
  if (isNaN(parsed) || parsed <= 0) return 10;
  return parsed;
}

export function getMaxRooms(): number {
  const envVal = process.env.MAX_ROOMS;
  if (!envVal) return 200;
  const parsed = parseInt(envVal, 10);
  if (isNaN(parsed) || parsed <= 0) return 200;
  return parsed;
}

export class RoomManager {
  private rooms: Map<string, ManagedRoom> = new Map();
  private codeIndex: Map<string, string> = new Map();

  /**
   * Gera um código de convite legível e único no formato de 6 caracteres.
   * Usa apenas letras maiúsculas e dígitos para evitar ambiguidade (sem I, O, 0, 1).
   * Limita a 100 tentativas para evitar loop infinito em caso de saturação.
   */
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    let attempts = 0;
    const maxAttempts = 100;

    do {
      if (attempts++ >= maxAttempts) {
        throw new Error('Não foi possível gerar um código de sala único.');
      }
      code = Array.from({ length: 6 }, () => chars[randomInt(chars.length)]).join('');
    } while (this.codeIndex.has(code));

    return code;
  }

  /** Cria uma nova sala e retorna o objeto ManagedRoom */
  async createRoom(
    hostId: string,
    options?: {
      password?: string;
      requireApproval?: boolean;
      privacyMode?: boolean;
      chatEnabled?: boolean;
      reactionsEnabled?: boolean;
      preferredCode?: string;
    },
  ): Promise<ManagedRoom> {
    if (this.rooms.size >= getMaxRooms()) {
      const err = new Error('Limite máximo de salas atingido.');
      (err as unknown as { code: string }).code = 'SERVER_BUSY';
      throw err;
    }

    const id = randomUUID();
    let code: string;
    const candidateCode =
      typeof options?.preferredCode === 'string'
        ? options.preferredCode.toUpperCase().trim()
        : undefined;

    if (
      candidateCode &&
      /^[A-HJ-NP-Z2-9]{6}$/.test(candidateCode) &&
      !this.codeIndex.has(candidateCode)
    ) {
      code = candidateCode;
    } else {
      code = this.generateCode();
    }

    const maxViewers = getMaxViewersPerRoom();

    let passwordSalt: Buffer | undefined;
    let passwordHash: Buffer | undefined;

    if (options?.password) {
      passwordSalt = randomBytes(16);
      passwordHash = (await scryptAsync(options.password, passwordSalt, 64)) as Buffer;
    }

    const room: ManagedRoom = {
      id,
      code,
      hostId,
      createdAt: Date.now(),
      get viewerCount() {
        return this.viewers.size;
      },
      set viewerCount(_val: number) {
        // Ignora atribuição direta para manter viewerCount estritamente viewers.size
      },
      isActive: true,
      requireApproval: Boolean(options?.requireApproval),
      privacyMode: Boolean(options?.privacyMode),
      chatEnabled: options?.chatEnabled !== false,
      reactionsEnabled: options?.reactionsEnabled !== false,
      maxViewers,
      passwordSalt,
      passwordHash,
      viewers: new Set<string>(),
      viewerNames: new Map<string, string>(),
      pendingViewers: new Map<string, PendingViewer>(),
    };

    this.rooms.set(id, room);
    this.codeIndex.set(code, id);

    const logHost = hostId.slice(0, 8);
    // SEGURANÇA: o código da sala é o segredo de convite — nunca vai para os logs.
    logger.info(`Sala criada: ${id} por ${logHost}`);
    return room;
  }

  /** Busca sala por ID */
  getRoom(roomId: string): ManagedRoom | undefined {
    return this.rooms.get(roomId);
  }

  /** Busca sala pelo código de convite */
  getRoomByCode(code: string): ManagedRoom | undefined {
    const roomId = this.codeIndex.get(code.toUpperCase().trim());
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  /** Verifica se a senha fornecida confere com o hash da sala */
  async verifyPassword(room: ManagedRoom, password?: string): Promise<boolean> {
    if (!room.passwordHash || !room.passwordSalt) {
      return true;
    }
    if (!password) {
      return false;
    }
    try {
      const derived = (await scryptAsync(password, room.passwordSalt, 64)) as Buffer;
      if (derived.length !== room.passwordHash.length) return false;
      return timingSafeEqual(derived, room.passwordHash);
    } catch {
      return false;
    }
  }

  /** Adiciona espectador aprovado à sala */
  addViewer(roomId: string, socketId: string, name?: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.isActive) return false;

    // Remove de pendentes se estiver lá
    this.removePendingViewer(roomId, socketId);

    room.viewers.add(socketId);
    if (name) {
      room.viewerNames.set(socketId, name);
    }
    const logSocket = socketId.slice(0, 8);
    logger.debug(`Sala ${roomId}: espectador ${logSocket} entrou (total: ${room.viewers.size})`);
    return true;
  }

  /** Remove espectador da sala */
  removeViewer(roomId: string, socketId: string): boolean {
    const room = this.rooms.get(roomId);
    if (!room) return false;

    room.viewers.delete(socketId);
    room.viewerNames.delete(socketId);
    const logSocket = socketId.slice(0, 8);
    logger.debug(`Sala ${roomId}: espectador ${logSocket} saiu (total: ${room.viewers.size})`);
    return true;
  }

  /** Adiciona solicitação de entrada pendente */
  addPendingViewer(
    roomId: string,
    viewerId: string,
    name: string,
    onTimeout: () => void,
  ): boolean {
    const room = this.rooms.get(roomId);
    if (!room || !room.isActive) return false;

    if (room.pendingViewers.size >= getMaxPendingPerRoom()) {
      return false;
    }

    // Se já tinha timeout anterior, limpa
    const existing = room.pendingViewers.get(viewerId);
    if (existing) {
      clearTimeout(existing.timeout);
    }

    const timeout = setTimeout(onTimeout, getJoinApprovalTimeoutMs());
    if (typeof timeout.unref === 'function') {
      timeout.unref();
    }

    room.pendingViewers.set(viewerId, {
      viewerId,
      name,
      timeout,
    });

    return true;
  }

  /** Busca solicitação pendente */
  getPendingViewer(roomId: string, viewerId: string): PendingViewer | undefined {
    const room = this.rooms.get(roomId);
    return room?.pendingViewers.get(viewerId);
  }

  /** Remove solicitação pendente e limpa o timer */
  removePendingViewer(roomId: string, viewerId: string): PendingViewer | undefined {
    const room = this.rooms.get(roomId);
    if (!room) return undefined;

    const pending = room.pendingViewers.get(viewerId);
    if (pending) {
      clearTimeout(pending.timeout);
      room.pendingViewers.delete(viewerId);
    }
    return pending;
  }

  /** Encerra e remove uma sala, cancelando todos os timers pendentes */
  closeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.isActive = false;
      for (const pending of room.pendingViewers.values()) {
        clearTimeout(pending.timeout);
      }
      room.pendingViewers.clear();
      room.viewers.clear();
      room.viewerNames.clear();

      this.codeIndex.delete(room.code);
      this.rooms.delete(roomId);
      logger.info(`Sala encerrada: ${roomId}`);
    }
  }

  /** Retorna todas as salas ativas */
  listRooms(): ManagedRoom[] {
    return Array.from(this.rooms.values());
  }

  /** Remove salas antigas que atingiram o limite de horas */
  pruneStaleRooms(onRoomExpired?: (room: ManagedRoom) => void): void {
    const maxHours = getRoomMaxHours();
    const cutoff = Date.now() - maxHours * 60 * 60 * 1000;

    for (const [id, room] of this.rooms.entries()) {
      if (room.createdAt < cutoff) {
        if (onRoomExpired) {
          onRoomExpired(room);
        }
        this.closeRoom(id);
        logger.warn(`Sala expirada removida: ${id} (criada há mais de ${maxHours}h)`);
      }
    }
  }

  /** Encerra todas as salas e limpa recursos */
  clear(): void {
    for (const id of Array.from(this.rooms.keys())) {
      this.closeRoom(id);
    }
  }
}
