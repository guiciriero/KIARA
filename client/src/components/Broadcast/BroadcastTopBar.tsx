import React from 'react';
import type { ConnectionState } from '@shared/index';
import {
  KiaraLogo,
  IconArrowLeft,
  IconUsers,
  IconSettings,
} from '../UI/Icons';
import ConnectionBadge from '../UI/ConnectionBadge';
import LiveScene from '../UI/PixelShihTzu/LiveScene';
import styles from '../../pages/BroadcastPage.module.css';

interface Props {
  isSharing: boolean;
  connectionState: ConnectionState;
  viewerCount: number;
  maxViewers: number;
  isSettingsVisible: boolean;
  onToggleSettings: () => void;
  onBack: () => void;
}

/** Barra superior do estúdio: voltar, marca, alternância dos painéis, conexão e espectadores */
const BroadcastTopBar: React.FC<Props> = ({
  isSharing,
  connectionState,
  viewerCount,
  maxViewers,
  isSettingsVisible,
  onToggleSettings,
  onBack,
}) => (
  <header className={`${styles.topBar} ${isSharing ? styles.topBarLive : ''}`}>
    <div className={styles.topBarLeft}>
      <button
        type="button"
        className={styles.backBtn}
        onClick={onBack}
        title="Voltar para a página inicial"
      >
        <IconArrowLeft size={16} />
        <span>Voltar</span>
      </button>
      <div className={styles.divider} />
      <KiaraLogo size={24} withText />
      <span className={styles.studioBadge}>Estúdio do Host</span>
    </div>

    {/* Durante a transmissão: Shih Tzu pedalando e alimentando o computador "LIVE ON" */}
    {isSharing && <LiveScene scale={2} className={styles.liveScene} />}

    <div className={styles.topBarRight}>
      <button
        type="button"
        className={`${styles.settingsToggle} ${!isSettingsVisible ? styles.settingsToggleOff : ''}`}
        onClick={onToggleSettings}
        aria-expanded={isSettingsVisible}
        aria-controls="studio-room-panel studio-config-panel"
        title={isSettingsVisible ? 'Ocultar abas laterais (S)' : 'Exibir abas laterais (S)'}
      >
        <IconSettings size={15} />
        <span>{isSettingsVisible ? 'Ocultar Painéis' : 'Exibir Painéis'}</span>
      </button>

      <ConnectionBadge state={connectionState} />

      {isSharing && (
        <div className={styles.viewersCountPill}>
          <IconUsers size={15} />
          <span>
            <strong>{viewerCount}</strong>
            {maxViewers > 0 ? ` de ${maxViewers}` : ''}{' '}
            espectador{viewerCount !== 1 ? 'es' : ''}
          </span>
        </div>
      )}
    </div>
  </header>
);

export default BroadcastTopBar;
