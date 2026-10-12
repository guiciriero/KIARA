import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const L = require('./updateLogic.js');

const rel = (tag: string, extra: object = {}) => ({ tag_name: tag, html_url: `u/${tag}`, ...extra });

describe('compareVersions', () => {
  it('compara numericamente (1.0.9 < 1.0.10)', () => {
    expect(L.compareVersions('1.0.9', '1.0.10')).toBe(-1);
    expect(L.compareVersions('1.2.0', '1.1.9')).toBe(1);
    expect(L.compareVersions('2.0.0', '2.0.0')).toBe(0);
  });
  it('aceita prefixo v', () => {
    expect(L.compareVersions('v1.0.1', '1.0.0')).toBe(1);
  });
  it('prerelease é menor que a versão final', () => {
    expect(L.compareVersions('1.0.0-rc.1', '1.0.0')).toBe(-1);
    expect(L.compareVersions('1.0.0-rc.2', '1.0.0-rc.10')).toBe(-1);
    expect(L.compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBe(-1);
  });
  it('lança em versão inválida', () => {
    expect(() => L.compareVersions('abc', '1.0.0')).toThrow();
  });
});

describe('findUpdate / pickLatestRelease', () => {
  const list = [rel('v1.0.9'), rel('v1.0.10'), rel('v1.0.2')];
  it('escolhe a mais recente quando há atualização', () => {
    expect(L.findUpdate(list, '1.0.5')).toMatchObject({ version: '1.0.10', tag: 'v1.0.10' });
  });
  it('retorna null sem atualização', () => {
    expect(L.findUpdate(list, '1.0.10')).toBeNull();
    expect(L.findUpdate([], '1.0.0')).toBeNull();
    expect(L.findUpdate(null, '1.0.0')).toBeNull();
  });
  it('ignora draft, prerelease e tags inválidas', () => {
    const items = [rel('v2.0.0', { draft: true }), rel('v1.5.0', { prerelease: true }), rel('nightly'), rel('v1.1.0')];
    expect(L.pickLatestRelease(items).version).toBe('1.1.0');
  });
});

describe('classifyError', () => {
  it.each([
    [{ statusCode: 404 }, 'not-found'],
    [{ statusCode: 401 }, 'not-found'],
    [{ statusCode: 403 }, 'rate-limit'],
    [{ statusCode: 429 }, 'rate-limit'],
    [{ statusCode: 503 }, 'server'],
    [{ code: 'ENOTFOUND' }, 'offline'],
    [{ message: 'net::ERR_INTERNET_DISCONNECTED' }, 'offline'],
    [{ code: 'ETIMEDOUT' }, 'timeout'],
    [{ message: 'request timed out' }, 'timeout'],
    [{ message: 'Cannot find latest.yml in the latest release artifacts' }, 'not-found'],
    [{ message: 'sha512 checksum mismatch' }, 'checksum'],
    [{ message: 'algo estranho' }, 'unknown'],
  ])('%j -> %s', (err, kind) => {
    expect(L.classifyError(err).kind).toBe(kind);
  });
  it('mensagem de feed privado em pt-BR', () => {
    expect(L.classifyError({ statusCode: 404 }).message).toContain('privado ou ainda não há versão publicada');
  });
  it('erro de instalação', () => {
    expect(L.classifyError(new Error('x'), 'install').kind).toBe('install');
  });
  it('extrai status do texto HttpError', () => {
    expect(L.classifyError({ message: 'HttpError: 404 Not Found' }).kind).toBe('not-found');
  });
});

describe('reduceUpdate', () => {
  const idle = L.initialState('1.0.0', 'abc1234');
  const run = (events: object[]) => events.reduce((s: object, e: object) => L.reduceUpdate(s, e), idle);

  it('fluxo completo válido', () => {
    const s = run([
      { type: 'check-start' }, { type: 'found', version: '1.0.1' }, { type: 'download-start' },
      { type: 'progress', percent: 42.4 }, { type: 'downloaded' },
    ]);
    expect(s).toMatchObject({ status: 'downloaded', latestVersion: '1.0.1', progress: 100, build: 'abc1234' });
  });
  it('sem atualização', () => {
    expect(run([{ type: 'check-start' }, { type: 'none' }])).toMatchObject({ status: 'not-available' });
  });
  it('progresso arredondado e limitado a 0-100', () => {
    const base = run([{ type: 'check-start' }, { type: 'found', version: '1.0.1' }, { type: 'download-start' }]);
    expect(L.reduceUpdate(base, { type: 'progress', percent: 42.6 }).progress).toBe(43);
    expect(L.reduceUpdate(base, { type: 'progress', percent: 250 }).progress).toBe(100);
  });
  it('transições inválidas devolvem o mesmo estado', () => {
    expect(L.reduceUpdate(idle, { type: 'download-start' })).toBe(idle);
    expect(L.reduceUpdate(idle, { type: 'downloaded' })).toBe(idle);
    expect(L.reduceUpdate(idle, { type: 'found', version: '2.0.0' })).toBe(idle);
    expect(L.reduceUpdate(idle, { type: 'fail', message: 'x' })).toBe(idle);
    expect(L.reduceUpdate(idle, { type: 'qualquer' })).toBe(idle);
  });
  it('não verifica de novo enquanto baixa; disabled é inerte', () => {
    const dl = run([{ type: 'check-start' }, { type: 'found', version: '1.0.1' }, { type: 'download-start' }]);
    expect(L.reduceUpdate(dl, { type: 'check-start' })).toBe(dl);
    const off = L.disabledState('1.0.0', 'dev');
    expect(L.reduceUpdate(off, { type: 'check-start' })).toBe(off);
  });
  it('erro permite tentar de novo', () => {
    const err = run([{ type: 'check-start' }, { type: 'fail', message: 'sem rede' }]);
    expect(err).toMatchObject({ status: 'error', message: 'sem rede' });
    expect(L.reduceUpdate(err, { type: 'check-start' }).status).toBe('checking');
  });
});
