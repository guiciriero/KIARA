'use strict';

/**
 * Lógica PURA da atualização do app (sem Electron, sem rede, sem DOM).
 * Fica em módulo próprio para ser testada com Vitest (client/src/services/updateLogic.test.ts)
 * e usada por updater.js.
 */

// ─── Versões (semver) ────────────────────────────────────────────────────────

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Aceita prefixo "v"; devolve null se não for semver válido. */
function parseVersion(input) {
  if (typeof input !== 'string') return null;
  const m = SEMVER_RE.exec(input.trim().replace(/^v/i, ''));
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: m[4] ? m[4].split('.') : [],
  };
}

function comparePreId(a, b) {
  const an = /^\d+$/.test(a);
  const bn = /^\d+$/.test(b);
  if (an && bn) return Math.sign(Number(a) - Number(b));
  if (an) return -1; // identificador numérico tem precedência menor
  if (bn) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** -1 | 0 | 1. Lança erro se alguma versão for inválida. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa) throw new Error(`Versão inválida: ${String(a)}`);
  if (!pb) throw new Error(`Versão inválida: ${String(b)}`);
  for (let i = 0; i < 3; i += 1) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1;
  }
  // Sem prerelease > com prerelease (1.0.0 > 1.0.0-rc.1)
  if (!pa.pre.length || !pb.pre.length) {
    return pa.pre.length === pb.pre.length ? 0 : pa.pre.length ? -1 : 1;
  }
  const len = Math.max(pa.pre.length, pb.pre.length);
  for (let i = 0; i < len; i += 1) {
    if (pa.pre[i] === undefined) return -1;
    if (pb.pre[i] === undefined) return 1;
    const c = comparePreId(pa.pre[i], pb.pre[i]);
    if (c !== 0) return c;
  }
  return 0;
}

// ─── Releases do GitHub (verificação própria / fallback) ─────────────────────

/**
 * Escolhe a release estável mais recente de uma resposta de `GET /repos/:o/:r/releases`.
 * Ignora draft, prerelease e tags que não sejam semver.
 * @returns {{ version: string, tag: string, url: string } | null}
 */
function pickLatestRelease(releases) {
  if (!Array.isArray(releases)) return null;
  let best = null;
  for (const r of releases) {
    if (!r || r.draft || r.prerelease) continue;
    const parsed = parseVersion(r.tag_name);
    if (!parsed) continue;
    const version = String(r.tag_name).trim().replace(/^v/i, '');
    if (!best || compareVersions(version, best.version) > 0) {
      best = { version, tag: r.tag_name, url: typeof r.html_url === 'string' ? r.html_url : '' };
    }
  }
  return best;
}

/** Release mais recente apenas se for estritamente mais nova que a instalada. */
function findUpdate(releases, currentVersion) {
  const latest = pickLatestRelease(releases);
  return latest && compareVersions(latest.version, currentVersion) > 0 ? latest : null;
}

// ─── Classificação de erros → mensagens pt-BR ────────────────────────────────

const MSG = {
  offline: 'Sem conexão com a internet. Verifique sua rede e tente novamente.',
  timeout: 'O servidor de atualizações demorou demais para responder. Tente novamente.',
  rateLimit: 'Muitas verificações em pouco tempo (limite de requisições do GitHub). Tente novamente mais tarde.',
  notFound:
    'Não foi possível acessar as atualizações. O repositório de releases é privado ou ainda não há versão publicada.',
  checksum: 'O arquivo baixado está corrompido. Tente baixar novamente.',
  install: 'Não foi possível instalar a atualização. Feche o app e tente novamente.',
  check: 'Não foi possível verificar atualizações. Tente novamente.',
  download: 'Não foi possível baixar a atualização. Tente novamente.',
};

const OFFLINE_CODES = new Set([
  'ENOTFOUND', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN',
]);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED']);
const OFFLINE_TEXT_RE =
  /net::ERR_(?:INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|NETWORK_CHANGED|CONNECTION_(?:REFUSED|RESET|CLOSED)|ADDRESS_UNREACHABLE)|getaddrinfo|network is unreachable/i;
