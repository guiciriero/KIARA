import React from 'react';
import { IconEyeOff, IconX } from '../UI/Icons';
import { MINI_MAX_WIDTH, MINI_MIN_WIDTH, MINI_STEP } from '../../utils/miniPlayer';
import styles from '../../pages/BroadcastPage.module.css';

interface Props {
  previewRef: React.RefObject<HTMLVideoElement | null>;
  previewAtivo: boolean;
  /** Retorno local vira miniplayer quando há tela de co-apresentador no player principal */
  isMini: boolean;
  miniVisible: boolean;
  miniWidth: number;
  onResizeMini: (delta: number) => void;
  onToggleMini: () => void;
}

/** Retorno local: ocupa o palco todo ou vira miniplayer flutuante (PiP) */
const HostFeed: React.FC<Props> = ({
  previewRef,
  previewAtivo,
  isMini,
  miniVisible,
  miniWidth,
  onResizeMini,
  onToggleMini,
}) => (
  <div
    className={[
      styles.hostFeed,
      isMini ? styles.hostFeedMini : '',
      isMini && !miniVisible ? styles.hostFeedHidden : '',
    ].join(' ')}
    style={isMini ? ({ '--mini-w': `min(${miniWidth}px, 60vw)` } as React.CSSProperties) : undefined}
    aria-label={isMini ? 'Sua transmissão (miniplayer)' : 'Sua transmissão'}
    aria-hidden={isMini && !miniVisible}
  >
    <video
      ref={previewRef}
      autoPlay
      muted
      playsInline
      className={previewAtivo ? styles.previewVideo : styles.previewVideoOculto}
    />
    {!previewAtivo && (
      <div className={styles.previewDesabilitado}>
        <IconEyeOff size={isMini ? 20 : 32} />
        {!isMini && <span>Retorno de tela desabilitado</span>}
      </div>
    )}
    {isMini && <span className={styles.miniLabel}>Você</span>}

    {isMini && (
      <div className={styles.miniControls} role="group" aria-label="Miniplayer">
        <button
          type="button"
          className={styles.miniBtn}
          onClick={() => onResizeMini(-MINI_STEP * 2)}
          disabled={miniWidth <= MINI_MIN_WIDTH}
          title="Diminuir miniplayer"
          aria-label="Diminuir miniplayer"
        >
          <span aria-hidden="true">−</span>
        </button>
        <button
          type="button"
          className={styles.miniBtn}
          onClick={() => onResizeMini(MINI_STEP * 2)}
          disabled={miniWidth >= MINI_MAX_WIDTH}
          title="Aumentar miniplayer"
          aria-label="Aumentar miniplayer"
        >
          <span aria-hidden="true">+</span>
        </button>
        <button
          type="button"
          className={styles.miniBtn}
          onClick={onToggleMini}
          title="Ocultar miniplayer"
          aria-label="Ocultar miniplayer"
        >
          <IconX size={14} />
        </button>
      </div>
    )}
  </div>
);

export default HostFeed;
