/**
 * viewerLink.ts
 * Interpretação segura do que o usuário digita/cola para assistir uma transmissão:
 *  - o CÓDIGO de 6 caracteres; ou
 *  - o LINK completo (https://.../view/CÓDIGO).
 *
 * Função pura, sem dependência de DOM/React.
 */

/** Mesmo alfabeto do servidor: sem 0, O, 1, I */
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
const VIEW_PATH_RE = /^\/view\/([A-HJ-NP-Z2-9]{6})\/?$/i;

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
  const compact = text.replace(/[\s-]/g, '').toUpperCase();
  if (CODE_RE.test(compact)) return { kind: 'code', code: compact };

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
