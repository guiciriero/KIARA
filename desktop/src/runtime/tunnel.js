'use strict';

/**
 * runtime/tunnel.js — inicia o cloudflared e extrai a URL pública.
 *
 * Totalmente independente do Electron: recebe o caminho do binário
 * como parâmetro, facilitando testes fora do app.
 *
 * Exporta: startTunnel(port, cloudflaredBin) → Promise<{ url, stop }>
 *
 * Eventos emitidos no EventEmitter retornado:
 *   'unexpected-exit' — quando o cloudflared morre após o túnel estar ativo.
 */

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const { checkBinaryIntegrity } = require('./integrity');

const TUNNEL_URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;
const TUNNEL_TIMEOUT_MS = 40_000;

/**
 * Localiza o cloudflared no PATH (dev/Mac) ou no resourcesPath do Electron
 * (Windows empacotado).
 *
 * @param {string} [resourcesPath]  process.resourcesPath quando disponível.
 * @returns {string|null}
 */
function findCloudflared(resourcesPath) {
  // Empacotado Windows: <resourcesPath>/bin/cloudflared.exe
  if (resourcesPath) {
    const exe = path.join(resourcesPath, 'bin', 'cloudflared.exe');
    try {
      require('fs').accessSync(exe, require('fs').constants.X_OK);
      return exe;
    } catch { /* não existe */ }
  }

  // Dev/Mac: procura no PATH
  const exeName = process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared';
  const { execFileSync } = require('child_process');
  try {
    const which = process.platform === 'win32' ? 'where' : 'which';
    const result = execFileSync(which, [exeName], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const found = result.trim().split('\n')[0].trim();
    if (found) return found;
  } catch { /* não encontrado */ }

  return null;
}

/**
 * Verifica o SHA-256 do cloudflared ANTES do spawn.
 * Divergência ⇒ lança erro (o binário não é executado). Sem hash esperado
 * (dev/sem metadado) ⇒ apenas avisa e segue com o comportamento atual.
 *
 * @param {string} cloudflaredBin
 * @param {string|null|undefined} expectedSha256
 */
async function verifyCloudflared(cloudflaredBin, expectedSha256) {
  const r = await checkBinaryIntegrity(cloudflaredBin, expectedSha256);
  if (r.status === 'mismatch') throw new Error(r.message);
  if (r.status === 'skipped') console.warn(`[runtime/tunnel] ${r.message}`);
}

/**
 * Inicia o cloudflared apontando para http://127.0.0.1:PORT.
 *
 * @param {number} port            Porta do servidor local.
 * @param {string} cloudflaredBin  Caminho absoluto para o binário cloudflared.
 * @param {{ expectedSha256?: string|null }} [opts]  SHA-256 esperado (build-info.json).
 * @returns {Promise<{ url: string, stop: () => void, events: EventEmitter }>}
 */
async function startTunnel(port, cloudflaredBin, opts = {}) {
  await verifyCloudflared(cloudflaredBin, opts.expectedSha256);
  return spawnTunnel(port, cloudflaredBin);
}

function spawnTunnel(port, cloudflaredBin) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const events = new EventEmitter();

    const proc = spawn(
      cloudflaredBin,
      ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        detached: false,
      }
    );

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill();
      reject(new Error(
        `Túnel não respondeu em ${TUNNEL_TIMEOUT_MS / 1000}s. ` +
        'Verifique a conexão com a internet.'
      ));
    }, TUNNEL_TIMEOUT_MS);

    /** Procura a URL do trycloudflare em uma linha de texto. */
    function parseLine(line) {
      if (settled) return;
      const m = line.match(TUNNEL_URL_RE);
      if (m) {
        settled = true;
        clearTimeout(timer);

        const url = m[0];

        function stop() {
          try {
            if (process.platform === 'win32') {
              // No Windows, taskkill garante que filhos do cloudflared também morram
              const { execFile } = require('child_process');
              execFile('taskkill', ['/T', '/F', '/PID', String(proc.pid)], () => {});
            } else {
              proc.kill('SIGTERM');
            }
          } catch { /* processo já morreu */ }
        }

        // Após resolver, monitora saída inesperada
        proc.once('exit', (code, signal) => {
          events.emit('unexpected-exit', { code, signal });
        });

        resolve({ url, stop, events });
      }
    }

    function pipeLines(stream) {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          parseLine(buf.slice(0, nl));
          buf = buf.slice(nl + 1);
        }
      });
      stream.on('end', () => {
        if (buf.length > 0) parseLine(buf);
      });
    }

    pipeLines(proc.stdout);
    pipeLines(proc.stderr);

    proc.once('exit', (code, signal) => {
      if (settled) return; // já resolvido: handled acima
      settled = true;
      clearTimeout(timer);
      reject(new Error(
        `cloudflared encerrou antes de criar o túnel (code=${code}, signal=${signal}).`
      ));
    });

    proc.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Falha ao iniciar cloudflared: ${err.message}`));
    });
  });
}

module.exports = { startTunnel, findCloudflared };
