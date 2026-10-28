/**
 * useDocumentPip.ts
 * Ciclo de vida da janela flutuante de Document Picture-in-Picture: abre, prepara o documento
 * (estilos e fundo), acompanha o fechamento feito pelo usuário e fecha ao desmontar.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  copyStyleSheets,
  isDocumentPipSupported,
  openDocumentPip,
  pipSizeFor,
} from '../utils/documentPip';

export interface UseDocumentPipResult {
  /** Janela flutuante aberta (null quando fechada) */
  pipWindow: Window | null;
  isOpen: boolean;
  supported: boolean;
  /** Abre a janela. Chame direto do clique/tecla, sem `await` antes (exige gesto do usuário) */
  open: (videoWidth?: number, videoHeight?: number) => Promise<boolean>;
  close: () => void;
}

export function useDocumentPip(): UseDocumentPipResult {
  const [pipWindow, setPipWindow] = useState<Window | null>(null);
  const windowRef = useRef<Window | null>(null);
  const supported = isDocumentPipSupported();

  const open = useCallback(async (videoWidth?: number, videoHeight?: number): Promise<boolean> => {
    if (windowRef.current) return true;
    const win = await openDocumentPip(pipSizeFor(videoWidth, videoHeight));
    if (!win) return false;

    copyStyleSheets(document, win.document);
    Object.assign(win.document.body.style, {
      margin: '0',
      background: 'var(--kiara-media-bg)', // herda os tokens copiados para a janela
      overflow: 'hidden',
    });
    win.document.title = 'Kiara';

    win.addEventListener(
      'pagehide',
      () => {
        if (windowRef.current === win) {
          windowRef.current = null;
          setPipWindow(null);
        }
      },
      { once: true },
    );

    windowRef.current = win;
    setPipWindow(win);
    return true;
  }, []);

  const close = useCallback(() => {
    windowRef.current?.close();
  }, []);

  useEffect(
    () => () => {
      windowRef.current?.close();
    },
    [],
  );

  return { pipWindow, isOpen: pipWindow !== null, supported, open, close };
}
