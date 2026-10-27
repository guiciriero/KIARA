'use strict';

/**
 * Processo principal do shell Electron do Screen Share.
 *
 * Modos de execução:
 *  - DEV  (ELECTRON_START_URL definido): carrega a URL do Vite; sem túnel/servidor embutido.
 *  - PROD (sem ELECTRON_START_URL): sobe túnel Cloudflare + servidor embutido;
 *    janela carrega http://127.0.0.1:PORT (mesma origem do Socket.IO).
 *
 * Instância única: app.requestSingleInstanceLock().
 *
 * Limpeza: antes de sair, para túnel, servidor e captura nativa (sem órfãos).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  protocol,
  net,
  desktopCapturer,
  screen,
  sharedTexture,
  systemPreferences,
  dialog,
  powerSaveBlocker,
  utilityProcess,
} = require('electron');

const { buildCommandLineSwitches } = require('./platformConfig');

// ─── Aceleração por Hardware e Otimizações de Vídeo (KIARA 60/120 FPS / Baixa Latência) ───
// Lista de switches montada em platformConfig.js (testada): inclui flags de PipeWire/Wayland no Linux.
// NÃO usar 'disable-frame-rate-limit' (nem 'disable-gpu-vsync'): saturam GPU/renderer sem ganho.
// Evitar flags experimentais de composição/GPU (RawDraw, DirectCompositionSharedImages,
// *-gpu-memory-buffers): em alguns drivers deixam a janela inteira branca.
for (const [name, value] of buildCommandLineSwitches({ platform: process.platform, env: process.env })) {
  if (value === undefined) app.commandLine.appendSwitch(name);
  else app.commandLine.appendSwitch(name, value);
}

// Eleva a prioridade do processo do KIARA no Windows para garantir fluidez mesmo durante jogos pesados a 100% de CPU/GPU
try {
  if (process.platform === 'win32' && os.constants && os.constants.priority) {
    os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL);
  }
} catch {
  // Ignora se não houver permissão
}

// Bloqueia suspensão de energia durante a transmissão
let powerBlockerId = null;
try {
  powerBlockerId = powerSaveBlocker.start('prevent-app-suspension');
} catch {
  // Ignora se indisponível
}

// ─── Instância única ──────────────────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// ─── Módulos de runtime ───────────────────────────────────────────────────────

const { startTunnel, findCloudflared } = require('./runtime/tunnel');
const { readExpectedCloudflaredSha } = require('./runtime/integrity');
const { findFreePort, startServer, resolveClientDist } = require('./runtime/server');
const { createUpdater } = require('./updater');
const { createNativeCapture } = require('./nativeCapture');
const { SPLASH_HTML } = require('./splashPage');

// ─── Constantes ──────────────────────────────────────────────────────────────

const APP_SCHEME = 'app';
const APP_HOST = 'app';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

// Caminho do addon nativo — empacotado vs dev.
const NATIVE_PATH = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'screen_capture.node')
  : path.resolve(__dirname, '..', '..', 'native', 'build', 'Release', 'screen_capture.node');

const NATIVE_MISSING_MSG = 'Módulo nativo não compilado. Rode npm run build:native';

// Lógica pura (testada): política de URLs/CSP e validação de argumentos do IPC.
const {
  resolveDevUrl,
  originOf,
  isTrustedUrl: isTrustedUrlFor,
  validateViewerUrl,
  isViewerUrl,
  safeExternalHref,
  shouldLeaveForeignPage,
  isInternalUrl,
  localHomeUrl: localHomeUrlFor,
  buildProdCsp,
} = require('./urlPolicy');
const { validatePids, validateSourceId } = require('./ipcValidation');

// O esquema app:// ainda precisa ser registrado antes do ready (mesmo que em PROD
// não seja mais usado para servir o client, mantemos para compatibilidade futura
// e para que o renderer de dev funcione sem erros de "esquema desconhecido").
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

const dev = resolveDevUrl(process.env.ELECTRON_START_URL);
const IS_DEV = Boolean(process.env.ELECTRON_START_URL);

/**
 * Origem confiável do renderer.
 * Em DEV: origem do Vite (ex.: http://localhost:3000).
 * Em PROD: http://127.0.0.1:PORT (definida em setTrustedOrigin após a porta ser conhecida).
 */
