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

/** Painel esquerdo: ação principal, código/link da sala, pedidos de entrada e opções */
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
    aria-label="Sala"
  >
    <div className={styles.sidebarInner}>

    {/* Ação principal: só antes de transmitir. No ar, pausa/parar/retorno ficam na barra do palco */}
    <div className={styles.panelSection}>
      {!state.isSharing && (
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
      )}

      {!captureSupported && (
        <div className={styles.errorBox} role="alert">
          <IconAlertTriangle size={16} className={styles.errorIcon} />
          <span>
            Este navegador não compartilha a tela. Use Chrome, Edge ou o app para Windows.
          </span>
        </div>
      )}

      {!passwordValid && !state.isSharing && (
        <div className={styles.errorBox} role="alert">
          <IconAlertTriangle size={16} className={styles.errorIcon} />
          <span>Ajuste a senha para continuar.</span>
        </div>
      )}

      {state.error && (
        <div className={styles.errorBox} role="alert">
          <IconAlertTriangle size={16} className={styles.errorIcon} />
          <span>{state.error}</span>
        </div>
      )}
    </div>

    {/* Código e link da sala: o mesmo em toda transmissão, disponível antes de começar */}
    <div className={styles.panelSection}>
      <div className={styles.permanentLinkCard}>
        <div className={styles.codeDisplay}>
          <span className={styles.codeDisplayText} aria-label="Código da sala">{displayCode}</span>
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
            <span aria-live="polite">{copiedLink ? 'Copiado' : 'Copiar'}</span>
          </button>
        </div>

        <button
          type="button"
          className={styles.copyLinkBtn}
          onClick={onShowQr}
          aria-label="Mostrar QR Code da sala"
        >
          <span>QR Code</span>
        </button>

        {state.codeChanged && (
          <p className={styles.permanentNote} role="status">
            O código mudou porque o anterior estava em uso. Envie o novo link.
          </p>
        )}

        {!state.isSharing && (
          <p className={styles.permanentNote}>
            Este link não muda. Quem entrar espera até você transmitir.
          </p>
        )}
      </div>

      {/* Selos da sala e avisos (no ar) */}
      {state.isSharing && (
        <>
          <div className={styles.roomBadges}>
            <span className={styles.roomBadge}>
              {state.hasPassword ? 'Com senha' : 'Sem senha'}
            </span>
            {state.requireApproval && <span className={styles.roomBadge}>Com aprovação</span>}
            {state.privacyMode && <span className={styles.roomBadge}>Privacidade</span>}
            {state.e2ee && <span className={styles.roomBadge}>Criptografia total</span>}
          </div>

          {privacyIgnored && (
            <div className={styles.tunnelWarning} role="status">
              <IconAlertTriangle size={16} />
              <span>Privacidade indisponível: o servidor não tem TURN e seu IP pode aparecer.</span>
            </div>
          )}
          {tunnelDown && (
            <div className={styles.tunnelWarning} role="status">
              <IconAlertTriangle size={16} />
              <span>Sem túnel público: o link só funciona na mesma rede.</span>
            </div>
          )}
        </>
      )}
    </div>

    {/* Pedidos de entrada e espectadores (no ar) */}
    {state.isSharing && (
      <div className={styles.panelSection}>
        <JoinRequestsPanel requests={state.pendingRequests} onRespond={onRespondJoin} />
        <ViewerListPanel viewers={state.viewers} onKick={onKickViewer} />
      </div>
    )}

    {/* Opções da sala */}
    <RoomOptionsPanel
      value={roomOptions}
      onChange={onRoomOptionsChange}
      disabled={state.isSharing}
    />

    </div>
  </aside>
);

export default RoomAccessPanel;
