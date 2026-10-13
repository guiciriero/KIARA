import React, { useState } from 'react';
import type { StreamStats } from '@shared/index';
import { IconActivity } from './Icons';
import styles from './StatsOverlay.module.css';

interface Props {
  stats: StreamStats;
}

const QUALITY_CONFIG: Record<
  StreamStats['connectionQuality'],
  { label: string; color: string; bg: string }
> = {
  excellent: { label: 'Excelente', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  good:      { label: 'Boa',       color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)' },
  fair:      { label: 'Oscilando', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  poor:      { label: 'Instável',  color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' },
};

const StatsOverlay: React.FC<Props> = ({ stats }) => {
  const [minimized, setMinimized] = useState(false);
  const quality = QUALITY_CONFIG[stats.connectionQuality] || QUALITY_CONFIG.good;

  if (minimized) {
    return (
      <button
        type="button"
        className={styles.minimizedBtn}
        onClick={() => setMinimized(false)}
        title="Mostrar estatísticas de transmissão"
        aria-label="Abrir estatísticas da transmissão"
      >
        <IconActivity size={14} />
        <span>{stats.fps} FPS · {stats.latencyMs}ms</span>
      </button>
    );
  }

  return (
    <div className={styles.overlay} role="region" aria-label="Telemetria da transmissão">
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <IconActivity size={15} className={styles.titleIcon} />
          <span className={styles.title}>Telemetria KIARA</span>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.qualityPill} style={{ background: quality.bg, color: quality.color }}>
            <span className={styles.dot} style={{ background: quality.color }} />
            <span>{quality.label}</span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => setMinimized(true)}
            title="Minimizar HUD"
            aria-label="Minimizar HUD"
          >
            ×
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        <div className={styles.metric}>
          <span className={styles.label}>Taxa de Quadros</span>
          <span className={styles.value}>{stats.fps} <small>FPS</small></span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Vídeo</span>
          <span className={styles.value}>
            {(stats.videoBitrate / 1000).toFixed(1)} <small>Mbps</small>
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Áudio</span>
          <span className={styles.value}>{stats.audioBitrate} <small>kbps</small></span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Latência RTT</span>
          <span className={styles.value} style={{ color: stats.latencyMs < 100 ? '#10b981' : '#f59e0b' }}>
            {stats.latencyMs} <small>ms</small>
          </span>
        </div>
      </div>
    </div>
  );
};

export default StatsOverlay;
