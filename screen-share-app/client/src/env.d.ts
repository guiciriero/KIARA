/// <reference types="vite/client" />

/**
 * Declarações globais do cliente.
 * - "vite/client" habilita os tipos de `import.meta.env.*`.
 * - `window.screenShareHost` é injetado pelo preload do app desktop (Electron)
 *   e NÃO existe no navegador comum — por isso é opcional.
 */

import type { ScreenShareHostApi } from '@shared/index';

declare global {
  interface Window {
    screenShareHost?: ScreenShareHostApi;
  }
}

export {};
