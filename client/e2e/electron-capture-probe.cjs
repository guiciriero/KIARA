/**
 * electron-capture-probe.cjs - mede o fps REAL do getDisplayMedia dentro do Electron
 * (mesma pagina animada do capture-probe.mjs), usando o mesmo caminho do app:
 * session.setDisplayMediaRequestHandler + desktopCapturer.
 *
 * Uso: <electron.exe> e2e/electron-capture-probe.cjs [--secs 8]
 * (o binario do Electron nao e dependencia do client; ver docs/AUDITORIA-STREAMING.md)
 */
const { app, BrowserWindow, desktopCapturer, session, screen } = require('electron');
const http = require('node:http');

const secs = Number((process.argv.find((a) => a.startsWith('--secs=')) || '--secs=8').split('=')[1]);

const PAGE = `<html><body style="margin:0;background:#000"><canvas id=c></canvas><script>
const c=document.getElementById('c');c.width=innerWidth;c.height=innerHeight;c.style.cssText='position:fixed;inset:0';
const x=c.getContext('2d');let n=0;
(function f(){n++;x.fillStyle=n%2?'#fff':'#222';x.fillRect(0,0,c.width,c.height);x.fillStyle='#f00';x.fillRect((n*29)%c.width,0,200,c.height);requestAnimationFrame(f)})();
</script></body></html>`;

const PROBE = (s) => `(async () => {
  const res = [];
  for (const [w, h, f, mode] of [[1920, 1080, 60, 'none'], [1920, 1080, 60, 'crop-and-scale'], [2560, 1440, 60, 'none']]) {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: f, max: 120 }, resizeMode: mode } });
    const t = s.getVideoTracks()[0];
    const v = document.createElement('video');
    v.muted = true; v.srcObject = s; v.style.cssText = 'position:fixed;width:2px;height:2px;opacity:0;right:0;bottom:0';
    document.body.appendChild(v); await v.play();
    const ts = []; let go = true;
    const cb = (now, m) => { if (!go) return; ts.push(m.captureTime ?? now); v.requestVideoFrameCallback(cb); };
    v.requestVideoFrameCallback(cb);
    await new Promise((r) => setTimeout(r, ${s} * 1000)); go = false;
    const iv = ts.slice(1).map((q, i) => q - ts[i]).filter((q) => q > 0).sort((a, b) => a - b);
    const set = t.getSettings();
    res.push({ asked: w + 'x' + h + '@' + f + ' ' + mode, got: set.width + 'x' + set.height + '@' + set.frameRate, fps: +(ts.length / ${s}).toFixed(1),
      p50: +iv[Math.floor(iv.length * .5)]?.toFixed(1), p99: +iv[Math.floor(iv.length * .99)]?.toFixed(1), max: +iv[iv.length - 1]?.toFixed(1) });
    s.getTracks().forEach((q) => q.stop()); v.remove();
  }
  return res;
})()`;

app.whenReady().then(async () => {
  const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));

  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    cb({ video: sources[0] });
  });

  const d = screen.getPrimaryDisplay();
  const win = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, fullscreen: true, show: true,
    webPreferences: { backgroundThrottling: false } });
  await win.loadURL('http://127.0.0.1:' + srv.address().port + '/');
  win.focus();
  await new Promise((r) => setTimeout(r, 2500));
  try {
    const out = await win.webContents.executeJavaScript(PROBE(secs), true);
    console.log('RESULT ' + JSON.stringify({ electron: process.versions.electron, chrome: process.versions.chrome, display: d.size, scale: d.scaleFactor, out }));
  } catch (e) {
    console.log('ERROR ' + e.message);
  }
  srv.close();
  app.exit(0);
});
