/**
 * pipStats.ts
 * Estatísticas em formato compacto para a janela flutuante (cabem em poucas linhas).
 */

import type { StreamStats } from '@shared/index';

export type PipStatTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface PipStatItem {
  label: string;
  value: string;
  tone: PipStatTone;
}

function fpsTone(fps: number, target: number): PipStatTone {
  if (fps >= target * 0.93) return 'good';
  if (fps >= target * 0.75) return 'warn';
  return 'bad';
}

/** FPS, resolução, vídeo, latência, perda e jitter prontos para exibir */
export function formatPipStats(stats: StreamStats, targetFps = 60): PipStatItem[] {
  const items: PipStatItem[] = [
    { label: 'FPS', value: `${stats.fps}`, tone: fpsTone(stats.fps, targetFps) },
  ];
  if (stats.encodedWidth && stats.encodedHeight) {
    items.push({ label: 'Resolução', value: `${stats.encodedWidth}×${stats.encodedHeight}`, tone: 'neutral' });
  }
  items.push(
    { label: 'Vídeo', value: `${(stats.videoBitrate / 1000).toFixed(1)} Mbps`, tone: 'neutral' },
    { label: 'Latência', value: `${stats.latencyMs} ms`, tone: stats.latencyMs < 100 ? 'good' : 'warn' },
    { label: 'Perda', value: `${stats.lossPercent.toFixed(1)}%`, tone: stats.lossPercent > 2 ? 'bad' : 'good' },
    { label: 'Jitter', value: `${stats.jitterMs} ms`, tone: stats.jitterMs > 30 ? 'warn' : 'neutral' },
  );
  return items;
}
