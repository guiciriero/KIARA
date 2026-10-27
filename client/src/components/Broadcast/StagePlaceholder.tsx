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
    {/* Shitzu é o hero da tela — speech dá o contexto, sem duplicar botões */}
    <PixelShihTzu pose="idle" scale={6} speech="Tudo pronto! 🐾" />

    {/* Com os painéis ocultos, o botão de início fica aqui para o usuário não se perder */}
    {!isSettingsVisible && (
      <>
        <button
          type="button"
          className={styles.placeholderStart}
          onClick={onStart}
          disabled={startDisabled}
        >
          <IconBroadcast size={18} />
          <span>Iniciar Transmissão</span>
        </button>
        {error && (
          <div className={styles.errorBox} role="alert">
            <IconAlertTriangle size={16} className={styles.errorIcon} />
            <span>{error}</span>
          </div>
        )}
      </>
    )}

    {/* Com painéis visíveis, o contexto já é dado pelo painel esquerdo */}
    {isSettingsVisible && (
      <p className={styles.placeholderHint}>
        Configure no painel esquerdo e clique em <strong>Iniciar Transmissão</strong>.
      </p>
    )}
  </div>
);

export default StagePlaceholder;
