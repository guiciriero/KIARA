import puppeteer from 'puppeteer-core';
import http from 'node:http';

const PAGE = `<html><body style="margin:0;background:#000"><canvas id=c></canvas><script>
const c=document.getElementById('c');c.width=innerWidth;c.height=innerHeight;c.style.cssText='position:fixed;inset:0';
const x=c.getContext('2d');let n=0;
(function f(){n++;x.fillStyle=n%2?'#fff':'#222';x.fillRect(0,0,c.width,c.height);x.fillStyle='#f00';x.fillRect((n*29)%c.width,0,200,c.height);requestAnimationFrame(f)})();
</script></body></html>`;
const srv = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(PAGE); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));

const b = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: false,
  defaultViewport: null,
  args: ['--auto-select-desktop-capture-source=Entire screen', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--start-maximized', '--window-position=0,0', '--disable-frame-rate-limit',
    // Flags extras para experimentos, ex.: PROBE_FLAGS="--enable-features=ZeroCopyDesktopCapture"
    ...(process.env.PROBE_FLAGS || '').split(/\s+/).filter(Boolean)],
});
const p = await b.newPage();
await p.goto('http://127.0.0.1:' + srv.address().port + '/');
const out = await p.evaluate(async () => {
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
    await new Promise((r) => setTimeout(r, 8000)); go = false;
    const iv = ts.slice(1).map((q, i) => q - ts[i]).filter((q) => q > 0).sort((a, b) => a - b);
    const set = t.getSettings();
    res.push({ asked: `${w}x${h}@${f} ${mode}`, got: `${set.width}x${set.height}@${set.frameRate}`, fps: +(ts.length / 8).toFixed(1),
      p50: +iv[Math.floor(iv.length * .5)]?.toFixed(1), p99: +iv[Math.floor(iv.length * .99)]?.toFixed(1), max: +iv[iv.length - 1]?.toFixed(1) });
    s.getTracks().forEach((q) => q.stop()); v.remove();
  }
  return res;
});
console.log(JSON.stringify(out));
await b.close(); srv.close();
