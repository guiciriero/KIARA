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
async function downloadDirect(url, destFile, expectedSha) {
  const tmp = `${destFile}.download`;
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  console.log(`[prepare-resources] Baixando: ${url}`);
  const res = await httpsGet(url);
  const hash = crypto.createHash('sha256');
  
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(tmp);
    res.on('data', (c) => hash.update(c));
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    res.pipe(out);
  });

  const stats = fs.statSync(tmp);
  if (stats.size < 5 * 1024 * 1024) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Arquivo baixado é muito pequeno (${stats.size} bytes), possível página de erro.`);
  }

  // Verifica magic bytes de executável Windows (MZ)
  const fd = fs.openSync(tmp, 'r');
  const buffer = Buffer.alloc(2);
  fs.readSync(fd, buffer, 0, 2, 0);
  fs.closeSync(fd);
  if (buffer.toString('ascii') !== 'MZ') {
    fs.rmSync(tmp, { force: true });
    throw new Error('O arquivo baixado não é um executável Windows válido.');
  }

  const got = hash.digest('hex');
  if (expectedSha && got !== expectedSha) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`SHA-256 NÃO confere para ${ASSET}.\n  esperado: ${expectedSha}\n  obtido:   ${got}`);
  }

  fs.renameSync(tmp, destFile);
  console.log(`[prepare-resources] cloudflared pronto em: ${destFile} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
}

async function prepareCloudflared() {
  // Se o binário já existe e é válido (> 5MB), não rebaixa
  if (fs.existsSync(OUT_FILE)) {
    const stats = fs.statSync(OUT_FILE);
    if (stats.size > 5 * 1024 * 1024) {
      console.log(`[prepare-resources] cloudflared.exe já existe e é válido (${(stats.size / 1024 / 1024).toFixed(1)} MB). Pulando download.`);
      return;
    }
  }

  const envTag = process.env.CLOUDFLARED_VERSION?.trim();
  const envSha = process.env.CLOUDFLARED_SHA256?.trim().toLowerCase().replace(/^sha256:/, '');

  let downloadUrl = `https://github.com/${REPO}/releases/latest/download/${ASSET}`;
  let expectedSha = envSha || null;

  if (envTag && envTag !== 'latest') {
    // Tenta obter release da API se houver token, caso contrário faz download direto da tag
    try {
      const api = `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(envTag)}`;
      const rel = await getJson(api);
      const asset = (rel.assets || []).find((a) => a.name === ASSET);
      if (asset) {
        if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')) {
          expectedSha = asset.digest.slice('sha256:'.length).toLowerCase();
        }
      }
      downloadUrl = `https://github.com/${REPO}/releases/download/${encodeURIComponent(rel.tag_name || envTag)}/${ASSET}`;
    } catch {
      // Fallback sem API se GitHub retornar 403 / rate limit
      console.warn(`[prepare-resources] Aviso: API do GitHub indisponível ou rate limit. Usando download direto da release.`);
      downloadUrl = `https://github.com/${REPO}/releases/download/${encodeURIComponent(envTag)}/${ASSET}`;
    }
  } else {
    // Modo latest: tenta pegar digest da API ou usa download direto latest
    try {
      const api = `https://api.github.com/repos/${REPO}/releases/latest`;
      const rel = await getJson(api);
      const asset = (rel.assets || []).find((a) => a.name === ASSET);
      if (asset) {
        if (typeof asset.digest === 'string' && asset.digest.startsWith('sha256:')) {
          expectedSha = asset.digest.slice('sha256:'.length).toLowerCase();
        }
      }
      if (rel.tag_name) {
        downloadUrl = `https://github.com/${REPO}/releases/download/${encodeURIComponent(rel.tag_name)}/${ASSET}`;
      }
    } catch {
      console.warn(`[prepare-resources] Aviso: API do GitHub indisponível. Usando release oficial mais recente.`);
      downloadUrl = `https://github.com/${REPO}/releases/latest/download/${ASSET}`;
    }
  }

  await downloadDirect(downloadUrl, OUT_FILE, expectedSha);
}

checkPrereqs();
try {
  await prepareCloudflared();
} catch (err) {
  fail(`Falha ao obter o cloudflared: ${err.message}`);
}
console.log('[prepare-resources] Recursos prontos.');
