import React from 'react';
import { IconBroadcast, IconPause, IconPlay, IconStop } from '../UI/Icons';
import styles from './StreamControls.module.css';

interface Props {
  isSharing: boolean;
  isPaused: boolean;
  onStart: () => void;
  onStop: () => void;
  onTogglePause: () => void;
  startDisabled?: boolean;
}

const StreamControls: React.FC<Props> = ({
  isSharing,
  isPaused,
  onStart,
  onStop,
  onTogglePause,
  startDisabled = false,
}) => {
  return (
    <div className={styles.container}>
      {!isSharing ? (
        <button type="button" className={styles.btnStart} onClick={onStart} disabled={startDisabled}>
          <IconBroadcast size={20} />
          <span>Iniciar Transmissão</span>
        </button>
      ) : (
        <div className={styles.activeActions}>
          <button
            type="button"
            className={isPaused ? styles.btnResume : styles.btnPause}
            onClick={onTogglePause}
            title={isPaused ? 'Retomar transmissão de tela' : 'Pausar transmissão momentaneamente'}
          >
            {isPaused ? <IconPlay size={17} /> : <IconPause size={17} />}
            <span>{isPaused ? 'Retomar' : 'Pausar'}</span>
          </button>

          <button
            type="button"
            className={styles.btnStop}
            onClick={onStop}
            title="Encerrar transmissão e fechar sala"
          >
            <IconStop size={17} />
            <span>Encerrar</span>
          </button>
        </div>
      )}
    </div>
  );
};

export default StreamControls;
