import React from 'react';
import type { UpdateState } from '@shared/index';
import { useUpdater } from '../../hooks/useUpdater';
import styles from './UpdateButton.module.css';

interface ViewProps {
  state: UpdateState | null;
  onCheck: () => void;
  onDownload: () => void;
  onInstall: () => void;
}

/** Parte visual pura (sem hooks): recebe o estado e os callbacks. */
export const UpdateView: React.FC<ViewProps> = ({ state, onCheck, onDownload, onInstall }) => {
  const status = state?.status ?? 'idle';
  let content: React.ReactNode;

  switch (state?.status) {
    case undefined:
    case 'idle':
      content = (
        <button type="button" className={styles.btn} onClick={onCheck} title="Procurar uma versão mais nova do KIARA">
          Atualizar
        </button>
      );
      break;
    case 'disabled':
      content = <span className={styles.text} title={state.message}>Atualizações desativadas</span>;
      break;
    case 'checking':
      content = <span className={styles.text}>Verificando atualizações…</span>;
      break;
    case 'not-available':
      content = (
        <>
          <span className={styles.text}>KIARA {state.currentVersion} está atualizado</span>
          <button type="button" className={styles.btn} onClick={onCheck} title="Verificar novamente">
            Verificar
          </button>
        </>
      );
      break;
    case 'available':
      content = (
        <>
          <span className={styles.text}>Versão {state.latestVersion} disponível</span>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary}`}
            onClick={onDownload}
            title={`Baixar a versão ${state.latestVersion}`}
          >
            Baixar
          </button>
        </>
      );
      break;
    case 'downloading':
      content = (
        <>
          <span className={styles.text}>Baixando… {state.progress}%</span>
          <progress
            className={styles.progress}
            value={state.progress}
            max={100}
            aria-label="Progresso do download da atualização"
          />
        </>
      );
      break;
    case 'downloaded':
      content = (
        <button
          type="button"
          className={`${styles.btn} ${styles.primary}`}
          onClick={onInstall}
          title="Fecha o aplicativo, instala a atualização e abre novamente"
        >
          Reiniciar e atualizar
        </button>
      );
      break;
    case 'error':
      content = (
        <>
          <span className={`${styles.text} ${styles.error}`} role="alert">{state.message}</span>
          <button type="button" className={styles.btn} onClick={onCheck} title="Tentar novamente">
            Tentar novamente
          </button>
        </>
      );
      break;
  }

  return (
    <div className={styles.wrap} data-status={status} aria-live="polite">
      {content}
    </div>
  );
};

/** Botão "Atualizar" do app desktop; não renderiza nada no navegador. */
const UpdateButton: React.FC = () => {
  const { state, check, download, install, supported } = useUpdater();
  if (!supported) return null;
  return (
    <UpdateView
      state={state}
      onCheck={() => void check()}
      onDownload={() => void download()}
      onInstall={() => void install()}
    />
  );
};

export default UpdateButton;
