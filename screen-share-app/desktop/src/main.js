'use strict';

/**
 * Processo principal do shell Electron do Screen Share.
 *
 * Responsabilidades:
 *  - Abrir a janela com segurança estrita (contextIsolation, sandbox, sem Node no renderer).
 *  - Carregar o addon nativo (captura de áudio POR APLICATIVO) no processo principal.
 *  - Expor IPC validado (audio:*, capture:*) consumido pelo preload.js.
 *  - Resolver getDisplayMedia() com a fonte escolhida em `capture:select`, sempre SEM áudio
 *    (o áudio vem do módulo nativo).
 *
 * Modos de execução:
 *  - DEV  (ELECTRON_START_URL definido): carrega a URL do Vite (apenas localhost/127.0.0.1).
 *  - PROD (sem ELECTRON_START_URL): serve ../client/dist pelo protocolo customizado `app://app/`.
 *
 * ATENÇÃO (CORS em produção): no modo PROD a origem do renderer é `app://app`. O servidor de
 * sinalização (server/, variável CLIENT_ORIGIN) precisa permitir essa origem no CORS/Socket.IO,
 * senão a conexão será bloqueada. Alternativa: usar o modo dev (origem http://localhost:3000).
 *
 * Transporte de áudio: os chunks são enviados com webContents.send('audio:chunk', ...).
 * O Float32Array é clonado via structured clone. Escolhido em vez de MessageChannelMain por
 * simplicidade: ~100 chunks/s de ~8 KB (48 kHz estéreo float32) é um volume baixo; se o
 * overhead se mostrar relevante, migrar para MessageChannelMain (porta transferida ao
 * preload) é uma mudança localizada neste arquivo e no preload.
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  protocol,
  net,
  desktopCapturer,
  systemPreferences,
} = require('electron');

// ─── Constantes ──────────────────────────────────────────────────────────────

const APP_SCHEME = 'app';
const APP_HOST = 'app';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const CLIENT_DIST = path.resolve(__dirname, '..', '..', 'client', 'dist');
const NATIVE_PATH = path.resolve(
  __dirname, '..', '..', 'native', 'build', 'Release', 'screen_capture.node'
);

const NATIVE_MISSING_MSG = 'Módulo nativo não compilado. Rode npm run build:native';
const MAX_PIDS = 16;
const MAX_ID_LENGTH = 256;
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// CSP aplicada às respostas do protocolo app:// (modo produção).
// connect-src amplo porque a URL do servidor de sinalização é configurável.
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob: mediastream:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
  '.wasm': 'application/wasm',
};

// O esquema precisa ser registrado ANTES do evento `ready`.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ─── Modo (dev/prod) ─────────────────────────────────────────────────────────

/**
 * Valida ELECTRON_START_URL: somente http(s) em localhost/127.0.0.1/[::1].
 * @returns {{ url: string|null, origin: string|null, error: string|null }}
 */
function resolveDevUrl() {
  const raw = process.env.ELECTRON_START_URL;
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

const dev = resolveDevUrl();
const IS_DEV = Boolean(process.env.ELECTRON_START_URL);
/** Origem confiável do renderer (única permitida p/ navegação, IPC e permissões). */
const TRUSTED_ORIGIN = IS_DEV ? dev.origin : APP_ORIGIN;

/** Normaliza protocolo+host (URL.origin retorna "null" para esquemas não-especiais). */
function originOf(urlString) {
  try {
    const u = new URL(urlString);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

function isTrustedUrl(urlString) {
  return Boolean(TRUSTED_ORIGIN) && originOf(urlString) === TRUSTED_ORIGIN;
}

// ─── Addon nativo ────────────────────────────────────────────────────────────

let native = null;
let nativeLoadError = null;
try {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  native = require(NATIVE_PATH);
} catch (err) {
  nativeLoadError = err;
  console.warn(`[desktop] Addon nativo indisponível (${NATIVE_PATH}): ${err && err.message}`);
}

function requireNative() {
  if (!native) throw new Error(NATIVE_MISSING_MSG);
  return native;
}

// ─── Estado ──────────────────────────────────────────────────────────────────

/** @type {BrowserWindow|null} */
let mainWindow = null;
let audioActive = false;
/** Id escolhido em capture:select (uso único). */
let pendingSourceId = null;

function stopAudio() {
  if (!audioActive) return;
  audioActive = false;
  try {
    if (native) native.stopAudioCapture();
  } catch (err) {
    console.warn('[desktop] Falha ao parar captura de áudio:', err && err.message);
  }
}

// ─── Validação ───────────────────────────────────────────────────────────────

/** Confirma que a chamada IPC vem do frame principal da janela principal, na origem confiável. */
function assertTrustedSender(event) {
  const win = mainWindow;
  const frame = event.senderFrame;
  if (
    !win || win.isDestroyed() ||
    event.sender !== win.webContents ||
    !frame || frame !== win.webContents.mainFrame ||
    !isTrustedUrl(frame.url)
  ) {
    throw new Error('Remetente IPC não autorizado.');
  }
}

function validatePids(pids) {
  if (!Array.isArray(pids) || pids.length < 1 || pids.length > MAX_PIDS) {
    throw new Error(`Lista de PIDs inválida (1 a ${MAX_PIDS} itens).`);
  }
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid < 1 || pid > 4294967295) {
      throw new Error('PID inválido.');
    }
  }
  return pids.slice();
}

function validateSourceId(id) {
  if (typeof id !== 'string' || id.length < 1 || id.length > MAX_ID_LENGTH || !/^[\w:.\-]+$/.test(id)) {
    throw new Error('ID de fonte inválido.');
  }
  return id;
}

/**
 * Envolve o handler IPC: valida remetente e devolve {ok,data}|{ok:false,error}.
 * O preload desembrulha e lança Error com a mensagem legível (evita o prefixo
 * "Error invoking remote method ..." do Electron).
 */
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assertTrustedSender(event);
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: (err && err.message) || 'Erro desconhecido.' };
    }
  });
}

