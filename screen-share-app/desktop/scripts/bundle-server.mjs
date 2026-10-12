/**
 * Gera desktop/build/server/server.cjs a partir de server/src/index.ts.
 * Uso: node desktop/scripts/bundle-server.mjs  (a partir da raiz do mono-repo)
 *
 * O bundle é CJS puro — pode ser executado com:
 *   ELECTRON_RUN_AS_NODE=1 <electron-bin> desktop/build/server/server.cjs
 * ou pelo utilityProcess do Electron (que já usa ELECTRON_RUN_AS_NODE internamente).
 */

import { build } from '../node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // raiz do mono-repo

const entryPoint = path.join(ROOT, 'server', 'src', 'index.ts');
const outfile = path.join(__dirname, '..', 'build', 'server', 'server.cjs');
const serverNodeModules = path.join(ROOT, 'server', 'node_modules');

// Garante que a pasta de saída exista
fs.mkdirSync(path.dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [entryPoint],
  outfile,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  bundle: true,
  sourcemap: false,
  minify: false,
  // Resolve imports de dentro de server/node_modules
  nodePaths: [serverNodeModules],
  // Apenas módulos que não podem/não devem ser empacotados ficam externos:
  // - bindings nativos (.node) — nunca podem ser bundled
  // - dotenv/config já foi executado pelo entrypoint antes de qualquer require dinâmico,
  //   então deve estar NO bundle junto com todo o resto (express, cors, socket.io, etc.)
  external: [
    // Bindings nativos genéricos (usados por algumas deps como fsevents, canvas, etc.)
    '*.node',
    // O servidor chama `require(NATIVE_PATH)` apenas no desktop/main.js;
    // screen_capture.node nunca é importado pelo server, mas por segurança:
    'screen_capture.node',
  ],
  // Necessário para o TypeScript path-aliases e imports absolutos do server
  absWorkingDir: path.join(ROOT, 'server'),
  // Mantém __dirname/__filename funcionais no CJS bundled
  define: {},
  // Preserva imports dinâmicos de caminhos construídos em runtime (ex.: winston transports)
  logLevel: 'info',
});

if (result.errors.length > 0) {
  console.error('[bundle-server] Erros no build:', result.errors);
  process.exit(1);
}

console.log(`[bundle-server] Bundle gerado: ${outfile}`);
