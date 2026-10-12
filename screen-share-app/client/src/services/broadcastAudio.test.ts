/**
 * broadcastAudio.test.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  BroadcastAudio,
  WEB_SYSTEM_AUDIO_ID,
  type AudioSelectionItem,
} from './broadcastAudio';
import { MediaError } from './mediaError';
import {
  installWebAudioFakes,
  lastContext,
  FakeAudioContext,
  newFakeTrack,
} from '../test/webAudioFakes';
import type { NativeAudioChunk, ScreenShareHostApi } from '@shared/index';

function createMockHost() {
  const startCalls: Array<{ pids: number[]; onChunk: (chunk: NativeAudioChunk) => void }> = [];
  let stopCalls = 0;
  let startRejectError: Error | null = null;

  const host: ScreenShareHostApi = {
    platform: 'windows',
    audio: {
      listSources: async () => [],
      start: vi.fn(async (pids, onChunk) => {
        if (startRejectError) throw startRejectError;
        startCalls.push({ pids, onChunk });
      }),
      stop: vi.fn(async () => {
        stopCalls++;
      }),
    },
    capture: {
      listSources: async () => [],
      selectSource: async () => {},
    },
    app: {
      getPublicUrl: async () => null,
      openViewerLink: async () => {},
    },
    updater: {
      getState: async () => ({ status: 'idle', currentVersion: '0.0.0' }),
      check: async () => ({ status: 'idle', currentVersion: '0.0.0' }),
      download: async () => ({ status: 'idle', currentVersion: '0.0.0' }),
      install: async () => ({ status: 'idle', currentVersion: '0.0.0' }),
      onState: () => () => {},
    },
  };

  return {
    host,
    startCalls,
    getStopCalls: () => stopCalls,
    setStartReject: (err: Error | null) => {
      startRejectError = err;
    },
  };
}

describe('BroadcastAudio', () => {
  let restoreWebAudio: () => void;

  beforeEach(() => {
    restoreWebAudio = installWebAudioFakes();
  });

  afterEach(() => {
    restoreWebAudio();
  });

  describe('Criação', () => {
    it('cria instância com faixa estável e activeIds vazio', async () => {
      const { host } = createMockHost();
      const broadcast = await BroadcastAudio.create(host);

      expect(broadcast.track).toBeDefined();
      expect(broadcast.activeIds).toEqual([]);

      await broadcast.destroy();
    });

    it('lança MediaError caso AudioMixer falhe na criação', async () => {
      FakeAudioContext.addModuleError = new Error('Falha no worklet');

      await expect(BroadcastAudio.create()).rejects.toThrow(MediaError);
      await expect(BroadcastAudio.create()).rejects.toMatchObject({
        code: 'audio-unavailable',
      });
    });
  });

  describe('Desktop (com host)', () => {
    it('(a) desktop inicia com App A (pid 1) -> host.audio.start([1])', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 1, muted: false };
      await broadcast.sync([appA]);

      expect(mock.host.audio.start).toHaveBeenCalledTimes(1);
      expect(mock.startCalls[0].pids).toEqual([1]);
      expect(broadcast.activeIds).toEqual(['app-a']);

      await broadcast.destroy();
    });

    it('(b) troca em runtime para App B (pid 2) -> start([2]), mixer sem fonte 1, track de saída é a MESMA instância', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);
      const initialTrack = broadcast.track;

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 1, muted: false };
      await broadcast.sync([appA]);

      const appB: AudioSelectionItem = { id: 'app-b', pid: 2, volume: 0.8, muted: false };
      await broadcast.sync([appB]);

      expect(mock.host.audio.start).toHaveBeenCalledTimes(2);
      expect(mock.startCalls[1].pids).toEqual([2]);
      expect(broadcast.activeIds).toEqual(['app-b']);
      expect(broadcast.track).toBe(initialTrack); // Mesma instância

      await broadcast.destroy();
    });

    it('(c) reverte B->A', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 1, muted: false };
      const appB: AudioSelectionItem = { id: 'app-b', pid: 2, volume: 1, muted: false };

      await broadcast.sync([appA]);
      await broadcast.sync([appB]);
      await broadcast.sync([appA]);

      expect(mock.host.audio.start).toHaveBeenCalledTimes(3);
      expect(mock.startCalls[2].pids).toEqual([1]);
      expect(broadcast.activeIds).toEqual(['app-a']);

      await broadcast.destroy();
    });

    it('(d) A+B juntos', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 1, muted: false };
      const appB: AudioSelectionItem = { id: 'app-b', pid: 2, volume: 0.5, muted: false };

      await broadcast.sync([appA, appB]);

      expect(mock.host.audio.start).toHaveBeenCalledTimes(1);
      expect(mock.startCalls[0].pids).toEqual([1, 2]);
      expect(broadcast.activeIds).toEqual(['app-a', 'app-b']);

      await broadcast.destroy();
    });

    it('(e) mute/unmute leva o ganho alvo a 0 e volta ao volume anterior sem reiniciar a captura', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);
      const ctx = lastContext();

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 0.7, muted: false };
      await broadcast.sync([appA]);

      expect(mock.host.audio.start).toHaveBeenCalledTimes(1);
      const gainNode = ctx.gains[0];
      expect(gainNode.gain.target).toBe(0.7);

      // Muta
      await broadcast.sync([{ ...appA, muted: true }]);
      expect(gainNode.gain.target).toBe(0);
      expect(mock.host.audio.start).toHaveBeenCalledTimes(1); // Não reiniciou captura

      // Desmuta
      await broadcast.sync([{ ...appA, muted: false }]);
      expect(gainNode.gain.target).toBe(0.7);
      expect(mock.host.audio.start).toHaveBeenCalledTimes(1); // Não reiniciou captura

      await broadcast.destroy();
    });

    it('(f) desativar tudo -> host.audio.stop() e reativar -> start', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 1, muted: false };
      await broadcast.sync([appA]);
      expect(mock.host.audio.start).toHaveBeenCalledTimes(1);

      // Desativa tudo
      await broadcast.sync([]);
      expect(mock.host.audio.stop).toHaveBeenCalledTimes(1);
      expect(broadcast.activeIds).toEqual([]);

      // Reativa
      await broadcast.sync([appA]);
      expect(mock.host.audio.start).toHaveBeenCalledTimes(2);
      expect(mock.startCalls[1].pids).toEqual([1]);
      expect(broadcast.activeIds).toEqual(['app-a']);

      await broadcast.destroy();
    });

    it('(g) falha no host.audio.start -> sync lança MediaError e activeIds reflete o estado revertido', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 1, muted: false };
      await broadcast.sync([appA]);
      expect(broadcast.activeIds).toEqual(['app-a']);

      // Próxima chamada de start vai falhar
      mock.setStartReject(new Error('Processo bloqueado'));

      const appB: AudioSelectionItem = { id: 'app-b', pid: 2, volume: 1, muted: false };
      await expect(broadcast.sync([appB])).rejects.toThrow(MediaError);

      // activeIds e o mixer voltaram ao estado do App A
      expect(broadcast.activeIds).toEqual(['app-a']);

      await broadcast.destroy();
    });

    it('(h) sync concorrentes serializam/coalescem', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 1, muted: false };
      const appB: AudioSelectionItem = { id: 'app-b', pid: 2, volume: 1, muted: false };
      const appC: AudioSelectionItem = { id: 'app-c', pid: 3, volume: 1, muted: false };

      // Dispara 3 syncs simultâneos
      const p1 = broadcast.sync([appA]);
      const p2 = broadcast.sync([appB]);
      const p3 = broadcast.sync([appC]);

      await Promise.all([p1, p2, p3]);

      // Apenas a última seleção ([appC]) deve ter sido iniciada no host
      expect(broadcast.activeIds).toEqual(['app-c']);
      expect(mock.startCalls.length).toBe(1);
      expect(mock.startCalls[0].pids).toEqual([3]);

      await broadcast.destroy();
    });

    it('(k) chunk de PID removido não gera postMessage', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);
      const ctx = lastContext();

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 1, muted: false };
      await broadcast.sync([appA]);

      const workletA = ctx.workletNodes[0];
      const onChunkCallback = mock.startCalls[0].onChunk;

      // Troca para App B
      const appB: AudioSelectionItem = { id: 'app-b', pid: 2, volume: 1, muted: false };
      await broadcast.sync([appB]);

      // Envia chunk atrasado do PID 1 (removido)
      const lateChunk: NativeAudioChunk = {
        pid: 1,
        pcm: new Float32Array([0.5, -0.5]),
        frames: 1,
        sampleRate: 48000,
        channels: 2,
      };
      onChunkCallback(lateChunk);

      // Não deve ter postMessage para o workletA fechado
      expect(workletA.port.messages.length).toBe(0);

      await broadcast.destroy();
    });
  });

  describe('Web (sem host)', () => {
    it('(i) web: ligar/desligar fonte sistema reutiliza a mesma faixa sem stop(), sem faixa -> MediaError audio-unavailable', async () => {
      const broadcast = await BroadcastAudio.create();
      const fakeTrack = newFakeTrack();

      // Sem faixa anexada -> erro
      const selection: AudioSelectionItem[] = [
        { id: WEB_SYSTEM_AUDIO_ID, pid: 0, volume: 0.9, muted: false },
      ];
      await expect(broadcast.sync(selection)).rejects.toMatchObject({
        code: 'audio-unavailable',
      });

      // Anexa faixa e sincroniza
      broadcast.attachSystemAudio([fakeTrack as unknown as MediaStreamTrack]);
      await broadcast.sync(selection);
      expect(broadcast.activeIds).toEqual([WEB_SYSTEM_AUDIO_ID]);

      // Desliga a fonte do sistema
      await broadcast.sync([]);
      expect(broadcast.activeIds).toEqual([]);
      expect(fakeTrack.stopCount).toBe(0); // NÃO parou a faixa
      expect(fakeTrack.readyState).toBe('live');

      // Religa usando a mesma faixa
      await broadcast.sync(selection);
      expect(broadcast.activeIds).toEqual([WEB_SYSTEM_AUDIO_ID]);
      expect(fakeTrack.stopCount).toBe(0);

      await broadcast.destroy();
    });
  });

  describe('Destruição', () => {
    it('(j) destroy idempotente, desconecta todos os nós e para a faixa de saída', async () => {
      const mock = createMockHost();
      const broadcast = await BroadcastAudio.create(mock.host);
      const ctx = lastContext();
      const outTrack = broadcast.track as unknown as { stopCount: number; readyState: string };

      const appA: AudioSelectionItem = { id: 'app-a', pid: 1, volume: 1, muted: false };
      await broadcast.sync([appA]);

      await broadcast.destroy();

      expect(mock.host.audio.stop).toHaveBeenCalledTimes(1);
      expect(outTrack.stopCount).toBe(1);
      expect(outTrack.readyState).toBe('ended');
      expect(ctx.state).toBe('closed');
      expect(broadcast.activeIds).toEqual([]);

      // Chamada repetida não quebra
      await broadcast.destroy();
      expect(mock.host.audio.stop).toHaveBeenCalledTimes(1);
    });
  });
});
