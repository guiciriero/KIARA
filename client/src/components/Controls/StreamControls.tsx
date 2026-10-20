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
          <span>Iniciar Transmissão</span>
        </button>
      ) : (
        <>
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

          <button
            type="button"
            className={previewAtivo ? styles.btnOcultarPreview : styles.btnExibirPreview}
            onClick={onTogglePreview}
            title={previewAtivo ? 'Desabilitar retorno de tela para economizar recursos' : 'Exibir retorno de tela'}
          >
            {previewAtivo ? <IconEyeOff size={15} /> : <IconEye size={15} />}
            <span>{previewAtivo ? 'Ocultar Retorno de Tela' : 'Exibir Retorno de Tela'}</span>
          </button>
        </>
      )}
    </div>
  );
};

export default StreamControls;
