/**
 * Grava desktop/build/build-info.json (copiado para resources/ pelo electron-builder).
 * Contém só dados públicos: versão, SHA curto, data e (opcional) URL do feed de atualização.
 *
 * Variáveis de ambiente (opcionais):
 *   GITHUB_SHA         SHA do commit (CI). Fora do CI usa `git rev-parse`; sem git, "dev".
 *   KIARA_UPDATE_URL   feed https "generic" embutido como padrão (o usuário pode sobrescrever
 *                      com a mesma variável em tempo de execução).
 *
 * Uso: node scripts/write-build-info.mjs   (a partir de desktop/)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..');
const OUT_DIR = path.join(DESKTOP, 'build');

function shortSha() {
  const fromEnv = process.env.GITHUB_SHA;
  if (fromEnv && /^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], { cwd: DESKTOP, encoding: 'utf8' }).trim();
  } catch {
    return 'dev';
  }
}

function feedUrl() {
  const raw = process.env.KIARA_UPDATE_URL;
  if (!raw) return undefined;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : undefined;
  } catch {
    return undefined;
  }
}

const pkg = JSON.parse(fs.readFileSync(path.join(DESKTOP, 'package.json'), 'utf8'));
const info = {
  version: pkg.version,
  commit: shortSha(),
  builtAt: new Date().toISOString(),
  ...(feedUrl() ? { updateUrl: feedUrl() } : {}),
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`);
console.log(`[build-info] ${info.version} (${info.commit})`);