let TRUSTED_ORIGIN = IS_DEV ? dev.origin : null; // null até a porta ser descoberta

function setTrustedOrigin(origin) {
  TRUSTED_ORIGIN = origin;
}

function isTrustedUrl(urlString) {
  return isTrustedUrlFor(TRUSTED_ORIGIN, urlString);
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
let appUpdater = null;
let audioActive = false;
let pendingSourceId = null;

// Estado do runtime embutido
let tunnelStop = null;    // () => void
let serverStop = null;    // () => void
let publicUrl = null;     // string | null — URL https do túnel
let embeddedPort = null;  // number — porta do servidor embutido

function stopAudio() {
  if (!audioActive) return;
  audioActive = false;
  try {
    if (native) native.stopAudioCapture();
  } catch (err) {
    console.warn('[desktop] Falha ao parar captura de áudio:', err && err.message);
  }
}

// Captura nativa de vídeo (DXGI zero-copy). Só Windows; o renderer cai no getDisplayMedia se indisponível.
const nativeCapture = createNativeCapture({
  getNative: () => native,
  screen,
  sharedTexture,
  desktopCapturer,
  getTarget: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null),
  platform: process.platform,
});

function stopRuntime() {
  try { if (tunnelStop) tunnelStop(); } catch { /* ok */ }
  try { if (serverStop) serverStop(); } catch { /* ok */ }
  tunnelStop = null;
  serverStop = null;
}

// ─── Validação ───────────────────────────────────────────────────────────────

/**
 * Valida o remetente do IPC. Com `allowViewer`, também aceita a página de espectador
 * (/view/CODE) carregada na janela principal — necessária para o co-apresentador
 * capturar tela/áudio enquanto assiste a transmissão de outra pessoa.
 */
function assertTrustedSender(event, allowViewer = false) {
  const win = mainWindow;
  const frame = event.senderFrame;
  if (
    !win || win.isDestroyed() ||
    event.sender !== win.webContents ||
    !frame || frame !== win.webContents.mainFrame ||
    !(isTrustedUrl(frame.url) || (allowViewer && isViewerUrl(frame.url)))
  ) {
    throw new Error('Remetente IPC não autorizado.');
  }
}

/**
 * Origem (sem caminho) aceita para captura de tela: o renderer local ou a página de
 * espectador atualmente aberta na janela principal.
 */
function isCaptureOrigin(origin) {
  if (isTrustedUrl(origin)) return true;
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const current = mainWindow.webContents.getURL();
  return isViewerUrl(current) && originOf(origin) === originOf(current);
}

function handle(channel, fn, { allowViewer = false } = {}) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assertTrustedSender(event, allowViewer);
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

// (validateViewerUrl / isViewerUrl vêm de urlPolicy.js)

// ─── IPC ─────────────────────────────────────────────────────────────────────

function registerIpc() {
  // Os canais de captura também aceitam a página de espectador (co-apresentador).
  const VIEWER_OK = { allowViewer: true };

  // Linux não tem captura de áudio por aplicativo (stub): lista vazia, sem erro; o cliente
  // então usa o áudio do sistema via getDisplayMedia.
  handle('audio:list', () => {
    if (process.platform === 'linux') return native ? native.listAudioSources() : [];
    return requireNative().listAudioSources();
  }, VIEWER_OK);

  handle('audio:start', (pids) => {
    const n = requireNative();
    const valid = validatePids(pids);
    const target = mainWindow && mainWindow.webContents;
    if (!target) throw new Error('Janela principal indisponível.');
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
  }, VIEWER_OK);

  handle('audio:stop', () => { stopAudio(); }, VIEWER_OK);

  handle('native-capture:available', () => nativeCapture.isAvailable(), VIEWER_OK);
  handle('native-capture:start', async (opts) => {
    assertScreenAccess();
    return nativeCapture.start(opts);
  }, VIEWER_OK);
  handle('native-capture:stop', () => { nativeCapture.stop(); }, VIEWER_OK);

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
  }, VIEWER_OK);

  handle('capture:select', (id) => {
    pendingSourceId = validateSourceId(id);
  }, VIEWER_OK);

  // ── IPC novos ────────────────────────────────────────────────────────────
  handle('app:get-public-url', () => publicUrl);

  handle('app:open-viewer-link', async (urlString) => {
    const href = validateViewerUrl(urlString);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(href);
    } else {
      await shell.openExternal(href);
    }
  });

  // ── Atualização do app ───────────────────────────────────────────────────
  appUpdater = createUpdater({
    app,
    isDev: IS_DEV,
    onState: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:state', state);
    },
    // Mesma limpeza do encerramento normal: sem túnel/servidor/áudio órfãos ao instalar.
    beforeInstall: () => { stopAudio(); nativeCapture.stop(); stopRuntime(); },
  });
  handle('updater:get-state', () => appUpdater.getState());
  handle('updater:check', () => appUpdater.check());
  handle('updater:download', () => appUpdater.download());
  handle('updater:install', () => appUpdater.install());
  // Procura (e baixa) a atualização sozinho periodicamente enquanto o app estiver aberto.
  appUpdater.startAutoCheck();
}

