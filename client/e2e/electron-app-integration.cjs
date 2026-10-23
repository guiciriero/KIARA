/**
 * electron-app-integration.cjs - teste de integracao do caminho REAL do app:
 *   desktop/src/nativeCapture.js (main) + desktop/src/preload.js (preload real) + captureService.ts (cliente).
 * Mede o fps de apresentacao da faixa devolvida por captureDisplay() com a captura nativa e com o fallback.
 *
 * Uso: <electron.exe> e2e/electron-app-integration.cjs --bundle=<bundle.js> [--native=1|0] [--secs=8]
 * O bundle expoe window.__e2e = { captureDisplay, getCaptureSize, computeScaleDown } (esbuild do cliente).
 */
const { app, BrowserWindow, ipcMain, screen, sharedTexture, desktopCapturer, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const { createNativeCapture } = require(path.resolve(__dirname, '../../desktop/src/nativeCapture.js'));

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
const bundle = arg('bundle', '');
const useNative = arg('native', '1') === '1';
const secs = Number(arg('secs', '8'));
const native = require(path.resolve(__dirname, '../../native/build/Release/screen_capture.node'));

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

app.whenReady().then(async () => {
  session.defaultSession.setDisplayMediaRequestHandler(async (_r, cb) => {
    const s = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    cb({ video: s[0] });
  });
  const d = screen.getPrimaryDisplay();
  const anim = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, fullscreen: true, webPreferences: { backgroundThrottling: false } });
  await anim.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:#000"><canvas id=c></canvas><script>
const c=document.getElementById('c');c.width=innerWidth;c.height=innerHeight;c.style.cssText='position:fixed;inset:0';
const x=c.getContext('2d');let n=0;(function f(){n++;x.fillStyle=n%2?'#fff':'#222';x.fillRect(0,0,c.width,c.height);x.fillStyle='#f00';x.fillRect((n*29)%c.width,0,200,c.height);requestAnimationFrame(f)})();</script>`));

  let win;
  const nativeCapture = createNativeCapture({
    getNative: () => (useNative ? native : null), screen, sharedTexture, desktopCapturer,
    getTarget: () => (win && !win.isDestroyed() ? win.webContents : null), platform: process.platform,
  });
  // mesmos canais e contrato que desktop/src/main.js registra com handle()
  const wrap = (fn) => async (_e, ...a) => { try { return { ok: true, data: await fn(...a) }; } catch (err) { return { ok: false, error: err.message }; } };
  ipcMain.handle('native-capture:available', wrap(() => nativeCapture.isAvailable()));
  ipcMain.handle('native-capture:start', wrap((o) => nativeCapture.start(o)));
  ipcMain.handle('native-capture:stop', wrap(() => { nativeCapture.stop(); }));
  ipcMain.handle('capture:select', wrap(() => undefined));
  ipcMain.handle('capture:list', wrap(() => []));
  ipcMain.handle('poc:done', (_e, r) => { console.log('RESULT ' + JSON.stringify({ electron: process.versions.electron, useNative, ...r })); setTimeout(() => app.exit(0), 300); });

  // preload REAL do app (contextIsolation + sandbox como em producao)
  win = new BrowserWindow({ show: true, width: 400, height: 300, x: 20, y: 20, alwaysOnTop: true,
    webPreferences: { preload: path.resolve(__dirname, '../../desktop/src/preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.webContents.on('console-message', (e) => console.log('[renderer] ' + (e.message ?? '')));
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><body><video id=v muted autoplay style="width:384px;height:216px"></video></body>'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  await win.loadURL('http://127.0.0.1:' + srv.address().port + '/');
  await win.webContents.executeJavaScript(fs.readFileSync(bundle, 'utf8'));
  // ponte de resultado: o preload real nao expoe 'poc:done', entao o resultado volta por executeJavaScript
  const out = await win.webContents.executeJavaScript(`(async () => {
    const cfg = { width: 1920, height: 1080, frameRate: 60, bitrate: 15000, codec: 'H264', quality: 'balanced' };
    const t0 = performance.now();
    const cap = await window.__e2e.captureDisplay(cfg, { withAudio: false, captureSourceId: null, contentHint: 'motion' });
    const startMs = performance.now() - t0;
    const track = cap.videoTrack;
    const v = document.getElementById('v'); v.srcObject = cap.stream; await v.play().catch(() => {});
    const ts = []; let go = true;
    const cb = (now) => { if (!go) return; ts.push(now); v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
    await new Promise((r) => setTimeout(r, 2500));
    const base = ts.length, t1 = performance.now();
    await new Promise((r) => setTimeout(r, ${secs} * 1000));
    go = false;
    const dt = (performance.now() - t1) / 1000;
    const iv = ts.slice(base + 1).map((q, i) => q - ts[base + i]).sort((a, b) => a - b);
    const size = window.__e2e.getCaptureSize(track);
    const res = {
      startMs: +startMs.toFixed(0), kind: track.kind, label: track.label, isNative: !!size, captureSize: size || null,
      settings: track.getSettings && track.getSettings(),
      presentedFps: +((ts.length - base) / dt).toFixed(1),
      intervalMs: { p50: +(iv[Math.floor(iv.length * .5)] || 0).toFixed(1), p99: +(iv[Math.floor(iv.length * .99)] || 0).toFixed(1) },
      scaleFor1080: size ? +window.__e2e.computeScaleDown(1080, null, track).toFixed(3) : 1,
    };
    track.stop();
    return res;
  })()`).catch((e) => ({ error: String(e) }));
  console.log('RESULT ' + JSON.stringify({ electron: process.versions.electron, useNative, ...out }));
  try { nativeCapture.stop(); } catch { /* ok */ }
  app.exit(0);
  setTimeout(() => app.exit(0), 5000);
});
setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, (secs + 60) * 1000);
