import React from 'react';
import { IconBroadcast, IconPause, IconPlay, IconStop, IconEye, IconEyeOff } from '../UI/Icons';
import styles from './StreamControls.module.css';

interface Props {
  isSharing: boolean;
  isPaused: boolean;
  previewAtivo: boolean;
  onStart: () => void;
  onStop: () => void;
  onTogglePause: () => void;
  onTogglePreview: () => void;
  startDisabled?: boolean;
}

const StreamControls: React.FC<Props> = ({
  isSharing,
  isPaused,
  previewAtivo,
  onStart,
  onStop,
  onTogglePause,
  onTogglePreview,
  startDisabled = false,
}) => {
  return (
    <div className={styles.container}>
      {!isSharing ? (
        <button type="button" className={styles.btnStart} onClick={onStart} disabled={startDisabled}>
          <IconBroadcast size={20} />
          <span>Transmitir</span>
        </button>
      ) : (
        <>
          <div className={styles.activeActions}>
            <button
              type="button"
              className={isPaused ? styles.btnResume : styles.btnPause}
              onClick={onTogglePause}
              title={isPaused ? 'Retomar a transmissão' : 'Pausar momentaneamente'}
            >
              {isPaused ? <IconPlay size={17} /> : <IconPause size={17} />}
              <span>{isPaused ? 'Retomar' : 'Pausar'}</span>
            </button>

            <button
              type="button"
              className={styles.btnStop}
              onClick={onStop}
              title="Encerrar e fechar a sala"
            >
              <IconStop size={17} />
              <span>Encerrar</span>
            </button>
          </div>

          <button
            type="button"
            className={previewAtivo ? styles.btnOcultarPreview : styles.btnExibirPreview}
            onClick={onTogglePreview}
            title={previewAtivo ? 'Ocultar retorno de tela' : 'Mostrar retorno de tela'}
          >
            {previewAtivo ? <IconEyeOff size={15} /> : <IconEye size={15} />}
            <span>{previewAtivo ? 'Ocultar retorno' : 'Ver retorno'}</span>
          </button>
        </>
      )}
    </div>
  );
};

export default StreamControls;
