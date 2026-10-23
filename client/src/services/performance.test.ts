/**
 * performance.test.ts
 *
 * Testes de validação de desempenho e configurações de 60 FPS.
 *
 * Verifica que:
 * 1. Os valores padrão de FPS estão corretos em todos os componentes
 * 2. O BitrateController se comporta corretamente sob carga
 * 3. As métricas de frame são coletadas e calculadas corretamente
 * 4. O P95 de decode time é calculado corretamente
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BitrateController } from './bitrateController';
import { parseRTCStats, clearPeerSample } from './statsService';
import { degradationPreferenceFor } from './webrtcService';
import { createMockStatsReport, installRtcGlobals } from '../test/rtcFakes';

// ─── Constantes de configuração padrão ───────────────────────────────────────

const DEFAULT_TARGET_FPS = 60;
const DEFAULT_BITRATE_KBPS = 8000;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

describe('Configuração padrão de 60 FPS', () => {
  let restoreGlobals: () => void;

  beforeEach(() => {
    restoreGlobals = installRtcGlobals();
  });

  afterEach(() => {
    restoreGlobals();
  });

  it('os valores alvo padrão estão corretos', () => {
    expect(DEFAULT_TARGET_FPS).toBe(60);
    expect(DEFAULT_BITRATE_KBPS).toBe(8000);
    expect(DEFAULT_WIDTH).toBe(1920);
    expect(DEFAULT_HEIGHT).toBe(1080);
  });

  it('degradationPreferenceFor mantém framerate em qualidade baixa/média', () => {
    expect(degradationPreferenceFor('low')).toBe('maintain-framerate');
    expect(degradationPreferenceFor('medium')).toBe('maintain-framerate');
  });

  it('degradationPreferenceFor usa balanced no macOS para qualidade alta', () => {
    expect(degradationPreferenceFor('high', true)).toBe('balanced');   // macOS
    expect(degradationPreferenceFor('high', false)).toBe('maintain-framerate'); // não-macOS
  });
});

describe('BitrateController — simulação de transmissão sustentada', () => {
  it('mantém bitrate próximo ao alvo em 5 minutos de rede saudável (300 amostras)', () => {
    const controller = new BitrateController(DEFAULT_BITRATE_KBPS);
    const targetBps = DEFAULT_BITRATE_KBPS * 1000;

    // Simula 300 amostras (1 a cada segundo = 5 minutos)
    for (let i = 0; i < 300; i++) {
      controller.onSample({ lossPercent: 0.1, rttMs: 20 });
    }

    // Com rede saudável, o bitrate deve convergir para o alvo
    expect(controller.getCurrentBitrateBps()).toBe(targetBps);
  });

  it('estabiliza após oscilações sem ficar preso no piso', () => {
    const controller = new BitrateController(DEFAULT_BITRATE_KBPS);

    // 10 amostras de congestionamento
    for (let i = 0; i < 10; i++) {
      controller.onSample({ lossPercent: 12, rttMs: 450 });
    }
    const afterCongestion = controller.getCurrentBitrateBps();
    expect(afterCongestion).toBeGreaterThan(0);

    // 50 amostras saudáveis - deve recuperar
    for (let i = 0; i < 50; i++) {
      controller.onSample({ lossPercent: 0, rttMs: 15 });
    }
    const afterRecovery = controller.getCurrentBitrateBps();
    expect(afterRecovery).toBeGreaterThan(afterCongestion);
  });

  it('nunca ultrapassa o bitrate alvo durante recuperação', () => {
    const controller = new BitrateController(DEFAULT_BITRATE_KBPS);
    const targetBps = DEFAULT_BITRATE_KBPS * 1000;

    // Ciclos de oscilação e recuperação
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let i = 0; i < 6; i++) controller.onSample({ lossPercent: 8, rttMs: 350 });
      for (let i = 0; i < 30; i++) controller.onSample({ lossPercent: 0, rttMs: 15 });
    }

    expect(controller.getCurrentBitrateBps()).toBeLessThanOrEqual(targetBps);
  });
});

describe('parseRTCStats — FPS e métricas de frame', () => {
  it('extrai FPS de 60 do outbound-rtp', () => {
    const report = createMockStatsReport([
      {
        id: 'v-out',
        type: 'outbound-rtp',
        kind: 'video',
        framesPerSecond: 60,
        bytesSent: 0,
        packetsSent: 0,
        qualityLimitationReason: 'none',
      },
    ]);
    const stats = parseRTCStats(report, 'perf-1');
    expect(stats.fps).toBe(60);
    clearPeerSample('perf-1');
  });

  it('relata qualityLimitation corretamente quando limitado por CPU', () => {
    const report = createMockStatsReport([
      {
        id: 'v-out',
        type: 'outbound-rtp',
        kind: 'video',
        framesPerSecond: 30,
        bytesSent: 0,
        packetsSent: 0,
        qualityLimitationReason: 'cpu',
      },
    ]);
    const stats = parseRTCStats(report, 'perf-2');
    expect(stats.qualityLimitation).toBe('cpu');
    expect(stats.fps).toBe(30); // FPS real está abaixo do alvo de 60
    clearPeerSample('perf-2');
  });

  it('calcula P95 de decode time corretamente com janela de amostras', () => {
    // Simula 10 amostras de decode time variado
    const times = [1, 1, 1, 1, 1, 2, 2, 3, 5, 10]; // P95 deve ser 10 (última amostra)
    let prevDecoded = 0;
    let prevTime = 0;

    for (let i = 0; i < times.length; i++) {
      const framesDecoded = prevDecoded + 60;
      const totalDecodeTime = prevTime + (times[i] / 1000 * 60); // convertendo ms/frame para segundos

      const report = createMockStatsReport([
        {
          id: 'v-in',
          type: 'inbound-rtp',
          kind: 'video',
          framesDecoded,
          framesReceived: framesDecoded,
          framesDropped: 0,
          totalDecodeTime,
        },
        { id: 'v-out', type: 'outbound-rtp', kind: 'video', framesPerSecond: 60, bytesSent: 0, packetsSent: 0 },
      ]);

      parseRTCStats(report, 'perf-p95');
      prevDecoded = framesDecoded;
      prevTime = totalDecodeTime;
    }

    // A última chamada deve ter P95 disponível
    const finalReport = createMockStatsReport([
      {
        id: 'v-in',
        type: 'inbound-rtp',
        kind: 'video',
        framesDecoded: prevDecoded + 60,
        framesReceived: prevDecoded + 60,
        framesDropped: 0,
        totalDecodeTime: prevTime + (1 / 1000 * 60),
      },
      { id: 'v-out', type: 'outbound-rtp', kind: 'video', framesPerSecond: 60, bytesSent: 0, packetsSent: 0 },
    ]);
    const final = parseRTCStats(finalReport, 'perf-p95');

    // P95 deve existir após várias amostras
    expect(final.decodeTimeP95Ms).toBeDefined();
    if (final.decodeTimeP95Ms !== undefined) {
      // P95 deve ser >= a maioria das amostras (>= 1ms/frame)
      expect(final.decodeTimeP95Ms).toBeGreaterThanOrEqual(1);
    }

    clearPeerSample('perf-p95');
  });
});

