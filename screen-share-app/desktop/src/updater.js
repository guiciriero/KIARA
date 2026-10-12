'use strict';

/**
 * Atualização do app (processo principal). Encapsula o electron-updater e expõe estados
 * normalizados (ver updateLogic.js). Nada aqui usa token ou segredo: o feed é público
 * (GitHub Releases de repositório público) ou uma URL https "generic" (KIARA_UPDATE_URL).
 */

const fs = require('fs');
const path = require('path');
const {
  classifyError, initialState, disabledState, reduceUpdate,
} = require('./updateLogic');

const MSG_DEV = 'Atualizações ficam desativadas no modo de desenvolvimento.';
const MSG_PLATFORM = 'Atualizações automáticas só estão disponíveis no Windows.';
const MSG_NO_UPDATE = 'Nenhuma atualização disponível para baixar.';
const MSG_NOT_READY = 'A atualização ainda não foi baixada.';

/** Lê build-info.json (gerado no build) com fallback seguro em dev / arquivo ausente. */
function readBuildInfo(app) {
  const fallback = { version: app.getVersion(), commit: 'dev' };
  if (!app.isPackaged) return fallback;
  try {
    const raw = fs.readFileSync(path.join(process.resourcesPath, 'build-info.json'), 'utf8');
    const info = JSON.parse(raw);
    return {
      version: app.getVersion(),
      commit: typeof info.commit === 'string' ? info.commit : fallback.commit,
      updateUrl: typeof info.updateUrl === 'string' ? info.updateUrl : undefined,
    };
  } catch {
    return fallback;
  }
}

/** Só aceita feed https (evita downgrade para http e esquemas estranhos). */
function parseFeedUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * @param {object} deps
 * @param {import('electron').App} deps.app
 * @param {boolean} deps.isDev
 * @param {(state: object) => void} deps.onState        chamado a cada mudança de estado
 * @param {() => void} deps.beforeInstall               limpeza (túnel/servidor/áudio) antes de reiniciar
 * @param {() => object} [deps.loadAutoUpdater]         injetável em testes
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {string} [deps.platform]
 */
function createUpdater({
  app, isDev, onState, beforeInstall,
  loadAutoUpdater = () => require('electron-updater').autoUpdater,
  env = process.env,
  platform = process.platform,
}) {
  const info = readBuildInfo(app);
  let au = null;
  let state;

  if (isDev || !app.isPackaged) {
    state = disabledState(info.version, MSG_DEV);
  } else if (platform !== 'win32') {
    state = disabledState(info.version, MSG_PLATFORM);
  } else {
    state = initialState(info.version, info.commit);
  }

  function dispatch(event) {
    const next = reduceUpdate(state, event);
    if (next === state) return false;
    state = next;
    try { onState(state); } catch { /* janela já fechada */ }
    return true;
  }

  function fail(err, stage) {
    dispatch({ type: 'fail', message: classifyError(err, stage).message });
  }

  function ensure() {
    if (au) return au;
    au = loadAutoUpdater();
    au.autoDownload = false;
    au.autoInstallOnAppQuit = true;
    au.allowPrerelease = false;
    au.allowDowngrade = false;
    au.logger = null;

    // Sem URL, o electron-updater usa o app-update.yml gerado pelo electron-builder (github).
    const feed = parseFeedUrl(env.KIARA_UPDATE_URL) || parseFeedUrl(info.updateUrl);
    if (feed) au.setFeedURL({ provider: 'generic', url: feed });

    au.on('update-available', (i) => dispatch({ type: 'found', version: i && i.version }));
    au.on('update-not-available', () => dispatch({ type: 'none' }));
    au.on('download-progress', (p) => dispatch({ type: 'progress', percent: p && p.percent }));
    au.on('update-downloaded', () => dispatch({ type: 'downloaded' }));
    au.on('error', (err) => fail(err, state.status === 'downloading' ? 'download' : 'check'));
    return au;
  }

  async function check() {
    if (!dispatch({ type: 'check-start' })) return state;
    try {
      await ensure().checkForUpdates();
    } catch (err) {
      fail(err, 'check');
    }
    return state;
  }

  async function download() {
    if (!dispatch({ type: 'download-start' })) throw new Error(MSG_NO_UPDATE);
    try {
      await ensure().downloadUpdate();
    } catch (err) {
      fail(err, 'download');
    }
    return state;
  }

  function install() {
    if (state.status !== 'downloaded') throw new Error(MSG_NOT_READY);
    try {
      // Limpa antes: o instalador precisa do app fechado, sem cloudflared/servidor órfãos.
      beforeInstall();
      ensure().quitAndInstall(true, true);
    } catch (err) {
      fail(err, 'install');
    }
    return state;
  }

  return { getState: () => state, check, download, install };
}

module.exports = { createUpdater, readBuildInfo, parseFeedUrl };
