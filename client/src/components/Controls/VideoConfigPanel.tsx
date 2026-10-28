import React, { useId, useState } from 'react';
import type { VideoConfig } from '@shared/index';
import { IconArrowRight, IconSettings } from '../UI/Icons';
import styles from './VideoConfigPanel.module.css';

interface Props {
  config: VideoConfig;
  onChange: (config: VideoConfig) => void;
  disabled?: boolean;
  isSharing?: boolean;
  /** No app desktop a qualidade já é escolhida no modal de seleção: não repetir aqui */
  hideResolution?: boolean;
}

const RESOLUTIONS = [
  { id: '1080p', label: '1080p', sub: 'FHD', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p', sub: '2K', width: 2560, height: 1440 },
];

/** Painel "Avançado": resolução e taxa de bits ficam recolhidos por padrão */
const VideoConfigPanel: React.FC<Props> = ({
  config,
  onChange,
  disabled = false,
  hideResolution = false,
}) => {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const update = (partial: Partial<VideoConfig>) =>
    onChange({ ...config, ...partial });

  return (
    <div className={styles.container}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen((v) => !v)}
      >
        <IconSettings size={16} className={styles.icon} />
        <span className={styles.title}>Avançado</span>
        <span className={styles.summary}>{config.frameRate} FPS · {(config.bitrate / 1000).toFixed(1)} Mbps</span>
        <IconArrowRight size={14} className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`} />
      </button>

      {open && (
        <div id={bodyId} className={styles.body}>
          {!hideResolution && (
            <div className={styles.field}>
              <span className={styles.fieldLabel} id={`${bodyId}-res`}>Resolução</span>
              <div className={styles.resGrid} role="group" aria-labelledby={`${bodyId}-res`}>
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
          )}

          <div className={styles.field}>
            <div className={styles.fieldHeader}>
              <label className={styles.fieldLabel} htmlFor={`${bodyId}-bitrate`}>Bitrate</label>
              <span className={styles.fieldValue}>{(config.bitrate / 1000).toFixed(1)} Mbps</span>
            </div>
            <input
              id={`${bodyId}-bitrate`}
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
              <span>1 Mbps</span>
              <span>10</span>
              <span>20</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoConfigPanel;
