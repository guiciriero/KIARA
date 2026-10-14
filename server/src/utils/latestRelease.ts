/**
 * Resolve o link de download do instalador do Windows na ÚLTIMA release do GitHub.
 * O nome do arquivo muda a cada versão (KIARA-Setup-x.y.z.exe), então consultamos a API
 * e guardamos o resultado em cache para não estourar o limite da API pública.
 */

import { logger } from './logger';

const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DEFAULT_REPO = 'guiciriero/KIARA';
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8_000;

/** Repositório das releases (GITHUB_REPO=dono/repo); valor inválido volta ao padrão */
export function getReleaseRepo(): string {
  const raw = process.env.GITHUB_REPO?.trim();
  if (raw && REPO_PATTERN.test(raw)) return raw;
  if (raw) logger.warn('GITHUB_REPO ignorado: use o formato dono/repositorio.');
  return DEFAULT_REPO;
}

/** Página da última release (destino de fallback quando a API falha) */
export function getReleasesPageUrl(): string {
  return `https://github.com/${getReleaseRepo()}/releases/latest`;
}

interface GithubAsset {
  name?: unknown;
  browser_download_url?: unknown;
}

let cache: { url: string; expiresAt: number } | null = null;

/** Zera o cache (uso em testes) */
export function resetLatestReleaseCache(): void {
  cache = null;
}

/** Hosts permitidos: API consultada e destino final do download */
const API_HOST = 'api.github.com';
const DOWNLOAD_HOST = 'github.com';

/** true se a URL é https, sem credenciais, no host exato esperado */
function isUrlOnHost(value: string, host: string, pathPrefix?: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.hostname !== host || u.username || u.password) return false;
    if (u.port && u.port !== '443') return false;
    return pathPrefix === undefined || u.pathname.startsWith(pathPrefix);
  } catch {
    return false;
  }
}

/** Escolhe o instalador .exe (ignora .blockmap) e valida que o link é do repositório esperado */
function pickInstallerUrl(assets: unknown, repo: string): string | undefined {
  if (!Array.isArray(assets)) return undefined;
  const pathPrefix = `/${repo}/releases/download/`;
  for (const asset of assets as GithubAsset[]) {
    const { name, browser_download_url: url } = asset;
    if (
      typeof name === 'string' &&
      typeof url === 'string' &&
      /^KIARA-Setup-.+\.exe$/.test(name) &&
      isUrlOnHost(url, DOWNLOAD_HOST, pathPrefix)
    ) {
      return url;
    }
  }
  return undefined;
}

/** URL direta do instalador da última release, ou undefined se não for possível obter */
export async function getLatestWindowsInstallerUrl(): Promise<string | undefined> {
  if (cache && cache.expiresAt > Date.now()) return cache.url;

  const repo = getReleaseRepo();
  try {
    const res = await fetch(`https://${API_HOST}/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kiara-server' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // Se houve redirecionamento, a resposta final ainda precisa ser da API do GitHub
    if (res.url && !isUrlOnHost(res.url, API_HOST)) {
      logger.warn('Resposta da consulta de release veio de host inesperado; ignorada.');
      return cache?.url;
    }
    if (!res.ok) {
      logger.warn(`GitHub respondeu ${res.status} ao buscar a última release.`);
      return cache?.url;
    }
    const body = (await res.json()) as { assets?: unknown };
    const url = pickInstallerUrl(body.assets, repo);
    if (!url) {
      logger.warn('Última release sem instalador KIARA-Setup-*.exe.');
      return cache?.url;
    }
    cache = { url, expiresAt: Date.now() + CACHE_TTL_MS };
    return url;
  } catch (err) {
    logger.warn('Falha ao consultar a última release no GitHub.', {
      error: err instanceof Error ? err.name : 'erro',
    });
    return cache?.url;
  }
}
