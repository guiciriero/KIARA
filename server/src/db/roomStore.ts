/**
 * roomStore.ts
 *
 * Camada de persistência local para salas fixas/permanentes e histórico de sessões.
 * Armazena as salas em disco de forma atômica e resiliente a reinicializações.
 */

import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

export interface PersistentRoomRecord {
  id: string;
  code: string;
  name?: string;
  hostId?: string;
  passwordSaltHex?: string;
  passwordHashHex?: string;
  requireApproval: boolean;
  privacyMode: boolean;
  reactionsEnabled: boolean;
  maxViewers: number;
  isPermanent: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface SessionMetricRecord {
  id: string;
  roomId: string;
  roomCode: string;
  startedAt: number;
  endedAt?: number;
  peakViewers: number;
  avgFps?: number;
  avgBitrateKbps?: number;
}

export class RoomStore {
  private filePath: string;
  private metricsFilePath: string;
  private cache = new Map<string, PersistentRoomRecord>();
  private metrics: SessionMetricRecord[] = [];

  constructor(storageDir?: string) {
    const dir = storageDir || process.env.DATA_DIR || path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (err) {
        logger.warn(`Não foi possível criar diretório de dados em ${dir}:`, err);
      }
    }
    this.filePath = path.join(dir, 'permanent_rooms.json');
    this.metricsFilePath = path.join(dir, 'session_metrics.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw) as PersistentRoomRecord[];
        if (Array.isArray(data)) {
          for (const item of data) {
            if (item.code) {
              this.cache.set(item.code.toUpperCase().trim(), item);
            }
          }
        }
      }
    } catch (err) {
      logger.error('Erro ao carregar salas persistentes do disco:', err);
    }

    try {
      if (fs.existsSync(this.metricsFilePath)) {
        const raw = fs.readFileSync(this.metricsFilePath, 'utf-8');
        const data = JSON.parse(raw) as SessionMetricRecord[];
        if (Array.isArray(data)) {
          this.metrics = data.slice(-500); // mantém histórico recente
        }
      }
    } catch {
      // Ignora erro em arquivo de métricas
    }
  }

  private persistRooms(): void {
    try {
      const items = Array.from(this.cache.values());
      const tempPath = `${this.filePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(items, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.filePath);
    } catch (err) {
      logger.error('Erro ao salvar salas persistentes no disco:', err);
    }
  }

  private persistMetrics(): void {
    try {
      const tempPath = `${this.metricsFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.metrics.slice(-500), null, 2), 'utf-8');
      fs.renameSync(tempPath, this.metricsFilePath);
    } catch (err) {
      logger.error('Erro ao salvar métricas de sessão no disco:', err);
    }
  }

  saveRoom(record: PersistentRoomRecord): void {
    const code = record.code.toUpperCase().trim();
    this.cache.set(code, {
      ...record,
      code,
      updatedAt: Date.now(),
    });
    this.persistRooms();
  }

  getRoomByCode(code: string): PersistentRoomRecord | undefined {
    return this.cache.get(code.toUpperCase().trim());
  }

  deleteRoom(code: string): boolean {
    const deleted = this.cache.delete(code.toUpperCase().trim());
    if (deleted) this.persistRooms();
    return deleted;
  }

  listRooms(): PersistentRoomRecord[] {
    return Array.from(this.cache.values());
  }

  recordSessionMetric(metric: SessionMetricRecord): void {
    this.metrics.push(metric);
    this.persistMetrics();
  }

  getMetrics(limit = 50): SessionMetricRecord[] {
    return this.metrics.slice(-limit);
  }
}
