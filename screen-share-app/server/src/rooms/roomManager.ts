/**
 * Gerenciador de salas de compartilhamento.
 * Responsável por criar, buscar, atualizar e remover salas.
 * Mantém o estado em memória (para produção, substituir por Redis).
 */

import { randomInt } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type { Room } from '../../../shared/types';
import { logger } from '../utils/logger';

/** Mapa interno: roomId → Room */
type RoomMap = Map<string, Room>;
/** Mapa de código de convite → roomId */
type CodeMap = Map<string, string>;

export class RoomManager {
  private rooms: RoomMap = new Map();
  private codeIndex: CodeMap = new Map();

  /**
   * Gera um código de convite legível e único no formato "XXXXX".
   * Usa apenas letras maiúsculas e dígitos para evitar ambiguidade.
   */
  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code: string;
    do {
      code = Array.from({ length: 6 }, () =>
        chars[randomInt(chars.length)],
      ).join('');
    } while (this.codeIndex.has(code));
    return code;
  }

  /** Cria uma nova sala e retorna o objeto Room */
  createRoom(hostId: string): Room {
    const id = uuidv4();
    const code = this.generateCode();

    const room: Room = {
      id,
      code,
      hostId,
      createdAt: Date.now(),
      viewerCount: 0,
      isActive: true,
    };

    this.rooms.set(id, room);
    this.codeIndex.set(code, id);

    logger.info(`Sala criada: ${id} (código: ${code}) por ${hostId}`);
    return room;
  }

  /** Busca sala por ID */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** Busca sala pelo código de convite */
  getRoomByCode(code: string): Room | undefined {
    const roomId = this.codeIndex.get(code.toUpperCase());
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  /** Incrementa contador de espectadores */
  addViewer(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      room.viewerCount++;
      logger.debug(`Sala ${roomId}: espectador entrou (total: ${room.viewerCount})`);
    }
  }

  /** Decrementa contador de espectadores */
  removeViewer(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room && room.viewerCount > 0) {
      room.viewerCount--;
      logger.debug(`Sala ${roomId}: espectador saiu (total: ${room.viewerCount})`);
    }
  }

  /** Encerra e remove uma sala */
  closeRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) {
      this.codeIndex.delete(room.code);
      this.rooms.delete(roomId);
      logger.info(`Sala encerrada: ${roomId}`);
    }
  }

  /** Retorna todas as salas ativas (para diagnóstico/admin) */
  listRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /** Remove salas antigas (mais de 24h sem atividade) — executar periodicamente */
  pruneStaleRooms(): void {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (const [id, room] of this.rooms.entries()) {
      if (room.createdAt < cutoff) {
        this.closeRoom(id);
        logger.warn(`Sala expirada removida: ${id}`);
      }
    }
  }
}
