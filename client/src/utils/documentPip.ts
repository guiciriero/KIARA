/**
 * documentPip.ts
 * Document Picture-in-Picture (Chrome/Edge 116+ e Electron com Chromium recente): abre uma janela
 * flutuante com DOM próprio, onde cabem controles reais (volume, tela cheia, estatísticas).
 * Sem React: funções puras, testáveis com objetos falsos.
 */

/** Tamanho pedido para a janela flutuante (largura x altura, em px) */
export interface PipSize {
  width: number;
  height: number;
}

export interface DocumentPipApi {
  requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean }): Promise<Window>;
  window?: Window | null;
}

/** Janela que expõe `documentPictureInPicture` (só o necessário, para testes) */
export interface DocumentPipHost {
  documentPictureInPicture?: DocumentPipApi;
}

/** Largura padrão da janela flutuante */
export const PIP_DEFAULT_WIDTH = 480;
const PIP_MIN_HEIGHT = 200;
const PIP_MAX_HEIGHT = 540;
const DEFAULT_ASPECT = 16 / 9;

function hostOf(win?: DocumentPipHost): DocumentPipHost | undefined {
  if (win) return win;
  return typeof window === 'undefined' ? undefined : (window as unknown as DocumentPipHost);
}

/** O navegador/Electron oferece `documentPictureInPicture.requestWindow` */
export function isDocumentPipSupported(win?: DocumentPipHost): boolean {
  return typeof hostOf(win)?.documentPictureInPicture?.requestWindow === 'function';
}

/** Tamanho inicial da janela: largura fixa e altura pela proporção do vídeo (com limites) */
export function pipSizeFor(videoWidth?: number, videoHeight?: number): PipSize {
  const aspect =
    videoWidth && videoHeight && videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : DEFAULT_ASPECT;
  const height = Math.round(PIP_DEFAULT_WIDTH / aspect);
  return { width: PIP_DEFAULT_WIDTH, height: Math.min(PIP_MAX_HEIGHT, Math.max(PIP_MIN_HEIGHT, height)) };
}

/**
 * Abre a janela. Precisa ser chamada direto de um gesto do usuário (clique ou tecla).
 * Devolve null se a API não existir ou o navegador recusar; quem chama usa o PiP nativo no lugar.
 */
export async function openDocumentPip(size: PipSize, win?: DocumentPipHost): Promise<Window | null> {
  const api = hostOf(win)?.documentPictureInPicture;
  if (!api || typeof api.requestWindow !== 'function') return null;
  try {
    return await api.requestWindow({ width: size.width, height: size.height });
  } catch (err) {
    console.warn('[KIARA] Não foi possível abrir o Picture-in-Picture de documento:', err);
    return null;
  }
}

// ─── Estilos ─────────────────────────────────────────────────────────────────

interface StyleSheetLike {
  href?: string | null;
  cssRules?: ArrayLike<{ cssText: string }>;
}

interface StyleSourceDocument {
  styleSheets: ArrayLike<StyleSheetLike>;
}

interface StyleTargetDocument {
  head: { appendChild(node: unknown): unknown };
  createElement(tag: string): { textContent?: string | null; rel?: string; href?: string; type?: string; media?: string };
}

/**
 * Copia as folhas de estilo da página para a janela flutuante (os CSS Modules e as variáveis do
 * `:root` precisam existir lá). Folhas ilegíveis (outra origem) viram `<link>`.
 * Devolve quantas folhas foram copiadas.
 */
export function copyStyleSheets(source: StyleSourceDocument, target: StyleTargetDocument): number {
  let copied = 0;
  for (let i = 0; i < source.styleSheets.length; i += 1) {
    const sheet = source.styleSheets[i];
    try {
      if (!sheet.cssRules) throw new Error('sem acesso às regras');
      const css = Array.from(sheet.cssRules, (rule) => rule.cssText).join('\n');
      const style = target.createElement('style');
      style.textContent = css;
      target.head.appendChild(style);
      copied += 1;
    } catch {
      if (!sheet.href) continue;
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.type = 'text/css';
      link.href = sheet.href;
      target.head.appendChild(link);
      copied += 1;
    }
  }
  return copied;
}

// ─── Tela cheia ──────────────────────────────────────────────────────────────

export interface PipWindowLike {
  document: {
    documentElement: { requestFullscreen?: () => Promise<void> };
    fullscreenElement?: unknown;
    fullscreenEnabled?: boolean;
    exitFullscreen?: () => Promise<void>;
  };
  screen: { availWidth: number; availHeight: number; availLeft?: number; availTop?: number };
  outerWidth: number;
  outerHeight: number;
  screenX: number;
  screenY: number;
  resizeTo(width: number, height: number): void;
  moveTo(x: number, y: number): void;
}

/** Tamanho/posição anteriores, guardados para desfazer a expansão */
export interface PipExpandMemory {
  previous?: { width: number; height: number; x: number; y: number };
}

export type PipFullscreenResult = 'fullscreen' | 'exited' | 'expanded' | 'restored' | 'unsupported';

/**
 * Tela cheia da janela flutuante. Tenta a Fullscreen API de verdade; se o navegador recusar nessa
 * janela, alterna entre a janela ampliada para a área útil da tela e o tamanho anterior.
 * Precisa ser chamada de um gesto do usuário dentro da própria janela flutuante.
 */
export async function togglePipFullscreen(
  win: PipWindowLike,
  memory: PipExpandMemory,
): Promise<PipFullscreenResult> {
  const doc = win.document;

  if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') {
    await doc.exitFullscreen();
    return 'exited';
  }

  if (memory.previous) {
    const { width, height, x, y } = memory.previous;
    memory.previous = undefined;
    win.resizeTo(width, height);
    win.moveTo(x, y);
    return 'restored';
  }

  const el = doc.documentElement;
  if (doc.fullscreenEnabled !== false && typeof el.requestFullscreen === 'function') {
    try {
      await el.requestFullscreen();
      return 'fullscreen';
    } catch {
      // cai na ampliação da janela
    }
  }

  if (typeof win.resizeTo !== 'function' || typeof win.moveTo !== 'function') return 'unsupported';
  memory.previous = { width: win.outerWidth, height: win.outerHeight, x: win.screenX, y: win.screenY };
  win.resizeTo(win.screen.availWidth, win.screen.availHeight);
  win.moveTo(win.screen.availLeft ?? 0, win.screen.availTop ?? 0);
  return 'expanded';
}
