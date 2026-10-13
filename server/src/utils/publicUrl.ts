/**
 * Utilitários de URL pública e allowlist de origens (CORS).
 * Centraliza a leitura de PUBLIC_URL / CLIENT_ORIGIN para evitar duplicação.
 */

import { logger } from './logger';

const DEFAULT_CLIENT_ORIGIN = 'http://localhost:3000';

/** Remove barras finais de uma URL/origem */
function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

let publicUrlCache: { raw: string | undefined; value: string | undefined } | null = null;

/**
 * Retorna PUBLIC_URL validada (apenas a origem, sem barra final) ou undefined.
 * Aceita https:, ou http: somente para localhost/127.0.0.1. Inválida → ignora e avisa.
 */
export function getPublicUrl(): string | undefined {
  const raw = process.env.PUBLIC_URL?.trim() || undefined;
  if (publicUrlCache && publicUrlCache.raw === raw) return publicUrlCache.value;

  let value: string | undefined;
  if (raw) {
    try {
      const u = new URL(raw);
      const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (u.protocol === 'https:' || (u.protocol === 'http:' && isLocal)) {
        value = stripTrailingSlash(u.origin);
      } else {
        logger.warn('PUBLIC_URL ignorada: use https:// (ou http:// apenas para localhost/127.0.0.1).');
      }
    } catch {
      logger.warn('PUBLIC_URL ignorada: valor não é uma URL válida.');
    }
  }

  publicUrlCache = { raw, value };
  return value;
}

/** Origem do cliente configurada (CLIENT_ORIGIN), sem barra final */
export function getClientOrigin(): string {
  return stripTrailingSlash(process.env.CLIENT_ORIGIN?.trim() || DEFAULT_CLIENT_ORIGIN);
}

/** Base usada nos links de convite: PUBLIC_URL ?? CLIENT_ORIGIN ?? localhost:3000 */
export function getInviteBase(): string {
  return getPublicUrl() ?? getClientOrigin();
}

/** Monta o link de convite para um código de sala (sem barra duplicada) */
export function buildInviteUrl(code: string): string {
  return `${getInviteBase()}/view/${code}`;
}

/** Lista de origens permitidas (CORS / Socket.IO) */
export function getAllowedOrigins(port: number): string[] {
  const origins = [
    getClientOrigin(),
    getPublicUrl(),
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
    'http://localhost:3000', // dev Vite
  ].filter((o): o is string => Boolean(o));
  return Array.from(new Set(origins.map(stripTrailingSlash)));
}

/**
 * Verifica se uma origem é permitida.
 * Sem header Origin (mesma origem / curl) → permitido.
 */
export function isOriginAllowed(origin: string | undefined, port: number): boolean {
  if (!origin) return true;
  return getAllowedOrigins(port).includes(stripTrailingSlash(origin));
}
