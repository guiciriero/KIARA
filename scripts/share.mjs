#!/usr/bin/env node
// =============================================================================
// share.mjs — sobe tudo com um único comando e imprime o link público.
//
// Fluxo: checa Node → instala dependências faltantes → build do cliente →
//        Cloudflare Quick Tunnel → servidor → /health → quadro com os links.
//
// Somente módulos nativos do Node (sem dependências). Nada é gravado em disco
// (nem URLs, nem segredos). O servidor escuta apenas em 127.0.0.1:3001.
//
// Opções:
//   --rebuild     força o build do cliente
//   --no-tunnel   não usa o túnel (usa PUBLIC_URL do ambiente ou localhost)
//   --desktop     inicia também o app Electron (áudio por aplicativo)
//   --setup-only  apenas instala dependências e faz o build, depois sai
// =============================================================================

import { spawn, execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readdirSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Constantes ──────────────────────────────────────────────────────────────

const PORT = 3001; // porta fixa (não é lida do ambiente de propósito)
const HOST = '127.0.0.1'; // nunca 0.0.0.0
const LOCAL_URL = `http://localhost:${PORT}`;
const TUNNEL_TIMEOUT_MS = 40_000;
const HEALTH_TIMEOUT_MS = 30_000;
// Só aceita exatamente este padrão de domínio. O subdomínio "api" é excluído
// porque o cloudflared o cita em mensagens de erro (api.trycloudflare.com).
const TUNNEL_URL_RE = /https:\/\/(?!api\.)[a-z0-9-]+\.trycloudflare\.com/;

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = {
  types: path.join(ROOT, 'shared', 'types'),
  server: path.join(ROOT, 'server'),
  client: path.join(ROOT, 'client'),
  desktop: path.join(ROOT, 'desktop'),
};

const args = new Set(process.argv.slice(2));
const OPT = {
  rebuild: args.has('--rebuild'),
  noTunnel: args.has('--no-tunnel'),
  desktop: args.has('--desktop'),
  setupOnly: args.has('--setup-only'),
};
const isWin = process.platform === 'win32';

// ─── Utilidades de log ───────────────────────────────────────────────────────

const log = (msg) => console.log(msg);
const warn = (msg) => console.warn(`Aviso: ${msg}`);

function fail(msg) {
  console.error(`\nErro: ${msg}\n`);
  return shutdown(1);
}

// Imprime a saída de um filho linha a linha, com prefixo. `filter` decide
// se a linha é exibida (usado para silenciar o ruído do cloudflared).
function pipeLines(stream, prefix, onLine, filter = () => true) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() ?? '';
    for (const line of lines) handleLine(line);
  });
  stream.on('end', () => {
    if (buf) handleLine(buf);
  });
  function handleLine(line) {
    if (onLine) onLine(line);
    if (line.trim() && filter(line)) console.log(`[${prefix}] ${line}`);
  }
}

// ─── Gerenciamento de processos filhos ───────────────────────────────────────

const children = new Set(); // { name, proc, essential }
let shuttingDown = false;

function killTree(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null || !proc.pid) return;
  if (isWin) {
    // /T mata a árvore inteira (ts-node-dev cria um processo neto).
    execFile('taskkill', ['/pid', String(proc.pid), '/T', '/F'], () => {});
  } else {
    try {
      // Filhos são iniciados com detached:true → grupo próprio; -pid mata o grupo.
      process.kill(-proc.pid, 'SIGTERM');
    } catch {
      try {
        proc.kill('SIGTERM');
      } catch {
        /* já morreu */
      }
    }
  }
}

function forceKill(proc) {
  if (proc.exitCode !== null || proc.signalCode !== null || !proc.pid) return;
  if (isWin) return killTree(proc);
  try {
    process.kill(-proc.pid, 'SIGKILL');
  } catch {
    try {
      proc.kill('SIGKILL');
    } catch {
      /* já morreu */
    }
  }
}

let shutdownPromise = null;
function shutdown(code = 0) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    const procs = [...children].map((c) => c.proc);
    if (procs.length) log('\nEncerrando processos...');
    procs.forEach(killTree);
    const waitAll = Promise.all(
      procs.map(
        (p) =>
          new Promise((resolve) => {
            if (p.exitCode !== null || p.signalCode !== null) return resolve();
            p.once('exit', resolve);
          }),
      ),
    );
    const timeout = new Promise((resolve) => setTimeout(resolve, 5000));
    await Promise.race([waitAll, timeout]);
    procs.forEach(forceKill);
    process.exit(code);
  })();
  return shutdownPromise;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('SIGHUP', () => shutdown(0));