const TIMEOUT_RE = /timed?[\s_-]?out/i;
const NOT_FOUND_TEXT_RE = /cannot find (?:channel )?["']?latest\.yml|unable to find latest version/i;

function httpStatusOf(err, text) {
  const direct = err && (err.statusCode !== undefined ? err.statusCode : err.status);
  if (Number.isInteger(direct)) return direct;
  const m = /(?:HttpError|status(?:\s*code)?)\D{0,3}(\d{3})/i.exec(text);
  return m ? Number(m[1]) : null;
}

/**
 * Converte um erro técnico em { kind, message } legível.
 * @param {unknown} err
 * @param {'check'|'download'|'install'} [stage]
 */
function classifyError(err, stage = 'check') {
  if (stage === 'install') return { kind: 'install', message: MSG.install };

  const text = String((err && err.message) || err || '');
  const code = err && typeof err.code === 'string' ? err.code : '';
  const status = httpStatusOf(err, text);

  if (status === 401 || status === 404) return { kind: 'not-found', message: MSG.notFound };
  if (status === 403 || status === 429) return { kind: 'rate-limit', message: MSG.rateLimit };
  if (status !== null && status >= 500) {
    return { kind: 'server', message: `O servidor de atualizações está indisponível (HTTP ${status}). Tente mais tarde.` };
  }
  if (TIMEOUT_CODES.has(code) || TIMEOUT_RE.test(text)) return { kind: 'timeout', message: MSG.timeout };
  if (OFFLINE_CODES.has(code) || OFFLINE_TEXT_RE.test(text)) return { kind: 'offline', message: MSG.offline };
  if (NOT_FOUND_TEXT_RE.test(text)) return { kind: 'not-found', message: MSG.notFound };
  if (/sha512|checksum/i.test(text)) return { kind: 'checksum', message: MSG.checksum };
  return { kind: 'unknown', message: stage === 'download' ? MSG.download : MSG.check };
}

// ─── Estado ──────────────────────────────────────────────────────────────────

/** Estado inicial; `build` é o SHA curto do commit (opcional). */
function initialState(currentVersion, build) {
  return build ? { status: 'idle', currentVersion, build } : { status: 'idle', currentVersion };
}

function disabledState(currentVersion, message) {
  return { status: 'disabled', currentVersion, message };
}

function clampPercent(p) {
  const n = Number(p);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : 0;
}

/**
 * Reducer: devolve o MESMO objeto (referência) quando a transição é inválida.
 * Eventos: check-start | found {version} | none | download-start | progress {percent}
 *          | downloaded | fail {message} | reset (erro → idle, usado em verificações automáticas)
 */
function reduceUpdate(state, event) {
  const base = { currentVersion: state.currentVersion };
  if (state.build) base.build = state.build;

  switch (event.type) {
    case 'check-start':
      return ['idle', 'not-available', 'available', 'error'].includes(state.status)
        ? { ...base, status: 'checking' }
        : state;
    case 'found':
      return state.status === 'checking'
        ? { ...base, status: 'available', latestVersion: event.version }
        : state;
    case 'none':
      return state.status === 'checking' ? { ...base, status: 'not-available' } : state;
    case 'download-start':
      return state.status === 'available'
        ? { ...base, status: 'downloading', latestVersion: state.latestVersion, progress: 0 }
        : state;
    case 'progress':
      return state.status === 'downloading'
        ? { ...state, progress: clampPercent(event.percent) }
        : state;
    case 'downloaded':
      return state.status === 'downloading'
        ? { ...base, status: 'downloaded', latestVersion: state.latestVersion, progress: 100 }
        : state;
    case 'reset':
      return state.status === 'checking' ? { ...base, status: 'idle' } : state;
    case 'fail':
      return ['checking', 'downloading', 'downloaded'].includes(state.status)
        ? { ...base, status: 'error', latestVersion: state.latestVersion, message: event.message }
        : state;
    default:
      return state;
  }
}

// ─── URL do feed de atualização ──────────────────────────────────────────────

/** Só aceita feed https, sem credenciais embutidas na URL. */
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
 * Decide qual feed usar.
 *  - App empacotado: IGNORA KIARA_UPDATE_URL do ambiente do usuário (um atacante local
 *    poderia redirecionar as atualizações); vale só a URL embutida no build (build-info.json).
 *  - Dev: aceita KIARA_UPDATE_URL (somente https) e, na falta dela, a URL do build-info.
 * @returns {string|null} null ⇒ usar o feed padrão do app-update.yml (GitHub Releases).
 */
function resolveFeedUrl({ isPackaged, envUrl, buildInfoUrl }) {
  const embedded = parseFeedUrl(buildInfoUrl);
  if (isPackaged) return embedded;
  return parseFeedUrl(envUrl) || embedded;
}

module.exports = {
  parseFeedUrl,
  resolveFeedUrl,
  parseVersion,
  compareVersions,
  pickLatestRelease,
  findUpdate,
  classifyError,
  initialState,
  disabledState,
  reduceUpdate,
};
