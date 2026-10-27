import React from 'react';
import { useUpdater } from '../../hooks/useUpdater';
import styles from './VersionCorner.module.css';

/**
 * Canto inferior direito da tela inicial.
 * – Sem o app desktop: nada é renderizado (unsupported).
 * – Com o app desktop: versão atual + ícone de ação conforme o estado.
 */
const VersionCorner: React.FC = () => {
  const { state, check, download, install, supported } = useUpdater();
  if (!supported) return null;

  const version = state?.currentVersion ?? '…';
  const status = state?.status ?? 'idle';

  /* Ação e label acessível para cada estado */
  let actionLabel: string | null = null;
  let onAction: (() => void) | null = null;
  let dataAttr: string = status;

  if (status === 'idle') {
    actionLabel = 'Verificar atualizações';
    onAction = () => void check();
  } else if (status === 'not-available') {
    actionLabel = 'Verificar atualizações';
    onAction = () => void check();
  } else if (status === 'available') {
    const latestVersion = state?.status === 'available' ? state.latestVersion : '';
    actionLabel = `Baixar versão ${latestVersion}`;
    onAction = () => void download();
    dataAttr = 'available';
  } else if (status === 'downloaded') {
    actionLabel = 'Reiniciar e instalar';
    onAction = () => void install();
    dataAttr = 'downloaded';
  } else if (status === 'error') {
    actionLabel = 'Tentar novamente';
    onAction = () => void check();
    dataAttr = 'error';
  }
  // checking | downloading | disabled: sem ação clicável

  /* Progresso do download (só existe no estado 'downloading' | 'downloaded') */
  const downloadProgress =
    state?.status === 'downloading' || state?.status === 'downloaded'
      ? state.progress
      : 0;

  return (
    <div className={styles.corner} aria-live="polite">
      <span className={styles.version} title={`KIARA v${version}`}>
        v{version}
      </span>

      {/* Indicador de progresso de download */}
      {status === 'downloading' && (
        <div className={styles.progressWrap} title={`Baixando… ${downloadProgress}%`}>
          <div
            className={styles.progressBar}
            style={{ width: `${downloadProgress}%` }}
          />
        </div>
      )}

      {/* Ícone de ação */}
      {onAction && (
        <button
          type="button"
          className={styles.iconBtn}
          onClick={onAction}
          title={actionLabel ?? undefined}
          aria-label={actionLabel ?? undefined}
          data-state={dataAttr}
        >
          {status === 'available' || status === 'downloaded'
            ? <IconDownload />
            : status === 'error'
              ? <IconAlert />
              : <IconCheck />}
        </button>
      )}

      {/* Spinner silencioso durante verificação/download */}
      {(status === 'checking' || status === 'downloading') && (
        <span className={styles.spinner} aria-label="Verificando…" />
      )}
    </div>
  );
};

/* ── Ícones inline mínimos ──────────────────────────────────────────── */
const IconDownload: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2v8M5 7l3 3 3-3" />
    <path d="M3 13h10" />
  </svg>
);

const IconAlert: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 2L1.5 13h13L8 2z" />
    <line x1="8" y1="7" x2="8" y2="9.5" />
    <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
  </svg>
);

const IconCheck: React.FC = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 8.5L6.5 12 13 5" />
  </svg>
);

export default VersionCorner;