// ─── getDisplayMedia ─────────────────────────────────────────────────────────

function registerDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      const wantedId = pendingSourceId;
      pendingSourceId = null;
      try {
        if (!isCaptureOrigin(request.securityOrigin)) {
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
          if (!chosen) { callback({}); return; }
        } else {
          chosen = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
        }
        if (!chosen) { callback({}); return; }
        callback({ video: chosen });
      } catch (err) {
        console.warn('[desktop] Falha em getDisplayMedia:', err && err.message);
        callback({});
      }
    },
    { useSystemPicker: false }
  );
}

// ─── Permissões ───────────────────────────────────────────────────────────────

function registerPermissions() {
  const ses = session.defaultSession;
  const allowed = new Set(['display-capture', 'media', 'fullscreen']);
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = (details && details.requestingUrl) || (webContents && webContents.getURL()) || '';
    callback(allowed.has(permission) && (isTrustedUrl(url) || isViewerUrl(url)));
  });
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return allowed.has(permission) && (isTrustedUrl(requestingOrigin) || isViewerUrl(requestingOrigin));
  });
}

// ─── CSP via onHeadersReceived (produção) ────────────────────────────────────

/**
 * Injeta a CSP nas respostas HTTP da origem confiável (http://127.0.0.1:PORT).
 * Equivale ao que antes era feito nos cabeçalhos das respostas do protocolo app://.
 */
function registerCspHeaders(trustedOrigin) {
  const csp = buildProdCsp(trustedOrigin);
  session.defaultSession.webRequest.onHeadersReceived({ urls: [`${trustedOrigin}/*`] }, (details, callback) => {
    const headers = Object.assign({}, details.responseHeaders);
    headers['content-security-policy'] = [csp];
    headers['x-content-type-options'] = ['nosniff'];
    callback({ responseHeaders: headers });
  });
}

