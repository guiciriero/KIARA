/**
 * theme.ts — o app tem um único tema (escuro "chocolate", definido em styles/tokens.css).
 * Aqui fica só o modo "em transmissão".
 */

import { useEffect } from 'react';

/**
 * Marca o app como "em transmissão/assistindo": desliga blur e demais efeitos pesados
 * (ver global.css [data-streaming]).
 */
export function useStreamingMode(active: boolean): void {
  useEffect(() => {
    if (!active) return undefined;
    const root = document.documentElement;
    root.dataset.streaming = 'true';
    return () => {
      delete root.dataset.streaming;
    };
  }, [active]);
}