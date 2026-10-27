import React from 'react';
import { IconAlertTriangle, IconBroadcast } from '../UI/Icons';
import PixelShihTzu from '../UI/PixelShihTzu/PixelShihTzu';
import styles from '../../pages/BroadcastPage.module.css';

interface Props {
  /** Painéis laterais visíveis; ocultos, o início da transmissão fica aqui */
  isSettingsVisible: boolean;
  startDisabled: boolean;
  error: string | null;
  onStart: () => void;
}

/** Estado do palco antes de transmitir */
const StagePlaceholder: React.FC<Props> = ({ isSettingsVisible, startDisabled, error, onStart }) => (
  <div className={styles.placeholderState}>
    <PixelShihTzu pose="idle" scale={6} speech="Pronto! 🐾" />

    {/* Com painéis visíveis: apenas a dica discreta (botão fica no painel esquerdo) */}
    {isSettingsVisible && (
      <p className={styles.placeholderHint}>
        Configure no painel esquerdo e clique em <strong>Transmitir</strong>.
      </p>
    )}

    {/* Com painéis ocultos: botão de inicio fica aqui */}
    {!isSettingsVisible && (
      <>
        <button
          type="button"
          className={styles.placeholderStart}
          onClick={onStart}
          disabled={startDisabled}
        >
          <IconBroadcast size={18} />
          <span>Transmitir</span>
        </button>
        {error && (
          <div className={styles.errorBox} role="alert">
            <IconAlertTriangle size={16} className={styles.errorIcon} />
            <span>{error}</span>
          </div>
        )}
      </>
    )}
  </div>
);

export default StagePlaceholder;
