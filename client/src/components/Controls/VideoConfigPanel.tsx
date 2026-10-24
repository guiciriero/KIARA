import React from 'react';
import type { VideoConfig } from '@shared/index';
import { IconSettings } from '../UI/Icons';
import styles from './VideoConfigPanel.module.css';

interface Props {
  config: VideoConfig;
  onChange: (config: VideoConfig) => void;
  disabled?: boolean;
  isSharing?: boolean;
}

const RESOLUTIONS = [
  { id: '1080p', label: '1080p', sub: 'FHD', width: 1920, height: 1080 },
  { id: '1440p', label: '2K',    sub: '2K',  width: 2560, height: 1440 },
];

const VideoConfigPanel: React.FC<Props> = ({ config, onChange, disabled = false }) => {
  const update = (partial: Partial<VideoConfig>) =>
    onChange({ ...config, ...partial });

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <IconSettings size={16} className={styles.icon} />
          <span className={styles.title}>Qualidade de Vídeo</span>
        </div>
      </div>

      {/* Seleção de Resolução */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>Resolução da Transmissão</label>
        <div className={styles.resGrid}>
          {RESOLUTIONS.map((res) => {
            const isSelected = res.width === config.width && res.height === config.height;
            return (
              <button
                key={res.id}
                type="button"
                className={`${styles.resChip} ${isSelected ? styles.selectedRes : ''}`}
                disabled={disabled}
                onClick={() => update({ width: res.width, height: res.height })}
                aria-pressed={isSelected}
              >
                <span className={styles.resLabel}>{res.label}</span>
                <span className={styles.resSub}>{res.sub}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bitrate de Vídeo */}
      <div className={styles.field}>
        <div className={styles.fieldHeader}>
          <label className={styles.fieldLabel}>Taxa de Bits (Bitrate)</label>
          <span className={styles.fieldValue}>{(config.bitrate / 1000).toFixed(1)} Mbps</span>
        </div>
        <input
          type="range"
          min={1000}
          max={20000}
          step={500}
          value={config.bitrate}
          disabled={disabled}
          onChange={(e) => update({ bitrate: Number(e.target.value) })}
          className={styles.slider}
        />
        <div className={styles.rangeMarkers}>
          <span>1.0 Mbps</span>
          <span>10 Mbps</span>
          <span>20 Mbps</span>
        </div>
      </div>

    </div>
  );
};

export default VideoConfigPanel;
