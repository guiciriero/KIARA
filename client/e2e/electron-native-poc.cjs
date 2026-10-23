/**
 * electron-native-poc.cjs - prototipo medido: captura DXGI zero-copy (addon) -> electron.sharedTexture
 * -> VideoFrame (GPU) -> MediaStreamTrackGenerator -> RTCPeerConnection loopback (encode do Chromium).
 *
 * Uso: <electron.exe> e2e/electron-native-poc.cjs --codec=H265 --secs=10 --scale=1.3333 --fps=60 --monitor=0
 * Saida: linha "RESULT {json}". A janela animada fica no monitor 0 (a mesma que e capturada).
 */
const { app, BrowserWindow, ipcMain, screen, sharedTexture, session, desktopCapturer } = require('electron');
const path = require('node:path');

const arg = (n, d) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d; };
const codec = arg('codec', 'H264');
const secs = Number(arg('secs', '10'));
const scale = Number(arg('scale', '1'));
const fps = Number(arg('fps', '60'));
const monitor = Number(arg('monitor', '0'));
const bitrate = Number(arg('bitrate', '15000')) * 1000;
const source = arg('source', 'native');
const isolated = arg('isolated', '0') === '1';
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
  // janela que anima o monitor capturado (fundo da captura)
  const anim = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, fullscreen: true,
    webPreferences: { backgroundThrottling: false } });
  await anim.loadURL('data:text/html,' + encodeURIComponent(`<body style="margin:0;background:#000"><canvas id=c></canvas><script>
const c=document.getElementById('c');c.width=innerWidth;c.height=innerHeight;c.style.cssText='position:fixed;inset:0';
const x=c.getContext('2d');let n=0;(function f(){n++;x.fillStyle=n%2?'#fff':'#222';x.fillRect(0,0,c.width,c.height);x.fillStyle='#f00';x.fillRect((n*29)%c.width,0,200,c.height);requestAnimationFrame(f)})();</script>`));

  // janela do pipeline (contextIsolation desligado so no PoC: VideoFrame nao atravessa contextBridge)
  const win = new BrowserWindow({ show: true, width: 400, height: 300, x: 20, y: 20, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'electron-native-poc-preload.cjs'), contextIsolation: isolated, sandbox: isolated, backgroundThrottling: false } });
  win.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer] ' + msg));
  win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer gone] ' + d.reason));

  const slotsInFlight = new Map();
  let sentToRenderer = 0, sendErrors = 0, lastErr = '';
  ipcMain.handle('poc:ready', async () => {
    if (source === 'native') native.startSharedCapture({ fps, monitorIndex: monitor }, (f) => {
      const tex = sharedTexture.importSharedTexture({
        textureInfo: { codedSize: { width: f.width, height: f.height }, pixelFormat: 'bgra', timestamp: f.timestampUs,
          handle: { ntHandle: f.handle } },
        allReferencesReleased: () => native.releaseSharedFrame(f.slot),
      });
      sharedTexture.sendSharedTexture({ frame: win.webContents.mainFrame, importedSharedTexture: tex })
        .then(() => { sentToRenderer++; })
        .catch((e) => { sendErrors++; lastErr = String(e && e.message || e); })
        .finally(() => tex.release());
    });
    return { codec, secs, scale, fps, bitrate, source };
  });
  ipcMain.handle('poc:done', (_e, result) => {
    const st = source === 'native' ? native.stopSharedCapture() : null;
    console.log('RESULT ' + JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome,
      native: st, sentToRenderer, sendErrors, lastErr, ...result }));
    setTimeout(() => app.exit(0), 300);
  });
  await win.loadFile(path.join(__dirname, 'electron-native-poc.html'));
  anim.focus();
  setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, (secs + 40) * 1000);
});
