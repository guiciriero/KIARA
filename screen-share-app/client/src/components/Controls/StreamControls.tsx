/**
 * StreamControls.tsx
 * Botões de controle do compartilhamento: Iniciar, Pausar/Retomar, Encerrar.
 */

import React from 'react';
import styles from './StreamControls.module.css';

interface Props {
  isSharing: boolean;
  isPaused: boolean;
  onStart: () => void;
  onStop: () => void;
  onTogglePause: () => void;
}

const StreamControls: React.FC<Props> = ({
  isSharing, isPaused, onStart, onStop, onTogglePause,
}) => {
  return (
    <div className={styles.container}>
      {!isSharing ? (
        <button className={styles.btnStart} onClick={onStart}>
          ▶ Iniciar Compartilhamento
        </button>
      ) : (
        <>
          <button
            className={isPaused ? styles.btnResume : styles.btnPause}
            onClick={onTogglePause}
          >
            {isPaused ? '▶ Retomar' : '⏸ Pausar'}
          </button>
          <button className={styles.btnStop} onClick={onStop}>
            ⏹ Encerrar
          </button>
        </>
      )}
    </div>
  );
};

export default StreamControls;
