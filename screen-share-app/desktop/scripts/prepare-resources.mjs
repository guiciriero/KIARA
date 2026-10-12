/**
 * Prepara os recursos externos do instalador:
 *   desktop/resources/bin/cloudflared.exe  (baixado da release oficial do GitHub)
 *
 * Antes disso, confere se os artefatos dos passos anteriores existem.
 *
 * Variáveis de ambiente (opcionais):
 *   CLOUDFLARED_VERSION  tag exata da release (ex.: 2026.10.0). Padrão: a última release (via API).
 *   CLOUDFLARED_SHA256   SHA-256 esperado. Obrigatório SOMENTE se a API não informar o digest.
 *                        Se a API informar o digest e este valor divergir, o build falha.
 *   GITHUB_TOKEN         opcional; só é enviado para api.github.com (evita limite de requisições).
 *
 * Uso: node scripts/prepare-resources.mjs   (a partir de desktop/)
 */

import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const ROOT = path.resolve(DESKTOP, '..');

const REPO = 'cloudflare/cloudflared';
const ASSET = 'cloudflared-windows-amd64.exe';
const OUT_DIR = path.join(DESKTOP, 'resources', 'bin');
const OUT_FILE = path.join(OUT_DIR, 'cloudflared.exe');

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 60_000;

function fail(msg) {
  console.error(`\n[prepare-resources] ERRO: ${msg}\n`);
  process.exit(1);
}

// ── (a) Pré-requisitos ─────────────────────────────────────────────────────
function checkPrereqs() {
  const required = [
    {
      file: path.join(DESKTOP, 'build', 'server', 'server.cjs'),
      step: 'Rode "npm run bundle:server" (em desktop/) para gerar o servidor embutido.',
    },
    {
      file: path.join(ROOT, 'client', 'dist', 'index.html'),
      step: 'Rode "npm install && npm run build" em client/ para gerar o site.',
    },
    {
      file: path.join(ROOT, 'native', 'build', 'Release', 'screen_capture.node'),
      step: 'Rode "npm install && npm run build" em native/ (no Windows) para compilar o módulo nativo.',
    },
  ];
  const missing = required.filter((r) => !fs.existsSync(r.file));
  if (missing.length) {
    fail(
      'Arquivos obrigatórios não encontrados:\n' +
        missing.map((m) => `  - ${m.file}\n    → ${m.step}`).join('\n'),
    );
  }
  console.log('[prepare-resources] Pré-requisitos OK (server.cjs, client/dist, screen_capture.node).');
}

// ── HTTPS com redirecionamentos (máx. 5, somente https, com timeout) ───────
function httpsGet(url, { headers = {}, redirectsLeft = MAX_REDIRECTS } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch {
      return reject(new Error(`URL inválida: ${url}`));
    }
    if (u.protocol !== 'https:') {
      return reject(new Error(`Somente https é permitido (recebido: ${u.protocol})`));
    }
    const req = https.get(
      u,
      { headers: { 'User-Agent': 'screen-share-prepare-resources', ...headers }, timeout: TIMEOUT_MS },
      (res) => {
        const code = res.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) return reject(new Error('Redirecionamentos demais (limite 5)'));
          const next = new URL(res.headers.location, u).toString();
          // Não repassa cabeçalhos (ex.: Authorization) para o destino do redirecionamento.
          return resolve(httpsGet(next, { headers: {}, redirectsLeft: redirectsLeft - 1 }));
        }
        if (code !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${code} em ${u.origin}${u.pathname}`));
        }
        resolve(res);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Timeout após ${TIMEOUT_MS / 1000}s`)));
    req.on('error', reject);
  });
}

async function getJson(url) {
  const headers = { Accept: 'application/vnd.github+json' };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await httpsGet(url, { headers });
  let body = '';
  for await (const chunk of res) body += chunk;
  return JSON.parse(body);
}

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// ── (b) cloudflared ────────────────────────────────────────────────────────
async function resolveRelease() {
  const envTag = process.env.CLOUDFLARED_VERSION?.trim();
  const envSha = process.env.CLOUDFLARED_SHA256?.trim().toLowerCase().replace(/^sha256:/, '');

  // Tag + hash informados manualmente: dispensa a API.
  if (envTag && envSha) return { tag: envTag, digest: null, envSha };

  const api = envTag
    ? `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(envTag)}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;
  const rel = await getJson(api);
  const asset = (rel.assets || []).find((a) => a.name === ASSET);
  if (!asset) fail(`Asset ${ASSET} não encontrado na release ${rel.tag_name ?? envTag}.`);
  const digest = typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')
    ? asset.digest.slice('sha256:'.length).toLowerCase()
    : null;
  return { tag: rel.tag_name, digest, envSha };
}

async function downloadVerified(url, expected, destFile) {
  const tmp = `${destFile}.download`;
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const res = await httpsGet(url);
  const hash = crypto.createHash('sha256');
  res.on('data', (c) => hash.update(c));
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    res.pipe(out);
  });
  const got = hash.digest('hex');
  if (got !== expected) {
    fs.rmSync(tmp, { force: true });
    fail(`SHA-256 NÃO confere para ${ASSET}.\n  esperado: ${expected}\n  obtido:   ${got}`);
  }
  fs.renameSync(tmp, destFile);
}

async function prepareCloudflared() {
  const { tag, digest, envSha } = await resolveRelease();

  let expected;
  if (digest) {
    if (envSha && envSha !== digest) {
      fail(`CLOUDFLARED_SHA256 (${envSha}) diverge do digest oficial da release (${digest}).`);
    }
    expected = digest;
  } else if (envSha) {
    expected = envSha;
  } else {
    fail(
      `A release ${tag} não publica digest SHA-256 para ${ASSET}.\n` +
        '  Defina CLOUDFLARED_SHA256 com o hash esperado para continuar.',
    );
  }
  if (!/^[0-9a-f]{64}$/.test(expected)) fail(`SHA-256 esperado inválido: ${expected}`);

  console.log(`[prepare-resources] cloudflared ${tag} — sha256 esperado: ${expected}`);

  if (fs.existsSync(OUT_FILE) && (await sha256File(OUT_FILE)) === expected) {
    console.log(`[prepare-resources] Cache OK, já existe e confere: ${OUT_FILE}`);
    return;
  }

  const url = `https://github.com/${REPO}/releases/download/${encodeURIComponent(tag)}/${ASSET}`;
  console.log(`[prepare-resources] Baixando ${url}`);
  await downloadVerified(url, expected, OUT_FILE);
  console.log(`[prepare-resources] Baixado e verificado: ${OUT_FILE}`);
}

checkPrereqs();
try {
  await prepareCloudflared();
} catch (err) {
  fail(`Falha ao obter o cloudflared: ${err.message}`);
}
console.log('[prepare-resources] Recursos prontos.');
