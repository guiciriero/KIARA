import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { RoomStore } from './roomStore';

describe('RoomStore', () => {
  let tmpDir: string;
  let store: RoomStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiara-store-test-'));
    store = new RoomStore(tmpDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignora erro de limpeza
    }
  });

  it('salva e recupera uma sala permanente por código', () => {
    store.saveRoom({
      id: 'test-room-1',
      code: 'ABCDEF',
      name: 'Canal FPS',
      requireApproval: false,
      privacyMode: false,
      reactionsEnabled: true,
      maxViewers: 10,
      isPermanent: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const retrieved = store.getRoomByCode('ABCDEF');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Canal FPS');
    expect(retrieved?.isPermanent).toBe(true);
  });

  it('persiste os dados e recarrega em uma nova instância', () => {
    store.saveRoom({
      id: 'test-room-2',
      code: 'GAME60',
      name: 'Live 60FPS',
      requireApproval: true,
      privacyMode: true,
      reactionsEnabled: true,
      maxViewers: 20,
      isPermanent: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    const newStoreInstance = new RoomStore(tmpDir);
    const retrieved = newStoreInstance.getRoomByCode('GAME60');
    expect(retrieved).toBeDefined();
    expect(retrieved?.code).toBe('GAME60');
    expect(retrieved?.requireApproval).toBe(true);
  });

  it('registra e recupera métricas de sessão', () => {
    store.recordSessionMetric({
      id: 'session-1',
      roomId: 'room-1',
      roomCode: 'ABCDEF',
      startedAt: Date.now() - 10000,
      endedAt: Date.now(),
      peakViewers: 8,
      avgFps: 60,
      avgBitrateKbps: 6000,
    });

    const metrics = store.getMetrics();
    expect(metrics.length).toBe(1);
    expect(metrics[0].peakViewers).toBe(8);
    expect(metrics[0].avgFps).toBe(60);
  });
});
