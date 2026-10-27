/**
 * dataSaver.ts
 * Modo "Economia de dados" do espectador: decide o padrão a partir da Network Information API
 * (quando existe) e persiste a escolha do usuário em localStorage.
 */

import type { ViewerQualityPreference } from '@shared/index';

export const DATA_SAVER_STORAGE_KEY = 'kiara:dataSaver';

/** Qualidade aplicada enquanto a economia de dados está ligada */
export const DATA_SAVER_QUALITY: ViewerQualityPreference = '480p';

/** Qualidade restaurada ao desligar a economia (mesmo padrão do useViewer) */
export const DEFAULT_QUALITY: ViewerQualityPreference = '1080p';

/** Recorte de `navigator.connection` usado aqui (a API não existe em todo navegador) */
export interface NetworkInformationLike {
  saveData?: boolean;
  effectiveType?: string;
  addEventListener?: (type: 'change', listener: () => void) => void;
  removeEventListener?: (type: 'change', listener: () => void) => void;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const SLOW_CONNECTION_TYPES = new Set(['slow-2g', '2g', '3g']);

/** Devolve `navigator.connection` ou null quando o navegador não oferece a API */
export function getNetworkConnection(
  nav: { connection?: NetworkInformationLike } | undefined = typeof navigator === 'undefined'
    ? undefined
    : (navigator as { connection?: NetworkInformationLike }),
): NetworkInformationLike | null {
  return nav?.connection ?? null;
}

/** true se o navegador pede economia de dados ou a rede efetiva é lenta (slow-2g, 2g, 3g) */
export function isConstrainedConnection(conn: NetworkInformationLike | null | undefined): boolean {
  if (!conn) return false;
  if (conn.saveData === true) return true;
  return typeof conn.effectiveType === 'string' && SLOW_CONNECTION_TYPES.has(conn.effectiveType);
}

/** Interpreta o valor salvo: '1' ligado, '0' desligado, qualquer outra coisa = sem escolha */
export function parseStoredDataSaver(raw: string | null | undefined): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/** Lê a escolha salva do usuário (null = nunca escolheu ou armazenamento indisponível) */
export function readStoredDataSaver(storage?: StorageLike): boolean | null {
  try {
    return parseStoredDataSaver((storage ?? localStorage).getItem(DATA_SAVER_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Salva a escolha do usuário; falha em silêncio se o armazenamento estiver indisponível */
export function storeDataSaver(value: boolean, storage?: StorageLike): void {
  try {
    (storage ?? localStorage).setItem(DATA_SAVER_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // armazenamento indisponível: a escolha vale só para esta sessão
  }
}

/** A escolha salva vence; sem ela, o padrão vem da conexão */
export function resolveDataSaver(
  stored: boolean | null,
  conn: NetworkInformationLike | null | undefined,
): boolean {
  return stored ?? isConstrainedConnection(conn);
}

/** Observa o evento `change` da conexão. Devolve a função de cancelamento (no-op sem a API). */
export function subscribeConnectionChange(
  conn: NetworkInformationLike | null | undefined,
  listener: () => void,
): () => void {
  if (!conn || typeof conn.addEventListener !== 'function') return () => {};
  conn.addEventListener('change', listener);
  return () => conn.removeEventListener?.('change', listener);
}
