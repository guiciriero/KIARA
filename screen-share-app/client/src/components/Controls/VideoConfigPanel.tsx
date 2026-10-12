/**
 * VideoConfigPanel.tsx
 * Painel de configuração de resolução, FPS, codec e bitrate.
 * Desabilitado enquanto o compartilhamento estiver ativo.
 */

import React from 'react';
import type { VideoConfig, VideoCodec } from '@shared/index';
import styles from './VideoConfigPanel.module.css';

interface Props {
  config: VideoConfig;
  onChange: (config: VideoConfig) => void;
  disabled: boolean;
}

const RESOLUTIONS = [
  { label: '720p (HD)',  width: 1280, height: 720  },
  { label: '1080p (FHD)', width: 1920, height: 1080 },
  { label: '1440p (QHD)', width: 2560, height: 1440 },
  { label: '4K (UHD)',   width: 3840, height: 2160 },
];

const VideoConfigPanel: React.FC<Props> = ({ config, onChange, disabled }) => {
  const update = (partial: Partial<VideoConfig>) =>
    onChange({ ...config, ...partial });

  const resKey = `${config.width}x${config.height}`;

  return (
    <div className={`${styles.container} ${disabled ? styles.disabled : ''}`}>
      <span className={styles.label}>🎬 Configuração de Vídeo</span>

      <div className={styles.field}>
        <label>Resolução</label>
        <select
          value={resKey}
          disabled={disabled}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            update({ width: w, height: h });
          }}
        >
          {RESOLUTIONS.map((r) => (
            <option key={r.label} value={`${r.width}x${r.height}`}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <label>Taxa de Quadros — {config.frameRate} FPS</label>
        <input
          type="range"
          min={15} max={60} step={5}
          value={config.frameRate}
          disabled={disabled}
          onChange={(e) => update({ frameRate: Number(e.target.value) })}
          className={styles.slider}
        />
        <div className={styles.rangeLabels}><span>15</span><span>60</span></div>
      </div>

      <div className={styles.field}>
        <label>Codec de Vídeo</label>
        <select
          value={config.codec}
          disabled={disabled}
          onChange={(e) => update({ codec: e.target.value as VideoCodec })}
        >
          <option value="H264">H.264 (mais compatível)</option>
          <option value="VP9">VP9 (melhor compressão)</option>
          <option value="H265">H.265 (alta eficiência)</option>
        </select>
      </div>

      <div className={styles.field}>
        <label>Bitrate — {config.bitrate} kbps</label>
        <input
          type="range"
          min={500} max={20000} step={500}
          value={config.bitrate}
          disabled={disabled}
          onChange={(e) => update({ bitrate: Number(e.target.value) })}
          className={styles.slider}
        />
        <div className={styles.rangeLabels}><span>0.5 Mbps</span><span>20 Mbps</span></div>
      </div>

      {disabled && (
        <p className={styles.hint}>
          ⚠️ Encerre o compartilhamento para alterar as configurações.
        </p>
      )}
    </div>
  );
};

export default VideoConfigPanel;