// ─── macOS: permissão de gravação de tela ────────────────────────────────────

const SCREEN_DENIED_MSG =
  'Permissão de gravação de tela negada. Libere o app em Ajustes do Sistema > ' +
  'Privacidade e Segurança > Gravação de Tela e reinicie o aplicativo.';

function assertScreenAccess() {
  if (process.platform !== 'darwin') return;
  const status = systemPreferences.getMediaAccessStatus('screen');
  if (status === 'denied' || status === 'restricted') {
    throw new Error(SCREEN_DENIED_MSG);
  }
}

// ─── IPC ─────────────────────────────────────────────────────────────────────

function registerIpc() {
  handle('audio:list', () => requireNative().listAudioSources());

  handle('audio:start', (pids) => {
    const n = requireNative();
    const valid = validatePids(pids);
    const target = mainWindow && mainWindow.webContents;
    if (!target) throw new Error('Janela principal indisponível.');

    // Início repetido: reinicia a captura em vez de falhar com "já em andamento".
    stopAudio();

    n.startAudioCapture({ pids: valid }, (chunk) => {
      if (!audioActive || target.isDestroyed()) return;
      target.send('audio:chunk', {
        pid: chunk.pid,
        pcm: chunk.pcm,
        frames: chunk.frames,
        sampleRate: chunk.sampleRate,
        channels: chunk.channels,
      });
    });
    audioActive = true;
  });

  handle('audio:stop', () => {
    stopAudio();
  });

  handle('capture:list', async () => {
    assertScreenAccess();
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
    });
    return sources.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnailDataUrl: s.thumbnail.isEmpty() ? '' : s.thumbnail.toDataURL(),
    }));
  });

  handle('capture:select', (id) => {
    pendingSourceId = validateSourceId(id);
  });
}

// ─── getDisplayMedia ─────────────────────────────────────────────────────────

function registerDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      // Consome a seleção (uso único), qualquer que seja o resultado.
      const wantedId = pendingSourceId;
      pendingSourceId = null;

      try {
        if (!isTrustedUrl(request.securityOrigin)) {
          console.warn('[desktop] getDisplayMedia negado: origem não confiável', request.securityOrigin);
          callback({});
          return;
        }
        assertScreenAccess();

        const sources = await desktopCapturer.getSources({
          types: ['screen', 'window'],
          thumbnailSize: { width: 0, height: 0 },
        });

        let chosen;
        if (wantedId) {
          chosen = sources.find((s) => s.id === wantedId);
          if (!chosen) {
            console.warn('[desktop] Fonte selecionada não existe mais:', wantedId);
            callback({});
            return;
          }
        } else {
          chosen = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
        }
        if (!chosen) {
          callback({});
          return;
        }
        // Sem `audio`: o áudio é capturado pelo módulo nativo, por aplicativo.
        callback({ video: chosen });
      } catch (err) {
        console.warn('[desktop] Falha em getDisplayMedia:', err && err.message);
        callback({});
      }
    },
    { useSystemPicker: false }
  );
}

// ─── Permissões e CSP ────────────────────────────────────────────────────────

function registerPermissions() {
  const ses = session.defaultSession;
  // Somente captura de mídia, e apenas para a origem confiável.
  const allowed = new Set(['display-capture', 'media']);

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (webContents && webContents.getURL()) || '';
    callback(allowed.has(permission) && isTrustedUrl(url));
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return allowed.has(permission) && isTrustedUrl(requestingOrigin);
  });
}

