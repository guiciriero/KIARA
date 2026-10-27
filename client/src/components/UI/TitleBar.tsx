/**
 * TitleBar — barra de título personalizada para o app Electron (Windows/Linux).
 *
 * Renderizado em todas as páginas quando `window.screenShareHost?.window` existe.
 * Usa `-webkit-app-region: drag` para arrastar a janela; elementos clicáveis
 * ficam marcados com `no-drag`.
 *
 * No macOS o frame nativo é usado com titleBarStyle:'hidden'; esta barra não é
 * renderizada lá (os semáforos nativos aparecem no lugar).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { KiaraLogo } from '../UI/Icons';
import styles from './TitleBar.module.css';

interface WindowApi {
  minimize: () => Promise<void>;
  maximizeToggle: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (cb: (v: boolean) => void) => () => void;
}

const win = (window.screenShareHost as { window?: WindowApi } | undefined)?.window;

/** Ícones SVG inline para os botões de janela (escala 10px) */
const IconMinimize: React.FC = () => (
  <svg width="10" height="1" viewBox="0 0 10 1" fill="none" aria-hidden="true">
    <rect width="10" height="1" rx="0.5" fill="currentColor" />
  </svg>
);

const IconMaximize: React.FC<{ restore?: boolean }> = ({ restore }) =>
  restore ? (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="2" y="0" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
      <rect x="0" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" rx="1" stroke="currentColor" strokeWidth="1" fill="none" />
    </svg>
  );

const IconClose: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

interface TitleBarProps {
  /** Título da tela atual (exibido uma vez no centro) */
  title?: string;
}

const TitleBar: React.FC<TitleBarProps> = ({ title }) => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!win) return;
    win.isMaximized().then(setMaximized).catch(() => {});
    const unsub = win.onMaximizedChange(setMaximized);
    return unsub;
  }, []);

  const handleMinimize = useCallback(() => { win?.minimize().catch(() => {}); }, []);
  const handleMaximize = useCallback(() => { win?.maximizeToggle().catch(() => {}); }, []);
  const handleClose    = useCallback(() => { win?.close().catch(() => {}); }, []);
  const handleDblClick = useCallback(() => { win?.maximizeToggle().catch(() => {}); }, []);

  if (!win) return null; // Não é Electron com janela customizada

  return (
    <div
      className={styles.titleBar}
      onDoubleClick={handleDblClick}
      role="banner"
    >
      {/* Região de drag ocupa todo o banner; elementos com no-drag interceptam cliques */}

      <div className={`${styles.dragRegion} ${styles.left}`}>
        <div className={styles.noDrag}>
          <KiaraLogo size={16} withText />
        </div>
      </div>

      {title && (
        <div className={styles.titleCenter} aria-live="polite">
          <span className={styles.titleText}>{title}</span>
        </div>
      )}

      <div className={`${styles.dragRegion} ${styles.right}`}>
        <div className={`${styles.noDrag} ${styles.winControls}`}>
          <button
            type="button"
            className={styles.winBtn}
            onClick={handleMinimize}
            title="Minimizar"
            aria-label="Minimizar janela"
          >
            <IconMinimize />
          </button>
          <button
            type="button"
            className={styles.winBtn}
            onClick={handleMaximize}
            title={maximized ? 'Restaurar' : 'Maximizar'}
            aria-label={maximized ? 'Restaurar janela' : 'Maximizar janela'}
          >
            <IconMaximize restore={maximized} />
          </button>
          <button
            type="button"
            className={`${styles.winBtn} ${styles.winBtnClose}`}
            onClick={handleClose}
            title="Fechar"
            aria-label="Fechar janela"
          >
            <IconClose />
          </button>
        </div>
      </div>
    </div>
  );
};

export default TitleBar;