// ─── Janela de espera ─────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function loadErrorPage(win, title, detail) {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>KIARA</title>
<style>body{font-family:system-ui,sans-serif;background:#08090d;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
main{max-width:560px;padding:24px}h1{font-size:20px;margin:0 0 12px;color:#f43f5e}p{line-height:1.5;color:#94a3b8}code{color:#e5e7eb}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><p>${detail}</p></main></body></html>`;
  return win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function loadSplashPage(win) {
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`);
}

function updateSplashStatus(win, text) {
  if (!win || win.isDestroyed()) return;
  const safeText = JSON.stringify(text);
  win.webContents
    .executeJavaScript(`(() => { const el = document.getElementById('splash-status'); if (el) el.textContent = ${safeText}; })()`)
    .catch(() => {});
}

function openExternalSafe(urlString) {
  const href = safeExternalHref(urlString);
  if (href) shell.openExternal(href);
}

// ─── Protocolo app:// (mantido para dev e compatibilidade) ───────────────────
// Em PROD o renderer não carrega app://, mas o handler ainda precisa estar registrado.
// Serve também como fallback caso alguém navegue para app:// por engano.

function textResponse(status, body) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

// ─── Janela principal ─────────────────────────────────────────────────────────

/** Endereço do app local (Vite em dev, servidor embutido em produção); null se ainda não está pronto. */
function localHomeUrl() {
  return localHomeUrlFor({ isDev: IS_DEV, devUrl: dev.url, embeddedPort });
}

function goHome(wc) {
  const home = localHomeUrl();
  if (!home || wc.isDestroyed()) return;
  wc.loadURL(home).catch((err) => {
    console.warn('[desktop] Falha ao voltar para a tela inicial:', err && err.message);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#000000',
    title: 'KIARA',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  win.removeMenu();
  const wc = win.webContents;

  win.once('ready-to-show', () => win.show());

  wc.setWindowOpenHandler(({ url }) => {
    // Document Picture-in-Picture abre uma janela about:blank a partir da página confiável:
    // permitida só nesse caso, sempre no topo e sem menu. Qualquer outra URL vai ao navegador.
    const opener = wc.getURL();
    if (url === 'about:blank' && (isTrustedUrl(opener) || isViewerUrl(opener))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { alwaysOnTop: true, autoHideMenuBar: true, backgroundColor: '#000000' },
      };
    }
    openExternalSafe(url);
    return { action: 'deny' };
  });

  const guardNavigation = (event, url) => {
    if (isTrustedUrl(url) || isViewerUrl(url)) return;
    event.preventDefault();
    openExternalSafe(url);
  };
  wc.on('will-navigate', guardNavigation);
  wc.on('will-frame-navigate', guardNavigation);
  wc.on('will-attach-webview', (event) => event.preventDefault());

  wc.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      stopAudio();
      nativeCapture.stop();
      pendingSourceId = null;
    }
  });

  // Ao assistir o link de outra pessoa, a janela passa a carregar o site REMOTO. Se o usuário sai da
  // sala (o React Router só troca a rota para "/") ou a rota deixa de ser /view/CÓDIGO, a janela ficaria
  // numa origem não confiável: todo IPC falharia com "Remetente IPC não autorizado" e só reiniciando
  // o app voltaria a funcionar. Aqui a janela volta sozinha para o servidor local.
  const leaveForeignPage = (url) => {
    if (shouldLeaveForeignPage(TRUSTED_ORIGIN, url)) goHome(wc);
  };
  wc.on('did-navigate', (_event, url) => leaveForeignPage(url));
  wc.on('did-navigate-in-page', (_event, url, isMainFrame) => {
    if (isMainFrame) leaveForeignPage(url);
  });

  // Servidor remoto fora do ar, link morto, sem rede: o Chromium deixaria a página de erro dele, sem
  // caminho de volta. Avisa e retorna ao servidor local.
  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return; // -3 = ERR_ABORTED (navegação substituída)
    if (isInternalUrl(validatedURL)) return;
    if (isTrustedUrl(validatedURL)) return;
    goHome(wc);
    if (!win.isDestroyed()) {
      dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Não foi possível abrir a transmissão',
        message: 'Não foi possível conectar ao endereço da transmissão.',
        detail:
          'O link pode ter expirado, o apresentador pode ter encerrado a sala ou faltar conexão com a ' +
          `internet. Você voltou para a tela inicial.\n(${errorDescription || `erro ${errorCode}`})`,
        buttons: ['OK'],
      }).catch(() => {});
    }
  });
  wc.on('render-process-gone', () => {
    stopAudio();
    nativeCapture.stop();
    pendingSourceId = null;
  });

  win.on('closed', () => {
    stopAudio();
    nativeCapture.stop();
    pendingSourceId = null;
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

// ─── Fluxo de inicialização em produção ──────────────────────────────────────

async function startEmbeddedRuntime(win) {
  // 0. Verifica e aplica atualizações no splash antes de iniciar serviços e abrir o menu
  if (appUpdater) {
    const updated = await appUpdater.checkStartupUpdate({
      timeoutMs: 3500,
      onStatus: (msg) => updateSplashStatus(win, msg),
    });
    if (updated) {
      // O instalador foi iniciado para atualizar o aplicativo
      return;
    }
  }

  // 1. Descobre porta livre
  const port = await findFreePort();
  embeddedPort = port;
  const localOrigin = `http://127.0.0.1:${port}`;

  // 2. Registra TRUSTED_ORIGIN + CSP antes de carregar o renderer
  setTrustedOrigin(localOrigin);
  registerCspHeaders(localOrigin);

  // 3. Tenta subir o túnel (opcional — falha sem travar)
  let tunnelUrl = null;
  const cfBin = findCloudflared(app.isPackaged ? process.resourcesPath : undefined);

  if (cfBin) {
    try {
      console.log(`[desktop] Iniciando túnel cloudflared (porta ${port})…`);
      // Em app empacotado, confere o SHA-256 gravado no build (build-info.json) antes do spawn.
      const tunnel = await startTunnel(port, cfBin, {
        expectedSha256: app.isPackaged ? readExpectedCloudflaredSha(process.resourcesPath) : null,
      });
      tunnelUrl = tunnel.url;
      publicUrl = tunnelUrl;
      tunnelStop = tunnel.stop;
      console.log(`[desktop] Túnel ativo: ${tunnelUrl}`);

      // Avisa o usuário caso o cloudflared morra inesperadamente
      tunnel.events.on('unexpected-exit', ({ code, signal }) => {
        console.warn(`[desktop] cloudflared encerrou inesperadamente (code=${code}, signal=${signal})`);
        publicUrl = null;
        if (mainWindow && !mainWindow.isDestroyed()) {
          dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'Conexão interrompida',
            message: 'O túnel de acesso externo foi encerrado.',
            detail:
              'Outros usuários não poderão mais se conectar via internet.\n' +
              'Você pode continuar usando o app localmente ou reiniciá-lo para tentar novamente.',
            buttons: ['OK'],
          }).catch(() => {});
        }
      });
    } catch (err) {
      console.warn(`[desktop] Túnel falhou (sem internet?): ${err.message}`);
      // Continua sem túnel
    }
  } else {
    console.warn('[desktop] cloudflared não encontrado — sem URL pública.');
  }

  // 4. Inicia o servidor embutido
  const clientDistDir = resolveClientDist(app.isPackaged, app.isPackaged ? process.resourcesPath : undefined);
  const logDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logDir, { recursive: true });

  console.log(`[desktop] Iniciando servidor embutido na porta ${port}…`);
  const srv = await startServer({
    port,
    publicUrl: tunnelUrl,
    clientDistDir,
    logDir,
    isPackaged: app.isPackaged,
    resourcesPath: app.isPackaged ? process.resourcesPath : undefined,
    utilityProcess,
  });
  serverStop = srv.stop;
  console.log(`[desktop] Servidor embutido pronto em ${localOrigin}`);

  // 5. Carrega a janela principal
  await win.loadURL(localOrigin);

  // 6. Aviso amigável se não há túnel
  if (!tunnelUrl) {
    dialog.showMessageBox(win, {
      type: 'info',
      title: 'Sem acesso externo',
      message: 'O app está funcionando apenas localmente.',
      detail:
        'Não foi possível criar a conexão segura com a internet (cloudflared não encontrado ou ' +
        'sem acesso à rede).\nVocê pode transmitir e assistir apenas nesta máquina até que a ' +
        'conexão seja restabelecida e o aplicativo seja reiniciado.',
      buttons: ['OK'],
    }).catch(() => {});
  }
}

