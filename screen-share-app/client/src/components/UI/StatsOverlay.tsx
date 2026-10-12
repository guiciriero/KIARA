/**
 * StatsOverlay.tsx
 * Overlay de estatísticas exibido sobre o preview/player de vídeo.
 * Mostra: FPS, bitrate de vídeo/áudio, latência e qualidade da conexão.
 */

import React from 'react';
import type { StreamStats } from '@shared/index';
import styles from './StatsOverlay.module.css';

interface Props {
  stats: StreamStats;
}

const QUALITY_COLORS: Record<StreamStats['connectionQuality'], string> = {
  excellent: '#4caf7d',
  good:      '#8bc34a',
  fair:      '#ffc107',
  poor:      '#ef5350',
};

const QUALITY_LABELS: Record<StreamStats['connectionQuality'], string> = {
  excellent: '● Excelente',
  good:      '● Boa',
  fair:      '● Regular',
  poor:      '● Fraca',
};

const StatsOverlay: React.FC<Props> = ({ stats }) => {
  const qualityColor = QUALITY_COLORS[stats.connectionQuality];

  return (
    <div className={styles.overlay}>
      <div className={styles.badge} style={{ borderColor: qualityColor }}>
        <span className={styles.dot} style={{ background: qualityColor }} />
        <span className={styles.qualityLabel} style={{ color: qualityColor }}>
          {QUALITY_LABELS[stats.connectionQuality]}
        </span>
      </div>

      <div className={styles.metrics}>
        <Metric label="FPS"      value={`${stats.fps}`} />
        <Metric label="Vídeo"    value={`${(stats.videoBitrate / 1000).toFixed(1)} Mbps`} />
        <Metric label="Áudio"    value={`${stats.audioBitrate} kbps`} />
        <Metric label="Latência" value={`${stats.latencyMs} ms`} />
      </div>
    </div>
  );
};

const Metric: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className={styles.metric}>
    <span className={styles.metricLabel}>{label}</span>
    <span className={styles.metricValue}>{value}</span>
  </div>
);

export default StatsOverlay;
