/**
 * Atualiza o latest.yml depois que o instalador foi assinado.
 *
 * O electron-updater confere o sha512 e o tamanho do .exe listados no latest.yml. Assinar o
 * instalador altera os dois, então eles precisam ser recalculados a partir do arquivo final.
 * O .blockmap também deixa de valer; apague-o (o app baixa o instalador inteiro nesse caso).
 *
 * Uso: node scripts/refresh-latest-yml.mjs   (a partir de desktop/)
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RELEASE_DIR = process.env.RELEASE_DIR || path.resolve(__dirname, '..', 'release');
const ymlPath = path.join(RELEASE_DIR, 'latest.yml');

const original = fs.readFileSync(ymlPath, 'utf8');
const exeName = original.match(/^path:\s*(.+)$/m)?.[1]?.trim();
if (!exeName) throw new Error('latest.yml sem o campo "path".');

const exe = fs.readFileSync(path.join(RELEASE_DIR, exeName));
const sha512 = crypto.createHash('sha512').update(exe).digest('base64');

const updated = original
  .replace(/^(\s*(?:-\s+)?sha512:\s*).+$/gm, `$1${sha512}`)
  .replace(/^(\s*size:\s*).+$/gm, `$1${exe.length}`)
  .replace(/^\s*blockMapSize:.*\n/gm, '');

fs.writeFileSync(ymlPath, updated);
console.log(`[latest.yml] ${exeName}: ${exe.length} bytes, sha512 atualizado`);
