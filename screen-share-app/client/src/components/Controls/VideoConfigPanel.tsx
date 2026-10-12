import React from 'react';
import type { VideoConfig, VideoCodec } from '@shared/index';
import { IconSettings } from '../UI/Icons';
import styles from './VideoConfigPanel.module.css';

interface Props {
  config: VideoConfig;
  onChange: (config: VideoConfig) => void;
  disabled: boolean;
}

const RESOLUTIONS = [
  { id: '720p',  label: '720p',  sub: 'HD',  width: 1280, height: 720  },
  { id: '1080p', label: '1080p', sub: 'FHD', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p', sub: '2K',  width: 2560, height: 1440 },
  { id: '4k',    label: '4K',    sub: 'UHD', width: 3840, height: 2160 },
];

const VideoConfigPanel: React.FC<Props> = ({ config, onChange, disabled }) => {
  const update = (partial: Partial<VideoConfig>) =>
    onChange({ ...config, ...partial });

  return (
    <div className={`${styles.container} ${disabled ? styles.disabled : ''}`}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <IconSettings size={16} className={styles.icon} />
          <span className={styles.title}>Qualidade de Vídeo</span>
        </div>
        {disabled && <span className={styles.lockedBadge}>Bloqueado ao Vivo</span>}
      </div>

      {/* Seleção de Resolução em Chips/Pills Modernos */}
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

      {/* Taxa de Quadros (FPS) */}
      <div className={styles.field}>
        <div className={styles.fieldHeader}>
          <label className={styles.fieldLabel}>Taxa de Quadros</label>
          <span className={styles.fieldValue}>{config.frameRate} FPS</span>
        </div>
        <input
          type="range"
          min={15}
          max={60}
          step={5}
          value={config.frameRate}
          disabled={disabled}
          onChange={(e) => update({ frameRate: Number(e.target.value) })}
          className={styles.slider}
        />
        <div className={styles.rangeMarkers}>
          <span>15 FPS</span>
          <span>30 FPS</span>
          <span>60 FPS</span>
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

      {/* Codec */}
      <div className={styles.field}>
        <label className={styles.fieldLabel}>Codec de Vídeo</label>
        <div className={styles.selectWrapper}>
          <select
            value={config.codec}
            disabled={disabled}
            onChange={(e) => update({ codec: e.target.value as VideoCodec })}
            className={styles.select}
          >
            <option value="H264">H.264 (Universal / Compatibilidade Total)</option>
            <option value="VP9">VP9 (Eficiência e Qualidade Superior)</option>
            <option value="H265">H.265 / HEVC (Alta Performance)</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default VideoConfigPanel;
