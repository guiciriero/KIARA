import React from 'react';
import type { ConnectionState } from '@shared/index';
import { IconArrowLeft, IconSettings } from '../UI/Icons';
import ConnectionBadge from '../UI/ConnectionBadge';
import LiveScene from '../UI/PixelShihTzu/LiveScene';
import styles from '../../pages/BroadcastPage.module.css';

interface Props {
  isSharing: boolean;
  connectionState: ConnectionState;
  isSettingsVisible: boolean;
  onToggleSettings: () => void;
  onBack: () => void;
  /** No app Electron o TitleBar já exibe o logo — não duplicar */
  hasTitleBar?: boolean;
}

/**
 * Barra superior do estúdio: voltar, Shih Tzu pedalando durante a transmissão, alternância dos
 * painéis e conexão (só quando há problema). "Ao vivo", tempo e espectadores ficam apenas na
 * barra flutuante do palco.
 */
const BroadcastTopBar: React.FC<Props> = ({
  isSharing,
  connectionState,
  isSettingsVisible,
  onToggleSettings,
  onBack,
  hasTitleBar = false,
}) => (
  <header className={`${styles.topBar} ${isSharing ? styles.topBarLive : ''}`}>
    <div className={styles.topBarLeft}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={onBack}
        title={isSharing ? 'Voltar (a transmissão continua)' : 'Voltar'}
      >
        <IconArrowLeft size={16} />
        <span>Voltar</span>
      </button>
      {!hasTitleBar && <div className={styles.divider} />}
    </div>

    {/* Durante a transmissão: Shih Tzu pedalando e alimentando o computador "LIVE ON" */}
    {isSharing && <LiveScene scale={2} className={styles.liveScene} />}

    <div className={styles.topBarRight}>
      {connectionState !== 'connected' && connectionState !== 'disconnected' && (
        <ConnectionBadge state={connectionState} />
      )}

      <button
        type="button"
        className={`${styles.settingsToggle} ${!isSettingsVisible ? styles.settingsToggleOff : ''}`}
        onClick={onToggleSettings}
        aria-expanded={isSettingsVisible}
        aria-controls="studio-room-panel studio-config-panel"
        aria-keyshortcuts="S"
        title={isSettingsVisible ? 'Ocultar painéis (S)' : 'Mostrar painéis (S)'}
      >
        <IconSettings size={15} />
        <span>{isSettingsVisible ? 'Ocultar' : 'Painéis'}</span>
      </button>
    </div>
  </header>
);

export default BroadcastTopBar;
