/**
 * AudioSourceList.tsx
 * Lista os aplicativos com saída de áudio disponível para captura.
 * Exibe controle de volume individual (slider) e botão de mute por fonte.
 */

import React from 'react';
import type { AudioSource } from '@shared/index';
import styles from './AudioSourceList.module.css';

interface Props {
  sources: AudioSource[];
  selected: Set<string>;
  loading: boolean;
  onToggle: (id: string) => void;
  onVolumeChange: (id: string, volume: number) => void;
  onMuteToggle: (id: string) => void;
  onRefresh: () => void;
}

const AudioSourceList: React.FC<Props> = ({
  sources, selected, loading, onToggle, onVolumeChange, onMuteToggle, onRefresh,
}) => {
  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <span className={styles.label}>🎵 Fontes de Áudio</span>
        <button
          className={styles.refreshBtn}
          onClick={onRefresh}
          disabled={loading}
          title="Atualizar lista"
        >
          {loading ? '…' : '↻'}
        </button>
      </div>

      {sources.length === 0 && !loading && (
        <p className={styles.empty}>Nenhum aplicativo com áudio encontrado.</p>
      )}

      {loading && <p className={styles.empty}>Buscando aplicativos com áudio…</p>}

      <ul className={styles.list}>
        {sources.map((src) => {
          const isSelected = selected.has(src.id);
          return (
            <li key={src.id} className={`${styles.item} ${isSelected ? styles.selected : ''}`}>
              {/* Ícone do processo ou fallback */}
              <div className={styles.icon}>
                {src.iconBase64
                  ? <img src={`data:image/png;base64,${src.iconBase64}`} alt="" />
                  : <span>🔊</span>}
              </div>

              <div className={styles.info}>
                <div className={styles.nameRow}>
                  <span className={styles.name}>{src.displayName}</span>
                  <label className={styles.checkbox}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(src.id)}
                    />
                  </label>
                </div>

                {/* Controles de volume — só exibidos quando selecionado */}
                {isSelected && (
                  <div className={styles.volumeRow}>
                    <button
                      className={`${styles.muteBtn} ${src.isMuted ? styles.muted : ''}`}
                      onClick={() => onMuteToggle(src.id)}
                      title={src.isMuted ? 'Desativar mute' : 'Mutar'}
                    >
                      {src.isMuted ? '🔇' : '🔉'}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={src.volume}
                      disabled={src.isMuted}
                      onChange={(e) => onVolumeChange(src.id, parseFloat(e.target.value))}
                      className={styles.slider}
                    />
                    <span className={styles.volumeLabel}>
                      {Math.round(src.volume * 100)}%
                    </span>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AudioSourceList;
