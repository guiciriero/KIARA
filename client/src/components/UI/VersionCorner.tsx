import React, { useEffect, useRef, useState } from 'react';
import { useUpdater } from '../../hooks/useUpdater';
import { IconDownload, IconRefresh, IconCheck, IconAlertTriangle } from './Icons';
import styles from './VersionCorner.module.css';

/** Tempo (ms) que o feedback "Atualizado" fica visível. */
const UPDATED_FEEDBACK_MS = 2200;

/**
 * Canto inferior do menu: versão (lida do app via updater) + botão de atualizar.
 * Estados do botão: normal, verificando (ícone girando), atualização disponível
 * (um único ponto indicador), atualizado (feedback rápido) e erro (mensagem curta).
 * Sem o app desktop: nada é renderizado.
 */
const VersionCorner: React.FC = () => {
  const { state, check, download, install, supported } = useUpdater();
  const [justUpdated, setJustUpdated] = useState(false);
  const prevStatus = useRef<string | null>(null);
  const status = state?.status ?? 'idle';

  // "Atualizado": só aparece quando uma verificação termina sem novidades
  useEffect(() => {
    const wasChecking = prevStatus.current === 'checking';
    prevStatus.current = status;
    if (wasChecking && status === 'not-available') {
      setJustUpdated(true);
      const t = window.setTimeout(() => setJustUpdated(false), UPDATED_FEEDBACK_MS);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [status]);

  if (!supported) return null;

  const version = state?.currentVersion ?? '';

  let label = 'Verificar atualizações';
  let onAction: (() => void) | undefined = () => void check();
  let icon: React.ReactNode = <IconRefresh size={14} />;
  let message = '';

  switch (status) {
    case 'checking':
      label = 'Verificando…';
      onAction = undefined;
      icon = <IconRefresh size={14} className={styles.spin} />;
      break;
    case 'available':
      label = `Baixar versão ${state?.status === 'available' ? state.latestVersion : ''}`.trim();
      onAction = () => void download();
      icon = <IconDownload size={14} />;
      break;
    case 'downloading':
      label = 'Baixando…';
      onAction = undefined;
      icon = <IconRefresh size={14} className={styles.spin} />;
      break;
    case 'downloaded':
      label = 'Reiniciar e atualizar';
      onAction = () => void install();
      icon = <IconDownload size={14} />;
      break;
    case 'error':
      label = 'Tentar de novo';
      onAction = () => void check();
      icon = <IconAlertTriangle size={14} />;
      message = 'Não foi possível atualizar.';
      break;
    case 'disabled':
      return version ? (
        <div className={styles.corner}>
          <span className={styles.version}>v{version}</span>
        </div>
      ) : null;
    default:
      break;
  }

  if (justUpdated) {
    icon = <IconCheck size={14} />;
    message = 'Atualizado';
  }

  const progress =
    state?.status === 'downloading' || state?.status === 'downloaded' ? state.progress : 0;

  return (
    <div className={styles.corner} aria-live="polite">
      {version && <span className={styles.version}>v{version}</span>}

      <button
        type="button"
        className={styles.iconBtn}
        onClick={onAction}
        disabled={!onAction}
        aria-label={label}
        data-tip={label}
        data-state={justUpdated ? 'updated' : status}
      >
        {icon}
        {(status === 'available' || status === 'downloaded') && (
          <span className={styles.dot} aria-hidden="true" />
        )}
      </button>

      {status === 'downloading' && (
        <span className={styles.message}>{progress}%</span>
      )}
      {message && status !== 'downloading' && (
        <span className={styles.message} data-kind={justUpdated ? 'ok' : 'error'}>
          {message}
        </span>
      )}
    </div>
  );
};

export default VersionCorner;
