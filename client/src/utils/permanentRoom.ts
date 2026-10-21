/**
 * permanentRoom.ts
 * Link fixo do KIARA: cada apresentador tem UM código de sala, guardado no localStorage e
 * reutilizado em todas as transmissões. Não há link alternativo/dinâmico.
 *
 * O código é gerado na primeira visita (antes mesmo de transmitir), então o link já pode
 * ser compartilhado com antecedência.
 */

import { generateRoomCode, isValidRoomCode } from './viewerLink';

/** Chave do localStorage para o código da sala fixa */
export const PERMANENT_CODE_KEY = 'kiara:permanentRoomCode';

function readStored(): string | null {
  try {
    const raw = localStorage.getItem(PERMANENT_CODE_KEY)?.toUpperCase().trim();
    return raw && isValidRoomCode(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Salva o código fixo (ignora falhas de armazenamento, p. ex. modo privado) */
export function savePermanentRoomCode(code: string): void {
  try {
    localStorage.setItem(PERMANENT_CODE_KEY, code.toUpperCase().trim());
  } catch {
    // o código vale só para esta sessão
  }
}

/**
 * Devolve o código fixo salvo; se não houver (ou for inválido), gera um novo e o persiste.
 */
export function getOrCreatePermanentRoomCode(): string {
  const stored = readStored();
  if (stored) return stored;
  const code = generateRoomCode();
  savePermanentRoomCode(code);
  return code;
}

/** Link público da sala fixa a partir de uma base (origem) e do código */
export function buildPermanentLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, '')}/view/${code}`;
}
