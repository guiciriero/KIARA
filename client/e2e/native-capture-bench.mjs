/**
 * native-capture-bench.mjs ??? mede o fps REAL da captura nativa (native/build/Release/screen_capture.node)
 * sobre a mesma p??gina animada do capture-probe.mjs.
 *
 * Decodifica a posi????o da barra vermelha (n*29 mod largura) de cada frame recebido para contar
 * quantos frames DISTINTOS da p??gina foram capturados (e n??o s?? quantos callbacks chegaram).
 *
 * Uso: node e2e/native-capture-bench.mjs [--fps 60] [--duration 8] [--monitor 0]
 */
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const native = require(path.resolve(here, '../../native/build/Release/screen_capture.node'));

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const fps = Number(arg('fps', '60'));
const duration = Number(arg('duration', '8'));
const monitorIndex = Number(arg('monitor', '0'));

const PAGE = `<html><body style="margin:0;background:#000"><canvas id=c></canvas><script>
const c=document.getElementById('c');c.width=innerWidth;c.height=innerHeight;c.style.cssText='position:fixed;inset:0';
const x=c.getContext('2d');let n=0;window.__n=0;
(function f(){n++;window.__n=n;x.fillStyle=n%2?'#fff':'#222';x.fillRect(0,0,c.width,c.height);x.fillStyle='#f00';x.fillRect((n*29)%c.width,0,200,c.height);requestAnimationFrame(f)})();
</script></body></html>`;
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));

const b = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: false, defaultViewport: null,
  args: ['--no-first-run', '--window-position=0,0', '--window-size=2560,1440', '--user-data-dir=' + path.join(process.env.TEMP, 'kiara-nb-profile'), '--autoplay-policy=no-user-gesture-required'],
});
const p = await b.newPage();
await p.goto('http://127.0.0.1:' + srv.address().port + '/');
const cdp = await p.createCDPSession(); const { windowId } = await cdp.send('Browser.getWindowForTarget'); await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
await p.bringToFront();
await new Promise((r) => setTimeout(r, 3000));
const page0 = await p.evaluate(() => window.__n);

const stamps = [];
const seenX = new Set();
let w = 0, h = 0, bytes = 0, decodeFail = 0;
const cpu0 = process.cpuUsage();
const t0 = performance.now();
native.startCapture({ fps, monitorIndex }, (frame) => {
  const now = performance.now();
  stamps.push(now);
  w = frame.width; h = frame.height; bytes += frame.data.length;
  // linha a 1/2 da altura; BGRA; procura o primeiro pixel vermelho puro (B<60,G<60,R>200)
  const row = Math.floor(frame.height / 2) * frame.pitch;
  let xr = -1;
  for (let i = 0; i < frame.width; i++) {
    const o = row + i * 4;
    if (frame.data[o + 2] - Math.max(frame.data[o + 1], frame.data[o]) > 120) { xr = i; break; }
  }
  if (xr < 0) decodeFail++; else seenX.add(xr);
});
await new Promise((r) => setTimeout(r, duration * 1000));
native.stopCapture();
const dt = (performance.now() - t0) / 1000;
const cpu = process.cpuUsage(cpu0);
const page1 = await p.evaluate(() => window.__n);
await b.close(); srv.close();

const iv = stamps.slice(1).map((q, i) => q - stamps[i]).sort((a, c) => a - c);
const q = (f) => +(iv[Math.floor(iv.length * f)] ?? 0).toFixed(1);
console.log(JSON.stringify({
  requestedFps: fps, resolution: `${w}x${h}`, seconds: +dt.toFixed(1),
  callbacksPerSec: +(stamps.length / dt).toFixed(1),
  distinctPageFramesPerSec: +(seenX.size / dt).toFixed(1),
  decodeFail,
  pageRafPerSec: +((page1 - page0) / (dt + 2)).toFixed(1),
  intervalMs: { p50: q(0.5), p99: q(0.99), max: +(iv[iv.length - 1] ?? 0).toFixed(1) },
  jsMBperSec: +(bytes / dt / 1e6).toFixed(0),
  nodeCpuPct: +(((cpu.user + cpu.system) / 1e6 / dt) * 100).toFixed(0),
}));
process.exit(0);

