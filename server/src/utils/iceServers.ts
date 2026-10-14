/**
 * Montagem da lista de servidores ICE entregue aos clientes.
 *
 * - STUN público sempre presente.
 * - TURN opcional, com credenciais efêmeras geradas AQUI (nunca vão no bundle do cliente):
 *     Modo A: coturn com `use-auth-secret` (TURN_URLS + TURN_SECRET), HMAC-SHA1.
 *     Modo B: Cloudflare Realtime TURN (CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN).
 *   O modo A tem precedência quando está completo; senão tenta o B.
 * Segredos e tokens nunca são registrados em log.
 */

import { createHmac } from 'crypto';
import type { IceServerConfig } from '@screen-share/shared';
import { logger } from './logger';

/** TTL das credenciais TURN (6 h) */
export const TURN_TTL_SECONDS = 6 * 60 * 60;
const CLOUDFLARE_TIMEOUT_MS = 5_000;
const CLOUDFLARE_CACHE_MS = 10 * 60 * 1000;
/** Após uma falha, não tenta a Cloudflare de novo por um curto período (evita atrasar cada sala) */
const CLOUDFLARE_FAILURE_BACKOFF_MS = 30_000;

const STUN_SERVERS: IceServerConfig[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** turn:/turns: + host (ou [IPv6]) + porta opcional + ?transport= opcional */
const TURN_URL_PATTERN = /^turns?:(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(:\d{1,5})?(\?transport=(udp|tcp))?$/i;
const ICE_URL_PATTERN = /^(stun|turn|turns):[^\s]+$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Lê TURN_URLS, descartando (com aviso) entradas que não sejam turn:/turns: válidas */
function parseTurnUrls(raw: string | undefined): string[] {
  if (!raw) return [];
  const valid: string[] = [];
  for (const item of raw.split(',')) {
    const url = item.trim();
    if (!url) continue;
    if (TURN_URL_PATTERN.test(url)) valid.push(url);
    else logger.warn('TURN_URLS: entrada ignorada (use turn: ou turns: com host válido).');
  }
  return valid;
}

function readTurnSecret(): string | undefined {
  return process.env.TURN_SECRET?.trim() || undefined;
}

function readCloudflareConfig(): { keyId: string; token: string } | undefined {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (!keyId || !token) return undefined;
  if (!KEY_ID_PATTERN.test(keyId)) {
    logger.warn('CLOUDFLARE_TURN_KEY_ID ignorado: formato inválido.');
    return undefined;
  }
  return { keyId, token };
}

/** true se algum modo de TURN está completo e válido */
export function isTurnConfigured(): boolean {
  if (readTurnSecret() && parseTurnUrls(process.env.TURN_URLS).length > 0) return true;
  return readCloudflareConfig() !== undefined;
}

/** Modo A: credencial efêmera padrão do coturn (username = expiração:roomId; credential = HMAC-SHA1 base64) */
function buildCoturnServer(roomId: string, urls: string[], secret: string): IceServerConfig {
  const expires = Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS;
  const username = `${expires}:${roomId}`;
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { urls, username, credential };
}

// ─── Modo B: Cloudflare ──────────────────────────────────────────────────────

let cloudflareCache: { servers: IceServerConfig[]; expiresAt: number } | null = null;
let cloudflareFailedUntil = 0;

/** Zera os caches (uso em testes) */
export function resetIceServersCache(): void {
  cloudflareCache = null;
  cloudflareFailedUntil = 0;
}

/** Valida/normaliza uma entrada ICE vinda da API; devolve undefined se for inválida */
function sanitizeIceEntry(entry: unknown): IceServerConfig | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const { urls, username, credential } = entry as Record<string, unknown>;
  const list = typeof urls === 'string' ? [urls] : Array.isArray(urls) ? urls : [];
  // A porta 53 é bloqueada por navegadores e só causaria timeout de ICE
  const clean = list.filter(
    (u): u is string => typeof u === 'string' && ICE_URL_PATTERN.test(u) && !/:53(\?|$)/.test(u),
  );
  if (clean.length === 0) return undefined;
  const out: IceServerConfig = { urls: clean };
  const isTurn = clean.some((u) => /^turns?:/i.test(u));
  if (isTurn) {
    if (typeof username !== 'string' || typeof credential !== 'string' || !username || !credential) return undefined;
    out.username = username;
    out.credential = credential;
  }
  return out;
}

async function fetchCloudflareServers(keyId: string, token: string): Promise<IceServerConfig[] | undefined> {
  const now = Date.now();
  if (cloudflareCache && cloudflareCache.expiresAt > now) return cloudflareCache.servers;
  if (cloudflareFailedUntil > now) return undefined;

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
        signal: AbortSignal.timeout(CLOUDFLARE_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      logger.warn(`Cloudflare TURN respondeu HTTP ${res.status}; usando apenas STUN.`);
      cloudflareFailedUntil = Date.now() + CLOUDFLARE_FAILURE_BACKOFF_MS;
      return undefined;
    }
    const body = (await res.json()) as { iceServers?: unknown };
    // A doc oficial retorna um array; aceita também um único objeto por tolerância
    const raw = Array.isArray(body?.iceServers) ? body.iceServers : body?.iceServers ? [body.iceServers] : [];
    const servers = raw.map(sanitizeIceEntry).filter((s): s is IceServerConfig => s !== undefined);
    if (!servers.some((s) => s.username)) {
      logger.warn('Cloudflare TURN devolveu resposta sem servidor TURN utilizável; usando apenas STUN.');
      cloudflareFailedUntil = Date.now() + CLOUDFLARE_FAILURE_BACKOFF_MS;
      return undefined;
    }
    cloudflareCache = { servers, expiresAt: Date.now() + CLOUDFLARE_CACHE_MS };
    return servers;
  } catch (err) {
    const reason = err instanceof Error ? err.name : 'erro';
    logger.warn(`Falha ao obter credenciais da Cloudflare TURN (${reason}); usando apenas STUN.`);
    cloudflareFailedUntil = Date.now() + CLOUDFLARE_FAILURE_BACKOFF_MS;
    return undefined;
  }
}

/**
 * Lista ICE para uma sala: STUN sempre; TURN quando configurado.
 * Nunca lança: em qualquer falha devolve só STUN.
 */
export async function getIceServers(roomId: string): Promise<IceServerConfig[]> {
  const servers: IceServerConfig[] = STUN_SERVERS.map((s) => ({ ...s }));

  const secret = readTurnSecret();
  const turnUrls = parseTurnUrls(process.env.TURN_URLS);
  if (secret && turnUrls.length > 0) {
    servers.push(buildCoturnServer(roomId, turnUrls, secret));
    return servers;
  }

  const cf = readCloudflareConfig();
  if (cf) {
    const extra = await fetchCloudflareServers(cf.keyId, cf.token);
    if (extra) servers.push(...extra.map((s) => ({ ...s })));
  }
  return servers;
}
