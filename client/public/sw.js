/* sw.js — Service worker do KIARA (app shell offline).
 * - Navegação: network-first, com fallback ao index.html em cache.
 * - /assets/* (arquivos com hash): cache-first.
 * - Só atualiza o cache do /index.html com respostas ok, text/html e navegação para / ou /view/*.
 * - Nunca intercepta /socket.io, /download, /health, /metrics, não-GET ou outras origens.
 */

const CACHE_VERSION = 'v3';
const CACHE_NAME = `kiara-shell-${CACHE_VERSION}`;
const SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icon.svg', '/icon-maskable.svg'];
const BYPASS_PREFIXES = ['/socket.io', '/download', '/health', '/metrics'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith('kiara-shell-') && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (BYPASS_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request));
  }
});

async function networkFirstNavigation(request) {
  try {
    const response = await fetch(request);
    if (shouldCacheShell(request, response)) {
      const cache = await caches.open(CACHE_NAME);
      cache.put('/index.html', response.clone());
    }
    return response;
  } catch (err) {
    const cached = (await caches.match('/index.html')) || (await caches.match('/'));
    if (cached) return cached;
    throw err;
  }
}

/** Só o app shell real entra no cache: resposta ok, HTML, navegação para / ou /view/* */
function shouldCacheShell(request, response) {
  if (!response.ok) return false;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return false;
  const { pathname } = new URL(request.url);
  return pathname === '/' || pathname.startsWith('/view/');
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    cache.put(request, response.clone());
  }
  return response;
}
