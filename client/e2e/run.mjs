/**
 * run.mjs — orquestrador do teste e2e em Chrome real.
 *
 * 1. empacota e2e/harness.ts com esbuild (código de produção de src/services);
 * 2. serve o bundle + index.html + public/app-audio-worklet.js em 127.0.0.1;
 * 3. abre o Chrome instalado via puppeteer-core e roda os cenários na página;
 * 4. imprime PASS/FAIL por cenário; exit 0 = tudo certo, 1 = falha, 2 = ambiente (Chrome ausente).
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
const IS_CI = process.env.CI === 'true' || process.env.CI === '1';

const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const LINUX_CANDIDATES = ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser'];

/** Procura um executável no PATH */
function findInPath(name) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // próximo
      }
    }
  }
  return null;
}

/** CHROME_PATH / PUPPETEER_EXECUTABLE_PATH, depois PATH (Linux) e o app do macOS */
function locateChrome() {
  for (const envName of ['CHROME_PATH', 'PUPPETEER_EXECUTABLE_PATH']) {
    const value = process.env[envName];
    if (value) return { path: value, source: envName, explicit: true };
  }
  for (const name of LINUX_CANDIDATES) {
    const found = findInPath(name);
    if (found) return { path: found, source: 'PATH', explicit: false };
  }
  if (fs.existsSync(MAC_CHROME)) return { path: MAC_CHROME, source: 'macOS', explicit: false };
  return null;
}
const GLOBAL_TIMEOUT_MS = 150_000;

const located = locateChrome();
if (!located || !fs.existsSync(located.path)) {
  console.error(`✗ Chrome não encontrado${located ? ` em: ${located.path} (${located.source})` : ''}`);
  console.error('  Instale o Google Chrome/Chromium ou aponte o executável com CHROME_PATH=/caminho/do/chrome npm run e2e');
  process.exit(2);
}
const chromePath = located.path;

const t0 = Date.now();
let server = null;
let browser = null;
let userDataDir = null;
let exitCode = 1;

async function cleanup() {
  if (browser) await browser.close().catch(() => undefined);
  browser = null;
  if (server) await new Promise((r) => server.close(() => r()));
  server = null;
  if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
  userDataDir = null;
}

async function main() {
  // 1. Bundle
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  await build({
    entryPoints: [path.join(here, 'harness.ts')],
    outfile: path.join(buildDir, 'harness.js'),
    bundle: true,
    format: 'iife',
    target: 'chrome120',
    sourcemap: 'inline',
    logLevel: 'warning',
    alias: { '@shared': path.resolve(clientDir, '../shared/types') }, // só tipos; apagado no bundle
    define: {
      'import.meta.env': JSON.stringify({ BASE_URL: '/' }),
    },
  });

  // 2. Servidor estático (somente loopback)
  const files = {
    '/': [path.join(here, 'index.html'), 'text/html; charset=utf-8'],
    '/index.html': [path.join(here, 'index.html'), 'text/html; charset=utf-8'],
    '/harness.js': [path.join(buildDir, 'harness.js'), 'text/javascript; charset=utf-8'],
    '/app-audio-worklet.js': [path.join(clientDir, 'public', 'app-audio-worklet.js'), 'text/javascript; charset=utf-8'],
  };
  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }
    const entry = files[url];
    if (!entry) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': entry[1], 'cache-control': 'no-store' });
    fs.createReadStream(entry[0]).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  // 3. Chrome
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiara-e2e-'));
  browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true, // "new headless" (no puppeteer atual, true = modo headless novo)
    userDataDir,
    protocolTimeout: 120_000,
    timeout: 30_000,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--disable-features=WebRtcHideLocalIpsWithMdns',
      '--no-first-run',
      '--no-default-browser-check',
      // Contêineres de CI Linux normalmente rodam como root, sem sandbox de usuário
      ...(IS_CI ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
  });
  const version = await browser.version();
  console.log(`KIARA e2e — ${version} | http://127.0.0.1:${port}/`);

  const page = await browser.newPage();
  page.on('pageerror', (err) => console.log(`  [página:erro] ${err.message}`));
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error' || type === 'warning') console.log(`  [página:${type}] ${msg.text()}`);
  });
  await page.exposeFunction('__e2eLog', (line) => console.log(line));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load', timeout: 15_000 });
  await page.waitForFunction('typeof window.__runAll === "function"', { timeout: 10_000 });

  // 4. Cenários
  const results = await page.evaluate(() => window.__runAll());

  console.log('\n══════════════ Resumo ══════════════');
  for (const r of results) {
    console.log(`  ${r.status.padEnd(12)} ${String(r.num).padStart(2)}. ${r.title}  (${(r.elapsedMs / 1000).toFixed(1)} s)`);
    for (const f of r.failures) console.log(`      ✗ ${f}`);
  }
  const failed = results.filter((r) => r.status === 'FAIL');
  const unvalidated = results.filter((r) => r.status === 'NÃO VALIDADO');
  const passed = results.filter((r) => r.status === 'PASS');
  console.log(
    `\n${failed.length ? 'FALHOU' : 'OK'}: ${passed.length} PASS, ${failed.length} FAIL, ${unvalidated.length} NÃO VALIDADO ` +
      `— ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  exitCode = failed.length ? 1 : 0;
}

const watchdog = setTimeout(async () => {
  console.error(`✗ Timeout global de ${GLOBAL_TIMEOUT_MS / 1000} s excedido`);
  await cleanup();
  process.exit(1);
}, GLOBAL_TIMEOUT_MS);

try {
  await main();
} catch (err) {
  console.error('✗ Erro ao executar o e2e:', err?.stack || err);
  exitCode = 1;
} finally {
  clearTimeout(watchdog);
  await cleanup();
}
process.exit(exitCode);