// ─── Protocolo app:// (produção) ─────────────────────────────────────────────

function textResponse(status, body) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': PROD_CSP },
  });
}

async function serveApp(request) {
  const url = new URL(request.url);
  if (url.host !== APP_HOST) return textResponse(404, 'Não encontrado');

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return textResponse(400, 'Requisição inválida');
  }
  if (pathname.includes('\0')) return textResponse(400, 'Requisição inválida');

  // Proteção contra path traversal: resolve e exige que o alvo fique dentro de CLIENT_DIST.
  const rel = pathname.replace(/^\/+/, '');
  let filePath = path.resolve(CLIENT_DIST, rel);
  const insideRoot = (p) => p === CLIENT_DIST || p.startsWith(CLIENT_DIST + path.sep);
  if (!insideRoot(filePath)) return textResponse(403, 'Acesso negado');

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch { /* inexistente */ }

  if (stat && stat.isDirectory()) {
    filePath = path.join(filePath, 'index.html');
    try { stat = fs.statSync(filePath); } catch { stat = null; }
  }

  if (!stat || !stat.isFile()) {
    // Fallback SPA apenas para rotas (sem extensão); assets ausentes devolvem 404.
    if (path.extname(rel) !== '') return textResponse(404, 'Não encontrado');
    filePath = path.join(CLIENT_DIST, 'index.html');
  }

  try {
    const res = await net.fetch(pathToFileURL(filePath).toString());
    const headers = new Headers(res.headers);
    headers.set('content-type', MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
    headers.set('content-security-policy', PROD_CSP);
    headers.set('x-content-type-options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return textResponse(500, 'Erro ao ler arquivo');
  }
}

// ─── Janela ──────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function loadErrorPage(win, title, detail) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Screen Share</title>
<style>body{font-family:system-ui,sans-serif;background:#111827;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{max-width:560px;padding:24px}h1{font-size:20px;margin:0 0 12px}p{line-height:1.5;color:#9ca3af}code{color:#e5e7eb}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${detail}</p></main></body></html>`;
  return win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function openExternalSafe(urlString) {
  try {
    const u = new URL(urlString);
    if (u.protocol === 'https:') shell.openExternal(u.href);
  } catch { /* URL inválida: ignora */ }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    title: 'Screen Share',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  });
  mainWindow = win;
  const wc = win.webContents;

  win.once('ready-to-show', () => win.show());

  // window.open / target=_blank: nunca cria janela; só https externo abre no navegador.
  wc.setWindowOpenHandler(({ url }) => {
    openExternalSafe(url);
    return { action: 'deny' };
  });

  const guardNavigation = (event, url) => {
    if (isTrustedUrl(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  };
  wc.on('will-navigate', guardNavigation);
  wc.on('will-frame-navigate', guardNavigation);
  wc.on('will-attach-webview', (event) => event.preventDefault());

  // Recarga/navegação do frame principal ou crash do renderer: encerra a captura nativa.
  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      stopAudio();
      pendingSourceId = null;
    }
  });
  wc.on('render-process-gone', () => {
    stopAudio();
    pendingSourceId = null;
  });

  win.on('closed', () => {
    stopAudio();
    pendingSourceId = null;
    if (mainWindow === win) mainWindow = null;
  });

  if (IS_DEV) {
    if (dev.error) {
      loadErrorPage(win, 'Configuração inválida', escapeHtml(dev.error));
    } else {
      win.loadURL(dev.url).catch((err) => {
        loadErrorPage(
          win,
          'Não foi possível conectar ao servidor de desenvolvimento',
          `Verifique se o Vite está rodando em <code>${escapeHtml(dev.url)}</code> ` +
          `(<code>cd client &amp;&amp; npm run dev</code>).<br>${escapeHtml(err && err.message)}`
        );
      });
    }
  } else if (!fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
    loadErrorPage(
      win,
      'Client não compilado',
      'Não foi encontrado <code>client/dist/index.html</code>. ' +
      'Rode <code>cd client &amp;&amp; npm run build</code> ou use <code>npm run dev</code> ' +
      'com o servidor Vite ativo.'
    );
  } else {
    win.loadURL(`${APP_ORIGIN}/`).catch((err) => {
      loadErrorPage(win, 'Falha ao carregar o aplicativo', escapeHtml(err && err.message));
    });
  }

  return win;
}

// ─── Ciclo de vida ───────────────────────────────────────────────────────────

app.whenReady().then(() => {
  if (!native) {
    console.warn(`[desktop] ${NATIVE_MISSING_MSG}${nativeLoadError ? ` (${nativeLoadError.message})` : ''}`);
  }

  protocol.handle(APP_SCHEME, serveApp);
  registerPermissions();
  registerDisplayMediaHandler();
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopAudio();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopAudio();
});
