/**
 * TitleBar — barra de título unificada do app Electron (sem moldura nativa).
 *
 * - Arrastar: a barra inteira é `drag`; botões e o alternador de tema são `no-drag`.
 * - Duplo clique na barra maximiza/restaura (via IPC `window:maximize-toggle`).
 * - É o ÚNICO lugar com o nome "Kiara" no app desktop (as telas não repetem a marca).
 * - Durante a transmissão/assistindo (`data-streaming`) a barra recolhe e fica discreta
 *   (sem blur), ver TitleBar.module.css.
 * - No macOS o frame nativo usa semáforos (titleBarStyle:'hidden'); aqui só aparecem
 *   a marca e o alternador de tema.
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
// VERIFICAR: detecção de macOS pelo userAgent (semáforos nativos já cobrem os botões).
const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);

const IconMinimize: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const IconMaximize: React.FC<{ restore?: boolean }> = ({ restore }) =>
  restore ? (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="2.5" y="0.6" width="6.9" height="6.9" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
      <rect x="0.6" y="2.5" width="6.9" height="6.9" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
      <rect x="0.7" y="0.7" width="8.6" height="8.6" rx="1.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );

const IconClose: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const TitleBar: React.FC = () => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!win) return undefined;
    win.isMaximized().then(setMaximized).catch(() => {});
    return win.onMaximizedChange(setMaximized);
  }, []);

  const handleMinimize = useCallback(() => { win?.minimize().catch(() => {}); }, []);
  const handleMaximize = useCallback(() => { win?.maximizeToggle().catch(() => {}); }, []);
  const handleClose = useCallback(() => { win?.close().catch(() => {}); }, []);

  if (!win) return null; // Navegador comum: sem barra customizada

  return (
    <header className={styles.titleBar} onDoubleClick={handleMaximize}>
      <div className={styles.brand}>
        <KiaraLogo size={16} withText />
      </div>

      <div className={styles.controls}>
        {!isMac && (
          <div className={styles.winControls}>
            <button
              type="button"
              className={styles.winBtn}
              onClick={handleMinimize}
              onDoubleClick={(e) => e.stopPropagation()}
              title="Minimizar"
              aria-label="Minimizar janela"
            >
              <IconMinimize />
            </button>
            <button
              type="button"
              className={styles.winBtn}
              onClick={handleMaximize}
              onDoubleClick={(e) => e.stopPropagation()}
              title={maximized ? 'Restaurar' : 'Maximizar'}
              aria-label={maximized ? 'Restaurar janela' : 'Maximizar janela'}
            >
              <IconMaximize restore={maximized} />
            </button>
            <button
              type="button"
              className={`${styles.winBtn} ${styles.winBtnClose}`}
              onClick={handleClose}
              onDoubleClick={(e) => e.stopPropagation()}
              title="Fechar"
              aria-label="Fechar janela"
            >
              <IconClose />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default TitleBar;
