/**
 * pip.ts
 * Utilitários para suporte à API nativa de Picture-in-Picture (janela flutuante sobreposta).
 */

export interface PipDocument {
  pictureInPictureEnabled?: boolean;
  pictureInPictureElement?: Element | null;
  exitPictureInPicture?: () => Promise<void>;
}

export interface PipVideoElement {
  requestPictureInPicture?: () => Promise<unknown>;
  disablePictureInPicture?: boolean;
  readyState?: number;
}

/** Verifica se o navegador/ambiente suporta a API Picture-in-Picture */
export function isPictureInPictureSupported(doc?: PipDocument): boolean {
  if (doc) return Boolean(doc.pictureInPictureEnabled);
  if (typeof document === 'undefined') return false;
  return Boolean(
    document.pictureInPictureEnabled &&
    typeof HTMLVideoElement !== 'undefined' &&
    typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function',
  );
}

/** Verifica se um elemento de vídeo específico está atualmente em PiP */
export function isVideoInPip(
  video: Element | null | undefined,
  doc?: PipDocument,
): boolean {
  if (!video) return false;
  const currentDoc = doc ?? (typeof document !== 'undefined' ? (document as PipDocument) : undefined);
  return Boolean(currentDoc && currentDoc.pictureInPictureElement === video);
}

/**
 * Alterna o modo Picture-in-Picture para o elemento de vídeo.
 * Retorna true se entrou em PiP, false se saiu ou não suportado.
 */
export async function togglePictureInPicture(
  video: (Element & PipVideoElement) | null | undefined,
  doc?: PipDocument,
): Promise<boolean> {
  const currentDoc = doc ?? (typeof document !== 'undefined' ? (document as PipDocument) : undefined);
  if (!currentDoc || !video) return false;

  try {
    if (currentDoc.pictureInPictureElement) {
      if (typeof currentDoc.exitPictureInPicture === 'function') {
        await currentDoc.exitPictureInPicture();
      }
      return false;
    }

    if (typeof video.requestPictureInPicture === 'function' && !video.disablePictureInPicture) {
      await video.requestPictureInPicture();
      return true;
    }
  } catch (err) {
    console.warn('[KIARA] Falha ao alternar Picture-in-Picture:', err);
  }

  return false;
}
