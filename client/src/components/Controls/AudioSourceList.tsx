import React from 'react';
import type { AudioSource } from '@shared/index';
import { IconAudio, IconVolumeHigh, IconVolumeMute, IconRefresh } from '../UI/Icons';
import styles from './AudioSourceList.module.css';

interface Props {
  sources: AudioSource[];
  selected: Set<string>;
  loading: boolean;
  onToggle: (id: string) => void;
  onVolumeChange: (id: string, volume: number) => void;
  onMuteToggle: (id: string) => void;
  onRefresh: () => void;
  webMode?: boolean;
}

const AudioSourceList: React.FC<Props> = ({
  sources,
  selected,
  loading,
  onToggle,
  onVolumeChange,
  onMuteToggle,
  onRefresh,
  webMode = false,
}) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <IconAudio size={16} className={styles.icon} />
          <span className={styles.title}>Fontes de Áudio</span>
        </div>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={onRefresh}
          disabled={loading}
          title="Atualizar lista de aplicativos com som"
          aria-label="Atualizar fontes de áudio"
        >
          <IconRefresh size={14} className={loading ? styles.spinning : ''} />
        </button>
      </div>

      {webMode && (
        <div className={styles.webNotice}>
          <p>
            No navegador web, o áudio capturado é o do sistema inteiro. Para selecionar áudio de
            aplicativos individuais (jogos, navegadores, reprodutores), use o app para Windows.
          </p>
        </div>
      )}

      {sources.length === 0 && !loading && !webMode && (
        <div className={styles.empty}>
          <span>Nenhum aplicativo com áudio ativo no momento.</span>
        </div>
      )}

      {loading && (
        <div className={styles.loading}>
          <div className={styles.miniSpinner} />
          <span>Localizando fluxos de áudio…</span>
        </div>
      )}

      <ul className={styles.list}>
        {sources.map((src) => {
          const isSelected = selected.has(src.id);
          return (
            <li
              key={src.id}
              className={`${styles.item} ${isSelected ? styles.selected : ''}`}
            >
              <div className={styles.rowMain}>
                <div className={styles.iconWrapper}>
                  {src.iconBase64 ? (
                    <img
                      src={`data:image/png;base64,${src.iconBase64}`}
                      alt=""
                      className={styles.appIcon}
                    />
                  ) : (
                    <IconAudio size={16} />
                  )}
                </div>

                <div className={styles.nameBlock}>
                  <span className={styles.appName} title={src.displayName}>
                    {src.displayName}
                  </span>
                  <span className={styles.pidBadge}>PID {src.processId}</span>
                </div>

                <label className={styles.switch}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggle(src.id)}
                    aria-label={`Incluir áudio de ${src.displayName}`}
                  />
                  <span className={styles.sliderRound} />
                </label>
              </div>

              {/* Slider de Volume se Selecionado */}
              {isSelected && (
                <div className={styles.volumeBlock}>
                  <button
                    type="button"
                    className={`${styles.muteBtn} ${src.isMuted ? styles.muted : ''}`}
                    onClick={() => onMuteToggle(src.id)}
                    title={src.isMuted ? 'Desmutar aplicativo' : 'Mutar aplicativo'}
                    aria-label={src.isMuted ? 'Desmutar' : 'Mutar'}
                  >
                    {src.isMuted ? <IconVolumeMute size={15} /> : <IconVolumeHigh size={15} />}
                  </button>

                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={src.volume}
                    disabled={src.isMuted}
                    onChange={(e) => onVolumeChange(src.id, parseFloat(e.target.value))}
                    className={styles.volSlider}
                    aria-label={`Volume de ${src.displayName}`}
                  />

                  <span className={styles.volPercent}>
                    {src.isMuted ? 'Mudo' : `${Math.round(src.volume * 100)}%`}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AudioSourceList;
