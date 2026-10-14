'use strict';

/**
 * Hook afterPack do electron-builder: vira os Electron Fuses do executável empacotado.
 *
 * Roda ANTES da assinatura (o electron-builder assina depois do afterPack) e só no
 * executável da plataforma do build (win32 → KIARA.exe, darwin → KIARA.app, linux → binário).
 *
 * Decisões (fuses documentados em https://www.electronjs.org/docs/latest/tutorial/fuses):
 *
 *  - RunAsNode = false
 *      O servidor embutido sobe via `utilityProcess.fork` (src/runtime/server.js), que NÃO
 *      depende de ELECTRON_RUN_AS_NODE. O bundle do servidor (server.cjs) não usa
 *      child_process.fork e o main.js não faz fork do próprio executável. O `child_process.fork`
 *      com ELECTRON_RUN_AS_NODE em server.js só roda fora do Electron (testes/dev), nunca no
 *      app empacotado. Desligar elimina o abuso do KIARA.exe como interpretador Node.
 *  - EnableCookieEncryption = true
 *      Cookies do Chromium cifrados com chave do SO (transição sem volta; sem custo para o app).
 *  - EnableNodeOptionsEnvironmentVariable = false
 *      Ignora NODE_OPTIONS / NODE_EXTRA_CA_CERTS do ambiente do usuário.
 *  - EnableNodeCliInspectArguments = false
 *      Ignora --inspect / --inspect-brk e SIGUSR1 (sem depurador remoto no app distribuído).
 *  - EnableEmbeddedAsarIntegrityValidation = true
 *      Valida o cabeçalho do app.asar na carga (Windows: Electron >= 30). O electron-builder 26
 *      calcula o hash e grava o recurso ELECTRONASAR no .exe quando `asar: true` (beforeCopyExtraFiles),
 *      antes deste hook. Se o hash faltar, o app encerra: validar num pacote Windows real.
 *  - OnlyLoadAppFromAsar = true
 *      Só carrega o código de app.asar (sem pasta `app/` solta que burlaria a integridade).
 *      O app é empacotado em asar (`asar: true`); extraResources (server.cjs, client, .node,
 *      cloudflared.exe) ficam fora do asar como arquivos normais e não são "código do app".
 *  - GrantFileProtocolExtraPrivileges = false
 *      O app carrega http://127.0.0.1:<porta> (e protocolo próprio), não file://.
 *      (Se algum dia a UI voltar a usar file://, reverter.)
 */

const fs = require('fs');
const path = require('path');

/** Extensão do executável por plataforma do electron-builder. */
const EXT = { win32: '.exe', darwin: '.app', mas: '.app', linux: '' };

/**
 * Caminho do executável Electron dentro de appOutDir.
 * @param {string} appOutDir
 * @param {string} platform  'win32' | 'darwin' | 'mas' | 'linux'
 * @param {string} baseName  productFilename (ex.: KIARA)
 */
function resolveExecutable(appOutDir, platform, baseName) {
  if (!(platform in EXT)) throw new Error(`Plataforma não suportada pelo hook de fuses: ${platform}`);
  return path.join(appOutDir, `${baseName}${EXT[platform]}`);
}

module.exports = async function applyFuses(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  const baseName = packager.appInfo.productFilename; // "KIARA"
  const exe = resolveExecutable(appOutDir, electronPlatformName, baseName);

  if (!fs.existsSync(exe)) {
    throw new Error(`[fuses] Executável não encontrado: ${exe}`);
  }

  // @electron/fuses é ESM puro: import dinâmico a partir de CommonJS.
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses');

  await flipFuses(exe, {
    version: FuseVersion.V1,
    // No macOS arm64 o binário já vem com assinatura ad-hoc; precisa ser refeita após a edição.
    resetAdHocDarwinSignature: electronPlatformName === 'darwin' || electronPlatformName === 'mas',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });

  console.log(`[fuses] Fuses aplicados em ${exe}`);
};

module.exports.resolveExecutable = resolveExecutable;
