/**
 * audioMixer.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioMixer } from './audioMixer';
import {
  installWebAudioFakes,
  lastContext,
  FakeAudioContext,
  newFakeTrack,
} from '../test/webAudioFakes';
import type { NativeAudioChunk } from '@shared/index';

describe('AudioMixer', () => {
  let restoreWebAudio: () => void;

  beforeEach(() => {
    restoreWebAudio = installWebAudioFakes();
  });

  afterEach(() => {
    restoreWebAudio();
  });

  describe('create', () => {
    it('inicializa o contexto, registra o worklet e cria destination estéreo', async () => {
      const mixer = await AudioMixer.create();
      const ctx = lastContext();

      expect(ctx.resumeCalls).toBe(1);
      expect(ctx.destinations.length).toBe(1);
      expect(ctx.destinations[0].channelCount).toBe(2);
      expect(mixer.track).toBe(ctx.destinations[0].stream.getAudioTracks()[0]);

      // Garante que o alto-falante local não recebe conexões
      expect(ctx.destination.connections.size).toBe(0);

      await mixer.destroy();
    });

    it('fecha o contexto e lança erro amigável quando o worklet falha ao carregar', async () => {
      FakeAudioContext.addModuleError = new Error('404 Not Found');

      await expect(AudioMixer.create()).rejects.toThrow(
        /Não foi possível iniciar o processamento de áudio/,
      );

      const ctx = lastContext();
      expect(ctx.closeCalls).toBe(1);
      expect(ctx.state).toBe('closed');
    });
  });

  describe('fontes PCM', () => {
    it('adiciona fonte PCM e conecta worklet -> gain -> destination', async () => {
      const mixer = await AudioMixer.create();
      const ctx = lastContext();

      mixer.addPcmSource('app-1');
      expect(mixer.hasSource('app-1')).toBe(true);
      expect(mixer.hasSource('app-2')).toBe(false);

      expect(ctx.workletNodes.length).toBe(1);
      expect(ctx.gains.length).toBe(1);

      const worklet = ctx.workletNodes[0];
      const gain = ctx.gains[0];
      const dest = ctx.destinations[0];

      expect(worklet.connections.has(gain)).toBe(true);
      expect(gain.connections.has(dest)).toBe(true);

      // Adição repetida da mesma chave não duplica nós
      mixer.addPcmSource('app-1');
      expect(ctx.workletNodes.length).toBe(1);

      await mixer.destroy();
    });

    it('envia dados PCM com cópia do buffer ao worklet correto', async () => {
      const mixer = await AudioMixer.create();
      const ctx = lastContext();

      mixer.addPcmSource('app-1');
      const worklet = ctx.workletNodes[0];

      const pcmData = new Float32Array([0.1, -0.1, 0.2, -0.2]);
      const chunk: NativeAudioChunk = {
        pid: 100,
        pcm: pcmData,
        frames: 2,
        sampleRate: 48000,
        channels: 2,
      };

      mixer.push('app-1', chunk);

      expect(worklet.port.messages.length).toBe(1);
      const msg = worklet.port.messages[0];
      const sentPcm = (msg.data as { pcm: Float32Array; frames: number }).pcm;
      expect((msg.data as { frames: number }).frames).toBe(2);
      expect(sentPcm).toEqual(pcmData);
      expect(sentPcm).not.toBe(pcmData); // Cópia própria

      // Ignora chaves inexistentes ou frames inválidos
      mixer.push('inexistente', chunk);
      mixer.push('app-1', { ...chunk, frames: 0 });
      expect(worklet.port.messages.length).toBe(1);

      await mixer.destroy();
    });
  });

  describe('fontes de faixa (Track)', () => {
    it('adiciona faixa de áudio e conecta ao destination', async () => {
      const mixer = await AudioMixer.create();
      const ctx = lastContext();
      const track = newFakeTrack();

      mixer.addTrackSource('web:system-audio', track as unknown as MediaStreamTrack);
      expect(mixer.hasSource('web:system-audio')).toBe(true);

      expect(ctx.sourceNodes.length).toBe(1);
      const sourceNode = ctx.sourceNodes[0];
      const gain = ctx.gains[0];
      const dest = ctx.destinations[0];

      expect(sourceNode.connections.has(gain)).toBe(true);
      expect(gain.connections.has(dest)).toBe(true);

      await mixer.destroy();
    });

    it('remove fonte sem parar a faixa original (track.stop)', async () => {
      const mixer = await AudioMixer.create();
      const ctx = lastContext();
      const track = newFakeTrack();

      mixer.addTrackSource('web:system-audio', track as unknown as MediaStreamTrack);
      const sourceNode = ctx.sourceNodes[0];
      const gain = ctx.gains[0];

      mixer.removeSource('web:system-audio');
      expect(mixer.hasSource('web:system-audio')).toBe(false);

      expect(sourceNode.disconnectCount).toBe(1);
      expect(gain.disconnectCount).toBe(1);
      expect(track.stopCount).toBe(0);
      expect(track.readyState).toBe('live');

      await mixer.destroy();
    });
  });

  describe('controle de volume e mute', () => {
    it('ajusta volume com clamp entre 0 e 1', async () => {
      const mixer = await AudioMixer.create();
      const ctx = lastContext();

      mixer.addPcmSource('app-1');
      const gain = ctx.gains[0];

      mixer.setVolume('app-1', 0.6);
      expect(gain.gain.target).toBe(0.6);

      mixer.setVolume('app-1', 1.5);
      expect(gain.gain.target).toBe(1);

      mixer.setVolume('app-1', -0.5);
      expect(gain.gain.target).toBe(0);

      mixer.setVolume('app-1', Number.NaN);
      expect(gain.gain.target).toBe(0);

      await mixer.destroy();
    });

    it('muta e desmuta preservando o volume configurado', async () => {
      const mixer = await AudioMixer.create();
      const ctx = lastContext();

      mixer.addPcmSource('app-1');
      const gain = ctx.gains[0];

      mixer.setVolume('app-1', 0.7);
      expect(gain.gain.target).toBe(0.7);

      mixer.setMuted('app-1', true);
      expect(gain.gain.target).toBe(0);

      mixer.setMuted('app-1', false);
      expect(gain.gain.target).toBe(0.7);

      await mixer.destroy();
    });
  });

  describe('remoção e destruição', () => {
    it('fecha o port do worklet ao remover fonte PCM', async () => {
      const mixer = await AudioMixer.create();
      const ctx = lastContext();

      mixer.addPcmSource('app-1');
      const worklet = ctx.workletNodes[0];

      mixer.removeSource('app-1');
      expect(worklet.port.closed).toBe(true);

      const chunk: NativeAudioChunk = {
        pid: 1,
        pcm: new Float32Array([0, 0]),
        frames: 1,
        sampleRate: 48000,
        channels: 2,
      };
      mixer.push('app-1', chunk);
      expect(worklet.port.messages.length).toBe(0);

      await mixer.destroy();
    });

    it('destroy é idempotente, para a faixa de saída e fecha o contexto', async () => {
      const mixer = await AudioMixer.create();
      const ctx = lastContext();
      const outTrack = mixer.track as unknown as { stopCount: number; readyState: string };

      mixer.addPcmSource('app-1');

      await mixer.destroy();
      expect(outTrack.stopCount).toBe(1);
      expect(outTrack.readyState).toBe('ended');
      expect(ctx.closeCalls).toBe(1);
      expect(ctx.state).toBe('closed');
      expect(mixer.hasSource('app-1')).toBe(false);

      // Segunda chamada não causa erros e não duplica close/stop
      await mixer.destroy();
      expect(outTrack.stopCount).toBe(1);
      expect(ctx.closeCalls).toBe(1);
    });
  });
});
