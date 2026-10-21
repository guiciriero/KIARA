/**
 * miniPlayer.ts
 * Tamanho do miniplayer do Host (retorno da própria transmissão quando há co-apresentador).
 * Funções puras para testar sem DOM.
 */

export const MINI_MIN_WIDTH = 160;
export const MINI_MAX_WIDTH = 480;
export const MINI_DEFAULT_WIDTH = 240;
export const MINI_STEP = 10;

/** Mantém a largura dentro dos limites; valor inválido volta ao padrão */
export function clampMiniWidth(value: number): number {
  if (!Number.isFinite(value)) return MINI_DEFAULT_WIDTH;
  return Math.min(MINI_MAX_WIDTH, Math.max(MINI_MIN_WIDTH, Math.round(value)));
}

/** Lê a largura salva (localStorage); ausente, vazia ou corrompida vira o padrão */
export function parseStoredMiniWidth(raw: string | null): number {
  if (raw === null || raw.trim() === '') return MINI_DEFAULT_WIDTH;
  return clampMiniWidth(Number(raw));
}
