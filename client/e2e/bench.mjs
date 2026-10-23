/**
 * bench.mjs â€” benchmark de pipeline de vÃ­deo em Chrome real (loopback).
 *
 * Uso:
 *   node e2e/bench.mjs                              # matriz padrÃ£o (1080p60 H264/VP9/AV1 @ 8/15/25 Mbps)
 *   node e2e/bench.mjs --codec H264 --bitrate 20000 --fps 60 --res 1920x1080 --duration 15
 *   node e2e/bench.mjs --headless false --out bench-results.json
 *   CHROME_PATH=... node e2e/bench.mjs
 *
 * Flags extras do Chrome: --chrome-flags "--flag1 --flag2".
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.resolve(here, '..');
const buildDir = path.join(here, '.build');

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
].filter(Boolean);
const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chromePath) {
  console.error('Chrome nÃ£o encontrado; defina CHROME_PATH');
  process.exit(2);
}

const [W, H] = arg('res', '1920x1080').split('x').map(Number);
const fps = Number(arg('fps', '60'));
const duration = Number(arg('duration', '15'));
const headless = arg('headless', 'true') !== 'false';
const outFile = arg('out', '');
const extraFlags = (arg('chrome-flags', '') || '').split(/\s+/).filter(Boolean);
const quality = arg('quality', 'game');

const codecs = arg('codec', 'H264,VP9,AV1').split(',');
const bitrates = arg('bitrate', '8000,15000,25000').split(',').map(Number);

await fs.promises.rm(buildDir, { recursive: true, force: true });
await fs.promises.mkdir(buildDir, { recursive: true });
await build({
  entryPoints: [path.join(here, 'bench-harness.ts')],
  outfile: path.join(buildDir, 'bench-harness.js'),
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'warning',
  alias: { '@shared': path.resolve(clientDir, '../shared/types') },
  define: { 'import.meta.env': JSON.stringify({ BASE_URL: '/' }) },
});

const files = {
  '/': [path.join(here, 'bench.html'), 'text/html; charset=utf-8'],
  '/bench-harness.js': [path.join(buildDir, 'bench-harness.js'), 'text/javascript; charset=utf-8'],
};
const server = http.createServer((req, res) => {
  const e = files[(req.url || '/').split('?')[0]];
  if (!e) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': e[1], 'cache-control': 'no-store' });
  fs.createReadStream(e[0]).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const results = [];
for (const codec of codecs) {
  for (const bitrate of bitrates) {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiara-bench-'));
    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless,
      userDataDir,
      protocolTimeout: 180_000,
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--disable-features=WebRtcHideLocalIpsWithMdns',
        '--disable-frame-rate-limit',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--enable-gpu-rasterization',
        '--ignore-gpu-blocklist',
        '--no-first-run',
        ...extraFlags,
      ],
    });
    try {
      const page = await browser.newPage();
      page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
      await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
      await page.waitForFunction('typeof window.__runBench === "function"');
      const cfg = { width: W, height: H, fps, codec, bitrate, durationSec: duration, warmupSec: Number(arg('warmup', '4')), quality, measureLatency: arg('latency', 'true') !== 'false', ...(arg('jb', '') !== '' ? { jbTarget: Number(arg('jb')) } : {}) };
      process.stdout.write(`â–¶ ${codec} ${W}x${H}@${fps} ${bitrate}kbps ... `);
      const r = await page.evaluate((c) => window.__runBench(c), cfg);
      results.push(r);
      if (r.error) console.log('ERRO', r.error);
      else
        console.log(
          `codec=${r.negotiatedCodec} | ` +
            `sent ${r.sender.sentFps}fps ${r.sender.bitrateMbps}Mbps encode ${r.sender.avgEncodeMs}ms | ` +
            `present ${r.receiver.presentedFps}fps drop=${r.receiver.framesDropped} freeze=${r.receiver.freezeCount} | ` +
            `g2g p50/p95 ${r.glassToGlassMs.p50}/${r.glassToGlassMs.p95}ms | limit=${r.sender.qualityLimitationReason}`,
        );
    } catch (e) {
      console.log('FALHOU', e.message);
      results.push({ config: { codec, bitrate }, error: e.message });
    } finally {
      await browser.close().catch(() => {});
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  }
}
server.close();
if (outFile) fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
else console.log('\n' + JSON.stringify(results, null, 2));
process.exit(0);