// ─── Ciclo de vida ───────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  if (!native) {
    console.warn(`[desktop] ${NATIVE_MISSING_MSG}${nativeLoadError ? ` (${nativeLoadError.message})` : ''}`);
  }

  // O protocolo app:// ainda precisa de um handler (Electron exige que exista).
  // Em PROD não é usado para servir o cliente, mas evita "Erro ao processar requisição".
  protocol.handle(APP_SCHEME, (request) => {
    return textResponse(404, 'Não usado em modo produção');
  });

  registerPermissions();
  registerDisplayMediaHandler();
  registerIpc();

  const win = createWindow();

  if (IS_DEV) {
    // ── Modo desenvolvimento ───────────────────────────────────────────────
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
  } else {
    // ── Modo produção: mostra splash e inicia runtime ─────────────────────
    loadSplashPage(win);

    startEmbeddedRuntime(win).catch((err) => {
      console.error('[desktop] Falha crítica ao iniciar runtime:', err);
      loadErrorPage(
        win,
        'Falha ao iniciar o aplicativo',
        escapeHtml(err && err.message)
      );
    });
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const w = createWindow();
      if (IS_DEV) {
        if (dev.url) w.loadURL(dev.url).catch(() => {});
      } else if (embeddedPort) {
        w.loadURL(`http://127.0.0.1:${embeddedPort}`).catch(() => {});
      }
    }
  });
});

app.on('window-all-closed', () => {
  stopAudio();
  stopRuntime();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopAudio();
  nativeCapture.stop();
  stopRuntime();
});

// Garantia extra de limpeza — evita processos órfãos
process.on('exit', () => {
  try { stopRuntime(); } catch { /* ok */ }
});
