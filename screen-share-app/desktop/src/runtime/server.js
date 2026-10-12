'use strict';

/**
 * runtime/server.js — inicia o servidor embutido (server.cjs) como processo filho.
 *
 * Fluxo:
 *   1. Descobre uma porta livre em 127.0.0.1.
 *   2. Retorna a porta para que o caller possa iniciar o túnel (que precisa da porta).
 *   3. startServer(port, { publicUrl, clientDistDir, logDir }) inicia o processo
 *      e aguarda /health (até 30 s).
 *
 * Para facilitar testes sem o Electron, a criação do processo filho usa duas
 * estratégias:
 *   - Dentro do Electron (utilityProcess disponível): utilityProcess.fork
 *   - Fora do Electron (testes, dev): child_process.fork com ELECTRON_RUN_AS_NODE=1
 *
 * O módulo recebe `utilityProcessModule` como parâmetro de injeção para que o
 * caller (main.js) passe `require('electron').utilityProcess` sem que este módulo
 * dependa diretamente de 'electron'.
 */

const http = require('http');
const net = require('net');
const path = require('path');

const HEALTH_TIMEOUT_MS = 30_000;
const HEALTH_POLL_MS = 500;

/**
 * Encontra uma porta TCP livre em 127.0.0.1.
 * @returns {Promise<number>}
 */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    srv.on('error', reject);
  });
}

/**
 * Retorna o caminho do bundle server.cjs.
 *   - Empacotado: <resourcesPath>/server/server.cjs
 *   - Dev: <repositório>/desktop/build/server/server.cjs
 *
 * @param {boolean} isPackaged
 * @param {string}  [resourcesPath]
 * @returns {string}
 */
function resolveServerBundle(isPackaged, resourcesPath) {
  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, 'server', 'server.cjs');
  }
  // Dev: bundle gerado em desktop/build/server/server.cjs
  // __dirname == desktop/src/runtime → ../../build/server
  return path.resolve(__dirname, '..', '..', 'build', 'server', 'server.cjs');
}

/**
 * Caminho do client/dist.
 *   - Empacotado: <resourcesPath>/client
 *   - Dev: <repositório>/client/dist
 *
 * @param {boolean} isPackaged
 * @param {string}  [resourcesPath]
 * @returns {string}
 */
function resolveClientDist(isPackaged, resourcesPath) {
  if (isPackaged && resourcesPath) {
    return path.join(resourcesPath, 'client');
  }
  return path.resolve(__dirname, '..', '..', '..', 'client', 'dist');
}

/**
 * Constrói o env mínimo para o servidor, sem herdar variáveis desnecessárias do
 * ambiente do usuário.
 */
function buildServerEnv({ port, publicUrl, clientDistDir, logDir }) {
  // Variáveis essenciais do sistema operacional
  const base = {};
  if (process.env.PATH) base.PATH = process.env.PATH;
  if (process.platform === 'win32') {
    if (process.env.SystemRoot) base.SystemRoot = process.env.SystemRoot;
    if (process.env.TEMP) base.TEMP = process.env.TEMP;
    if (process.env.TMP) base.TMP = process.env.TMP;
  }
  // HOME e TMPDIR no Unix (winston pode precisar)
  if (process.env.HOME) base.HOME = process.env.HOME;
  if (process.env.TMPDIR) base.TMPDIR = process.env.TMPDIR;

  return {
    ...base,
    NODE_ENV: 'production',
    PORT: String(port),
    CLIENT_DIST_DIR: clientDistDir,
    LOG_DIR: logDir,
    ...(publicUrl ? { PUBLIC_URL: publicUrl, CLIENT_ORIGIN: publicUrl } : {}),
  };
}

/**
 * Aguarda /health responder 200 OK (poll a cada HEALTH_POLL_MS até HEALTH_TIMEOUT_MS).
 * @param {number} port
 * @returns {Promise<void>}
 */
function waitForHealth(port) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + HEALTH_TIMEOUT_MS;

    function attempt() {
      if (Date.now() > deadline) {
        return reject(new Error(
          `Servidor não respondeu em http://127.0.0.1:${port}/health em ` +
          `${HEALTH_TIMEOUT_MS / 1000}s.`
        ));
      }
      const req = http.get(
        { host: '127.0.0.1', port, path: '/health', timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else setTimeout(attempt, HEALTH_POLL_MS);
        }
      );
      req.on('timeout', () => { req.destroy(); setTimeout(attempt, HEALTH_POLL_MS); });
      req.on('error', () => setTimeout(attempt, HEALTH_POLL_MS));
    }
    attempt();
  });
}

/**
 * Inicia o servidor embutido.
 *
 * @param {object} opts
 * @param {number}       opts.port
 * @param {string|null}  opts.publicUrl
 * @param {string}       opts.clientDistDir
 * @param {string}       opts.logDir
 * @param {boolean}      opts.isPackaged
 * @param {string}       [opts.resourcesPath]
 * @param {object}       [opts.utilityProcess]  require('electron').utilityProcess (injeção)
 * @returns {Promise<{ stop: () => void }>}
 */
async function startServer(opts) {
  const {
    port,
    publicUrl,
    clientDistDir,
    logDir,
    isPackaged,
    resourcesPath,
    utilityProcess: utilProc,
  } = opts;

  const bundlePath = resolveServerBundle(isPackaged, resourcesPath);
  const env = buildServerEnv({ port, publicUrl, clientDistDir, logDir });

  let child;

  if (utilProc) {
    // ── Dentro do Electron: usa utilityProcess.fork ───────────────────────────
    child = utilProc.fork(bundlePath, [], {
      stdio: 'pipe',
      env,
      serviceName: 'screen-share-server',
    });

    // Encaminha logs para o console do processo principal
    child.stdout && child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
    child.stderr && child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  } else {
    // ── Fora do Electron (testes): child_process.fork com ELECTRON_RUN_AS_NODE ──
    const { fork } = require('child_process');
    child = fork(bundlePath, [], {
      stdio: 'pipe',
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      execPath: process.execPath,
    });
    child.stdout && child.stdout.on('data', (d) => process.stdout.write(`[server] ${d}`));
    child.stderr && child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  }

  child.on('exit', (code, signal) => {
    console.warn(`[runtime/server] processo do servidor saiu (code=${code}, signal=${signal})`);
  });

  await waitForHealth(port);

  function stop() {
    try {
      if (typeof child.kill === 'function') {
        child.kill();
      }
    } catch { /* já morto */ }
  }

  return { stop };
}

module.exports = { findFreePort, startServer, resolveClientDist };