// Inicia um filho de longa duração (servidor, túnel, Electron).
function startChild(name, command, cmdArgs, { cwd, env, essential = true } = {}) {
  const proc = spawn(command, cmdArgs, {
    cwd,
    env,
    shell: false,
    detached: !isWin, // grupo de processos próprio no Unix (permite matar a árvore)
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const entry = { name, proc, essential };
  children.add(entry);
  proc.on('error', (err) => {
    if (!shuttingDown) fail(`Não foi possível iniciar ${name}: ${err.message}`);
  });
  proc.on('exit', (code, signal) => {
    children.delete(entry);
    if (shuttingDown) return;
    if (essential) {
      fail(`${name} encerrou inesperadamente (${signal ?? `código ${code}`}). Encerrando tudo.`);
    } else {
      warn(`${name} foi fechado. O servidor e o túnel continuam ativos.`);
    }
  });
  return entry;
}

// ─── npm de forma segura (inclusive no Windows) ──────────────────────────────
// DECISÃO: no Windows, spawn('npm.cmd', ..., { shell:false }) falha com EINVAL
// nas versões recentes do Node (correção de segurança CVE-2024-27980). Por isso
// executamos o npm via `process.execPath` + caminho do npm-cli.js, sem shell e
// com argumentos em array, em TODAS as plataformas. Só se o npm-cli.js não for
// encontrado no Windows usamos shell:true com argumentos fixos (hardcoded,
// nenhum input do usuário entra na linha de comando).

function findNpmCli() {
  const candidates = [];
  // Quando rodado via `npm run`, o npm informa o próprio caminho.
  if (process.env.npm_execpath && /npm-cli\.c?js$/.test(process.env.npm_execpath)) {
    candidates.push(process.env.npm_execpath);
  }
  const nodeDir = path.dirname(process.execPath);
  candidates.push(
    path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Windows
    path.join(nodeDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Unix
  );
  return candidates.find((c) => existsSync(c)) ?? null;
}

function runNpm(npmArgs, cwd, env = process.env) {
  const npmCli = findNpmCli();
  let command;
  let cmdArgs;
  let shell = false;
  if (npmCli) {
    command = process.execPath;
    cmdArgs = [npmCli, ...npmArgs];
  } else if (isWin) {
    command = 'npm.cmd'; // fallback: argumentos fixos definidos neste arquivo
    cmdArgs = npmArgs;
    shell = true;
  } else {
    command = 'npm';
    cmdArgs = npmArgs;
  }
  return new Promise((resolve, reject) => {
    const proc = spawn(command, cmdArgs, { cwd, env, shell, stdio: 'inherit', windowsHide: true });
    const entry = { name: 'npm', proc, essential: false };
    children.add(entry);
    proc.on('error', (err) => {
      children.delete(entry);
      reject(err);
    });
    proc.on('exit', (code) => {
      children.delete(entry);
      if (code === 0) resolve();
      else reject(new Error(`npm ${npmArgs.join(' ')} falhou (código ${code}) em ${path.relative(ROOT, cwd) || '.'}`));
    });
  });
}

// ─── Passo 1: Node, dependências ─────────────────────────────────────────────

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 20) {
    throw new Error(`Node.js 20 ou superior é necessário (versão atual: ${process.versions.node}). Baixe em https://nodejs.org`);
  }
}

async function ensureDependencies() {
  // shared/types: dependências + build (server e client dependem do dist)
  const typesNeedsInstall = !existsSync(path.join(DIRS.types, 'node_modules'));
  const typesNeedsBuild = !existsSync(path.join(DIRS.types, 'dist'));
  if (typesNeedsInstall || typesNeedsBuild) {
    log('Preparando os tipos compartilhados...');
    if (typesNeedsInstall) await runNpm(['install'], DIRS.types);
    await runNpm(['run', 'build'], DIRS.types);
  }
  if (!existsSync(path.join(DIRS.server, 'node_modules', 'ts-node-dev'))) {
    log('Instalando as dependências do servidor...');
    await runNpm(['install'], DIRS.server);
  }
  if (!existsSync(path.join(DIRS.client, 'node_modules', 'vite'))) {
    log('Instalando as dependências do cliente...');
    await runNpm(['install'], DIRS.client);
  }
  if (OPT.desktop && !existsSync(path.join(DIRS.desktop, 'node_modules', 'electron'))) {
    log('Instalando as dependências do app desktop...');
    await runNpm(['install'], DIRS.desktop);
  }
}

// ─── Passo 2: build do cliente ───────────────────────────────────────────────

// Maior mtime (ms) de qualquer arquivo dentro de `dir`, recursivamente.
function newestMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const t = entry.isDirectory() ? newestMtime(full) : statSync(full).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}

