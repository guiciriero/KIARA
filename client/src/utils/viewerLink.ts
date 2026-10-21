/**
 * viewerLink.ts
 * Interpretação segura do que o usuário digita/cola para assistir uma transmissão:
 *  - o CÓDIGO de 6 caracteres; ou
 *  - o LINK completo (https://.../view/CÓDIGO).
 *
 * Função pura, sem dependência de DOM/React.
 */

/** Mesmo alfabeto do servidor: sem 0, O, 1, I */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 6;
const CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);
const VIEW_PATH_RE = /^\/view\/([A-HJ-NP-Z2-9]{6})\/?$/i;

/** true somente para 6 caracteres do alfabeto, já em maiúsculas (sem normalizar) */
export function isValidRoomCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code);
}

/** Gera um código de sala aleatório de 6 caracteres do alfabeto válido */
export function generateRoomCode(): string {
  const chars = ROOM_CODE_ALPHABET;
  let code = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(ROOM_CODE_LENGTH);
    crypto.getRandomValues(array);
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += chars[array[i] % chars.length];
    }
  } else {
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return code;
}

/**
 * Normaliza um código digitado: remove espaços/hífens e põe em maiúsculas.
 * Devolve `null` se o resultado não for um código válido.
 */
export function normalizeRoomCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.replace(/[\s-]/g, '').toUpperCase();
  return isValidRoomCode(compact) ? compact : null;
}

/** Limite razoável para o texto colado */
export const MAX_INPUT_LENGTH = 300;

export type ParsedViewerInput =
  | { kind: 'code'; code: string }
  /** `url` é a URL canônica reconstruída (origem + /view/CÓDIGO), sem query/hash. */
  | { kind: 'link'; code: string; url: string; origin: string }
  | { kind: 'invalid' };

export function parseViewerInput(raw: string): ParsedViewerInput {
  if (typeof raw !== 'string') return { kind: 'invalid' };
  const text = raw.trim();
  if (text.length === 0 || text.length > MAX_INPUT_LENGTH) return { kind: 'invalid' };

  // (a) Código: ignora espaços e hífens (ex.: "ab3 x7k", "AB3-X7K")
  const normalized = normalizeRoomCode(text);
  if (normalized) return { kind: 'code', code: normalized };

  // (b) Link
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { kind: 'invalid' };
  }
  if (u.protocol !== 'https:') return { kind: 'invalid' };
  if (u.username !== '' || u.password !== '') return { kind: 'invalid' };
  const m = VIEW_PATH_RE.exec(u.pathname);
  if (!m) return { kind: 'invalid' };

  const code = m[1].toUpperCase();
  return { kind: 'link', code, url: `${u.origin}/view/${code}`, origin: u.origin };
}
