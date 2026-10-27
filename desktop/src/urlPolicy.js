'use strict';

/**
 * Política de URLs do shell desktop (módulo PURO, sem Electron): validação do link de
 * visualização `/view/XXXXXX`, origem confiável, navegação/redirect e CSP de produção.
 * Testado em urlPolicy.test.ts.
 */

const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Código da sala: 6 caracteres, sem 0/O/1/I (ver gerador de códigos do servidor).
const VIEW_CODE_RE = /^\/view\/[A-HJ-NP-Z2-9]{6}\/?$/i;

// Páginas internas (erro/splash/devtools) que nunca disparam o retorno à tela inicial.
const INTERNAL_URL_RE = /^(data|about|chrome-error|devtools):/i;

/**
 * Interpreta ELECTRON_START_URL (modo dev). Só aceita http(s) em localhost/127.0.0.1/[::1].
 * @param {string|undefined} raw
 * @returns {{ url: string|null, origin: string|null, error: string|null }}
 */
function resolveDevUrl(raw) {
  if (!raw) return { url: null, origin: null, error: null };
  try {
    const u = new URL(raw);
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || !DEV_HOSTS.has(u.hostname)) {
      return {
        url: null,
        origin: null,
        error: `ELECTRON_START_URL inválida: apenas localhost/127.0.0.1 são aceitos (recebido: ${u.origin}).`,
      };
    }
    return { url: u.href, origin: u.origin, error: null };
  } catch {
    return { url: null, origin: null, error: 'ELECTRON_START_URL não é uma URL válida.' };
  }
}

/** @returns {string|null} `protocolo//host:porta` ou null se a URL for inválida. */
function originOf(urlString) {
  try {
    const u = new URL(urlString);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** true se a URL pertence à origem confiável (null = ainda desconhecida => nada é confiável). */
function isTrustedUrl(trustedOrigin, urlString) {
  return Boolean(trustedOrigin) && originOf(urlString) === trustedOrigin;
}

/**
 * Valida o link de visualização aberto pelo app (HTTPS, ou http em localhost; sem credenciais;
 * caminho /view/XXXXXX). Lança Error em pt-BR; devolve a URL normalizada.
 */
function validateViewerUrl(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    throw new Error('O link fornecido não é uma URL válida.');
  }
  const isDevHost = DEV_HOSTS.has(u.hostname);
  if (u.protocol !== 'https:' && !(isDevHost && u.protocol === 'http:')) {
    throw new Error('O link deve usar HTTPS.');
  }
  if (u.username || u.password) {
    throw new Error('O link não deve conter credenciais.');
  }
  if (!VIEW_CODE_RE.test(u.pathname)) {
    throw new Error(
      'O caminho do link é inválido. Esperado: /view/XXXXXX (6 caracteres).'
    );
  }
  return u.href;
}

function isViewerUrl(urlString) {
  try {
    validateViewerUrl(urlString);
    return true;
  } catch {
    return false;
  }
}

/** URL interna (data:, about:, chrome-error:, devtools:) ou vazia. */
function isInternalUrl(url) {
  return !url || INTERNAL_URL_RE.test(url);
}

/** href normalizado se a URL pode ser aberta no navegador do sistema (somente https); senão null. */
function safeExternalHref(urlString) {
  try {
    const u = new URL(urlString);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * A janela deve voltar sozinha ao servidor local? (saiu da origem confiável e da página
 * de espectador /view/CÓDIGO.)
 */
function shouldLeaveForeignPage(trustedOrigin, url) {
  if (isInternalUrl(url)) return false;
  return !(isTrustedUrl(trustedOrigin, url) || isViewerUrl(url));
}

/** Endereço do app local (Vite em dev, servidor embutido em produção); null se ainda não está pronto. */
function localHomeUrl({ isDev, devUrl, embeddedPort }) {
  if (isDev) return devUrl;
  return embeddedPort ? `http://127.0.0.1:${embeddedPort}` : null;
}

/** CSP de produção para a origem do servidor embutido (ex.: http://127.0.0.1:PORT). */
function buildProdCsp(origin) {
  const wsOrigin = origin.replace(/^http/, 'ws');
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob: mediastream:",
    "font-src 'self' data:",
    `connect-src 'self' ${origin} ${wsOrigin} https: wss: ws:`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

module.exports = {
  DEV_HOSTS,
  resolveDevUrl,
  originOf,
  isTrustedUrl,
  validateViewerUrl,
  isViewerUrl,
  isInternalUrl,
  safeExternalHref,
  shouldLeaveForeignPage,
  localHomeUrl,
  buildProdCsp,
};
