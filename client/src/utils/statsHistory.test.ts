import { describe, expect, it } from 'vitest';
import type { StreamStats } from '@shared/index';
import { appendSample, buildSparkline, summarize, HISTORY_WINDOW_MS, type StatsSample } from './statsHistory';

function stats(timestamp: number, over: Partial<StreamStats> = {}): StreamStats {
  return {
    fps: 60,
    videoBitrate: 8000,
    audioBitrate: 128,
    latencyMs: 20,
    packetsLost: 0,
    lossPercent: 0,
    jitterMs: 2,
    qualityLimitation: 'none',
    connectionQuality: 'excellent',
    timestamp,
    ...over,
  };
}

describe('appendSample', () => {
  it('guarda as métricas usadas nos gráficos', () => {
    const h = appendSample([], stats(1000, { fps: 55, latencyMs: 40, videoBitrate: 5000, lossPercent: 1.5 }));
    expect(h).toEqual([{ t: 1000, fps: 55, latencyMs: 40, videoBitrate: 5000, lossPercent: 1.5 }]);
  });

  it('descarta amostras fora dos últimos 30 s, contando da mais nova', () => {
    let h: readonly StatsSample[] = [];
    for (let t = 0; t <= 40_000; t += 2000) h = appendSample(h, stats(t));
    expect(h[0].t).toBe(40_000 - HISTORY_WINDOW_MS);
    expect(h[h.length - 1].t).toBe(40_000);
    expect(h.length).toBe(16);
  });

  it('ignora amostra repetida ou mais antiga e devolve o mesmo array', () => {
    const h = appendSample([], stats(5000));
    expect(appendSample(h, stats(5000))).toBe(h);
    expect(appendSample(h, stats(4000))).toBe(h);
  });

  it('não altera o array recebido', () => {
    const h = appendSample([], stats(1000));
    const next = appendSample(h, stats(3000));
    expect(h).toHaveLength(1);
    expect(next).toHaveLength(2);
  });
});

describe('buildSparkline', () => {
  const opts = { width: 100, height: 20, scaleMax: 10 };

  it('devolve vazio com menos de 2 pontos, mas mantém a referência', () => {
    const g = buildSparkline([5], { ...opts, reference: 10 });
    expect(g.line).toBe('');
    expect(g.area).toBe('');
    expect(g.referenceY).toBe(0);
  });

  it('usa o índice no eixo X quando não há tempos', () => {
    const g = buildSparkline([0, 10], opts);
    expect(g.line).toBe('M0 20 L100 0');
  });

  it('usa o tempo no eixo X: ponto mais novo à direita, mais antigo proporcional à janela', () => {
    const g = buildSparkline([10, 10, 10], { ...opts, times: [0, 15_000, 30_000] });
    expect(g.line).toBe('M0 0 L50 0 L100 0');
    const recente = buildSparkline([10, 10], { ...opts, times: [20_000, 30_000] });
    expect(recente.line.startsWith('M66.67 ')).toBe(true);
  });

  it('cresce a escala quando um valor passa do máximo', () => {
    const g = buildSparkline([0, 20], opts);
    expect(g.line).toBe('M0 20 L100 0');
  });

  it('fecha a área na base', () => {
    const g = buildSparkline([5, 5], opts);
    expect(g.area).toBe('M0 10 L100 10 L100 20 L0 20 Z');
  });

  it('trata valores negativos como zero', () => {
    expect(buildSparkline([-5, 0], opts).line).toBe('M0 20 L100 20');
  });
});

describe('summarize', () => {
  it('devolve mínimo, máximo e último', () => {
    expect(summarize([3, 1, 7, 4])).toEqual({ min: 1, max: 7, last: 4 });
  });

  it('devolve null sem dados', () => {
    expect(summarize([])).toBeNull();
  });
});
