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

/** Escolhe o instalador .exe (ignora .blockmap) e valida que o link é do repositório esperado */
function pickInstallerUrl(assets: unknown, repo: string): string | undefined {
  if (!Array.isArray(assets)) return undefined;
  const prefix = `https://github.com/${repo}/releases/download/`;
  for (const asset of assets as GithubAsset[]) {
    const { name, browser_download_url: url } = asset;
    if (
      typeof name === 'string' &&
      typeof url === 'string' &&
      /^KIARA-Setup-.+\.exe$/.test(name) &&
      url.startsWith(prefix)
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
    const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'kiara-server' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
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
    logger.warn('Falha ao consultar a última release no GitHub.', { error: String(err) });
    return cache?.url;
  }
}
