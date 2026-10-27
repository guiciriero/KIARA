import React from 'react';
import { IconAlertTriangle, IconCheck, IconCopy } from '../UI/Icons';
import StreamControls from '../Controls/StreamControls';
import RoomOptionsPanel, { type RoomOptionsValue } from '../Controls/RoomOptionsPanel';
import JoinRequestsPanel from '../UI/JoinRequestsPanel';
import ViewerListPanel from '../UI/ViewerListPanel';
import type { BroadcastState } from '../../hooks/useBroadcast';
import styles from '../../pages/BroadcastPage.module.css';

interface Props {
  state: BroadcastState;
  previewAtivo: boolean;
  captureSupported: boolean;
  passwordValid: boolean;
  /** O modo privacidade foi pedido mas o servidor não o atendeu */
  privacyIgnored: boolean;
  tunnelDown: boolean;
  displayCode: string;
  displayUrl: string;
  copiedLink: boolean;
  roomOptions: RoomOptionsValue;
  onRoomOptionsChange: (value: RoomOptionsValue) => void;
  onStart: () => void;
  onStop: () => void;
  onTogglePause: () => void;
  onTogglePreview: () => void;
  onCopyLink: () => void;
  onShowQr: () => void;
  onRespondJoin: (viewerId: string, approved: boolean) => void;
  onKickViewer: (viewerId: string, ban: boolean) => void;
}

/** Painel esquerdo: controles de transmissão, link fixo da sala, pedidos de entrada e opções */
const RoomAccessPanel: React.FC<Props> = ({
  state,
  previewAtivo,
  captureSupported,
  passwordValid,
  privacyIgnored,
  tunnelDown,
  displayCode,
  displayUrl,
  copiedLink,
  roomOptions,
  onRoomOptionsChange,
  onStart,
  onStop,
  onTogglePause,
  onTogglePreview,
  onCopyLink,
  onShowQr,
  onRespondJoin,
  onKickViewer,
}) => (
  <aside
    id="studio-room-panel"
    className={styles.sidebarRoom}
    aria-label="Sala e transmissão"
  >
    <div className={styles.sidebarInner}>

    {/* Seção: Controles de transmissão */}
    <div className={styles.panelSection}>
      <StreamControls
        isSharing={state.isSharing}
        isPaused={state.isPaused}
        previewAtivo={previewAtivo}
        onStart={onStart}
        startDisabled={!captureSupported}
        onStop={onStop}
        onTogglePause={onTogglePause}
        onTogglePreview={onTogglePreview}
      />

      {!captureSupported && (
        <div className={styles.errorBox} role="alert">
          <IconAlertTriangle size={16} className={styles.errorIcon} />
          <span>
            Este dispositivo não suporta compartilhamento de tela pelo navegador. Use Chrome, Edge ou o app para Windows.
          </span>
        </div>
      )}

      {!passwordValid && !state.isSharing && (
        <div className={styles.errorBox} role="alert">
          <IconAlertTriangle size={16} className={styles.errorIcon} />
          <span>Corrija a senha antes de continuar.</span>
        </div>
      )}

      {state.error && (
        <div className={styles.errorBox} role="alert">
          <IconAlertTriangle size={16} className={styles.errorIcon} />
          <span>{state.error}</span>
        </div>
      )}
    </div>

    {/* Seção: Link Fixo da Sala (pré e pós-transmissão) */}
    <div className={styles.panelSection}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Link da Sala</span>
        {/* O indicador "Ao Vivo" aparece UMA vez: no LiveScene da barra superior.
            Aqui mostramos só "aguardando" quando offline. */}
        {!state.isSharing && (
          <span className={styles.statusOffline}>Aguardando</span>
        )}
      </div>

      <div className={styles.permanentLinkCard}>
        <div className={styles.permanentLinkMeta}>
          <span className={styles.permanentBadge}>Link Fixo</span>
        </div>

        <div className={styles.codeDisplay}>
          <span className={styles.codeDisplayText}>{displayCode}</span>
        </div>

        <div className={styles.urlCopyRow}>
          <span className={styles.urlDisplayShort} title={displayUrl}>
            {displayUrl.replace(/^https?:\/\//, '')}
          </span>
          <button
            type="button"
            className={`${styles.copyLinkBtn} ${copiedLink ? styles.copyLinkBtnCopied : ''}`}
            onClick={onCopyLink}
            aria-label="Copiar link da sala"
          >
            {copiedLink ? <IconCheck size={14} /> : <IconCopy size={14} />}
            <span>{copiedLink ? 'Copiado!' : 'Copiar'}</span>
          </button>
        </div>

        <button
          type="button"
          className={styles.copyLinkBtn}
          onClick={onShowQr}
          aria-label="Mostrar QR Code do link da sala"
        >
          <span>QR Code</span>
        </button>

        {state.codeChanged && (
          <p className={styles.permanentNote} role="status">
            O código da sala mudou porque o anterior estava em uso. Atualize o link compartilhado.
          </p>
        )}

        {!state.isSharing && (
          <p className={styles.permanentNote}>
            Este link é sempre o mesmo e já pode ser compartilhado. Os espectadores verão uma tela de espera até você iniciar.
          </p>
        )}
      </div>

      {/* Selos da sala e avisos (ao vivo) */}
      {state.isSharing && (
        <>
          <div className={styles.roomBadges}>
            <span className={styles.roomBadge}>
              {state.hasPassword ? 'Protegida por senha' : 'Sem senha'}
            </span>
            {state.requireApproval && <span className={styles.roomBadge}>Aprovação manual</span>}
            {state.privacyMode && <span className={styles.roomBadge}>Modo privacidade</span>}
            {state.e2ee && <span className={styles.roomBadge}>Cifra ponta a ponta</span>}
          </div>

          {privacyIgnored && (
            <div className={styles.tunnelWarning} role="status">
              <IconAlertTriangle size={16} />
              <span>Modo privacidade não ativado: servidor sem TURN. IP pode ficar visível.</span>
            </div>
          )}
          {tunnelDown && (
            <div className={styles.tunnelWarning} role="status">
              <IconAlertTriangle size={16} />
              <span>Túnel público indisponível: link funciona apenas na mesma rede local.</span>
            </div>
          )}
        </>
      )}
    </div>

    {/* Seção: Contagem de espectadores + pedidos de entrada (ao vivo) */}
    {state.isSharing && (
      <div className={styles.panelSection}>
        <JoinRequestsPanel requests={state.pendingRequests} onRespond={onRespondJoin} />
        <ViewerListPanel viewers={state.viewers} onKick={onKickViewer} />
      </div>
    )}

    {/* Seção: Configurações da Sala */}
    <RoomOptionsPanel
      value={roomOptions}
      onChange={onRoomOptionsChange}
      disabled={state.isSharing}
    />

    </div>
  </aside>
);

export default RoomAccessPanel;