function clientNeedsBuild() {
  if (OPT.rebuild) return true;
  const indexHtml = path.join(DIRS.client, 'dist', 'index.html');
  if (!existsSync(indexHtml)) return true;
  const distTime = statSync(indexHtml).mtimeMs;
  return newestMtime(path.join(DIRS.client, 'src')) > distTime;
}

async function buildClient() {
  if (!clientNeedsBuild()) {
    log('O site já está compilado e atualizado (use --rebuild para compilar de novo).');
    return;
  }
  log('Compilando o site...');
  // VITE_SERVER_URL não pode existir no build: o cliente deve usar a mesma origem.
  const env = { ...process.env };
  delete env.VITE_SERVER_URL;
  await runNpm(['run', 'build'], DIRS.client, env);
}

// ─── Passo 3 e 4: cloudflared e túnel ────────────────────────────────────────

// Procura o executável manualmente no PATH (considera .exe no Windows).
function findInPath(name) {
  const exts = isWin ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        /* não existe neste diretório */
      }
    }
  }
  return null;
}

function cloudflaredHelp() {
  const lines = [
    'O "cloudflared" (túnel gratuito da Cloudflare, sem conta) não foi encontrado no PATH.',
    '',
    'Instale com:',
  ];
  if (process.platform === 'darwin') lines.push('  brew install cloudflared');
  else if (isWin) lines.push('  winget install --id Cloudflare.cloudflared', '  (depois feche e reabra o terminal)');
  else lines.push('  Siga a documentação oficial para a sua distribuição:', '  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
  lines.push('', 'Depois rode novamente: npm run share', 'Para testar sem túnel (só nesta máquina/rede): npm run share -- --no-tunnel');
  return lines.join('\n');
}

function startTunnel(cloudflaredPath) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const entry = startChild(
      'túnel',
      cloudflaredPath,
      ['tunnel', '--url', `http://${HOST}:${PORT}`, '--no-autoupdate'],
      { env: process.env },
    );
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`O túnel não informou um endereço em ${TUNNEL_TIMEOUT_MS / 1000}s. Verifique sua conexão com a internet e tente novamente.`));
    }, TUNNEL_TIMEOUT_MS);

    const onLine = (line) => {
      if (settled) return;
      const m = line.match(TUNNEL_URL_RE);
      if (m) {
        settled = true;
        clearTimeout(timer);
        resolve(m[0]);
      }
    };
    // Mostra apenas erros do cloudflared (o resto é ruído).
    const onlyErrors = (line) => /\b(ERR|FTL)\b/.test(line);
    pipeLines(entry.proc.stdout, 'túnel', onLine, onlyErrors);
    pipeLines(entry.proc.stderr, 'túnel', onLine, onlyErrors);
    entry.proc.once('exit', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('O cloudflared encerrou antes de criar o túnel.'));
    });
  });
}

// ─── Passo 5: servidor e /health ─────────────────────────────────────────────

function startServer(publicUrl) {
  const env = {
    ...process.env,
    PORT: String(PORT),
    PUBLIC_URL: publicUrl,
    CLIENT_ORIGIN: publicUrl,
    NODE_ENV: 'production',
  };
  const bin = path.join(DIRS.server, 'node_modules', 'ts-node-dev', 'lib', 'bin.js');
  const entry = startChild(
    'servidor',
    process.execPath,
    [bin, '--transpile-only', 'src/index.ts'],
    { cwd: DIRS.server, env },
  );
  pipeLines(entry.proc.stdout, 'servidor');
  pipeLines(entry.proc.stderr, 'servidor');
  return entry;
}

