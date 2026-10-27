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
    <PixelShihTzu pose="idle" scale={6} speech="Tudo pronto para entrar ao vivo! 🐾" />
    <h3>Pronto para transmitir</h3>
    <p>
      Configure a qualidade no painel direito e clique em{' '}
      <strong>Iniciar Transmissão</strong>.
    </p>
    <div className={styles.placeholderSteps}>
      <div className={styles.step}>
        <span className={styles.stepNum}>1</span>
        <span>Escolha tela ou janela</span>
      </div>
      <div className={styles.step}>
        <span className={styles.stepNum}>2</span>
        <span>Defina a qualidade</span>
      </div>
      <div className={styles.step}>
        <span className={styles.stepNum}>3</span>
        <span>Compartilhe o link</span>
      </div>
    </div>

    {/* Com os painéis ocultos, o início da transmissão continua à mão */}
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
  </div>
);

export default StagePlaceholder;