function healthOnce() {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: '/health', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function waitForHealth() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (shuttingDown) return;
    if (await healthOnce()) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`O servidor não respondeu em http://${HOST}:${PORT}/health em ${HEALTH_TIMEOUT_MS / 1000}s.`);
}

// ─── Passo 6: Electron (opcional) ────────────────────────────────────────────

function startDesktop() {
  let electronBin;
  try {
    // Resolve o binário a partir de desktop/ (o pacote "electron" exporta o caminho).
    const req = createRequire(path.join(DIRS.desktop, 'package.json'));
    electronBin = req('electron');
  } catch (err) {
    warn(`Não foi possível localizar o Electron em desktop/node_modules (${err.message}).`);
    return;
  }
  if (!existsSync(path.join(ROOT, 'native', 'build', 'Release', 'screen_capture.node'))) {
    warn('Addon nativo não encontrado (áudio por aplicativo indisponível). Rode: cd desktop && npm run build:native');
  }
  const env = { ...process.env, ELECTRON_START_URL: LOCAL_URL };
  delete env.ELECTRON_RUN_AS_NODE; // senão o Electron roda como Node puro
  const entry = startChild('desktop', electronBin, ['.'], { cwd: DIRS.desktop, env, essential: false });
  entry.proc.stdout.resume();
  pipeLines(entry.proc.stderr, 'desktop', null, (l) => /error|fail/i.test(l));
}

// ─── Quadro final ────────────────────────────────────────────────────────────

function printBanner(publicUrl, tunnelActive) {
  const L = [
    '',
    'KIARA - Compartilhamento de tela e áudio',
    '',
    `(a) Você (host) abre:  ${LOCAL_URL}`,
    '',
    `(b) Link de acesso público para espectadores:`,
    `    ${publicUrl}`,
    '',
    '    Ao iniciar no estúdio, use o botão de copiar o link /view/CÓDIGO',
    '    para enviar a quem for assistir.',
    '',
    tunnelActive
      ? '(c) Túnel seguro ativo. O endereço muda a cada sessão. Fechar\n    este terminal (Ctrl+C) encerra a transmissão.'
      : '(c) Sem túnel externo: funciona em rede local ou via PUBLIC_URL.\n    Ctrl+C encerra o servidor.',
    '',
    '(d) Dica: para capturar áudio por aplicativo individual, use:\n    npm run share:desktop',
    '',
  ];
  const width = Math.max(...L.flatMap((l) => l.split('\n')).map((l) => [...l].length)) + 2;
  const bar = '═'.repeat(width + 2);
  const out = [`╔${bar}╗`];
  for (const block of L) {
    for (const line of block.split('\n')) {
      out.push(`║ ${line}${' '.repeat(Math.max(0, width - [...line].length))} ║`);
    }
  }
  out.push(`╚${bar}╝`);
  log('\n' + out.join('\n'));
}

// ─── Principal ───────────────────────────────────────────────────────────────

async function main() {
  checkNode();
  await ensureDependencies();
  await buildClient();

  if (OPT.setupOnly) {
    log('\nTudo pronto. Para começar, rode: npm run share');
    return shutdown(0);
  }

  let publicUrl;
  let tunnelActive = !OPT.noTunnel;
  if (OPT.noTunnel) {
    publicUrl = process.env.PUBLIC_URL || LOCAL_URL;
    if (!/^https?:\/\//.test(publicUrl)) {
      throw new Error('PUBLIC_URL deve começar com http:// ou https://');
    }
    if (!process.env.PUBLIC_URL) {
      warn(`Sem túnel e sem PUBLIC_URL: usando ${LOCAL_URL} — só funciona nesta própria máquina/rede.`);
    }
  } else {
    const cloudflared = findInPath('cloudflared');
    if (!cloudflared) {
      console.error('\n' + cloudflaredHelp() + '\n');
      return shutdown(1);
    }
    log('Abrindo o túnel da Cloudflare (pode levar alguns segundos)...');
    publicUrl = await startTunnel(cloudflared);
    log('Túnel criado.');
  }

  log('Iniciando o servidor...');
  startServer(publicUrl);
  await waitForHealth();
  if (shuttingDown) return;

  if (OPT.desktop) startDesktop();
  printBanner(publicUrl, tunnelActive);
}

main().catch((err) => fail(err.message));
