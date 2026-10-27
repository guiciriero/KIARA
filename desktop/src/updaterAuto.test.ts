import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createUpdater } = require('./updater.js');

type Handler = (arg?: unknown) => void;

/** autoUpdater falso: guarda os handlers e deixa cada teste decidir o que acontece. */
function setup(opts: {
  packaged?: boolean;
  check?: () => Promise<void> | void;
  beforeInstall?: () => void;
} = {}) {
  const handlers: Record<string, Handler> = {};
  const emit = (name: string, arg?: unknown) => handlers[name]?.(arg);
  const au = {
    on: vi.fn((name: string, fn: Handler) => { handlers[name] = fn; }),
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(async () => {
      if (opts.check) return opts.check();
      emit('update-available', { version: '1.0.9' });
      return undefined;
    }),
    downloadUpdate: vi.fn(async () => {
      emit('download-progress', { percent: 50 });
      emit('update-downloaded');
    }),
    quitAndInstall: vi.fn(),
  };
  const states: string[] = [];
  const beforeInstallSpy = opts.beforeInstall ?? vi.fn();
  const updater = createUpdater({
    app: { isPackaged: opts.packaged ?? true, getVersion: () => '1.0.0' },
    isDev: false,
    onState: (s: { status: string }) => states.push(s.status),
    beforeInstall: beforeInstallSpy,
    loadAutoUpdater: () => au,
    env: {},
    platform: 'win32',
  });
  return { au, updater, states, emit, beforeInstall: beforeInstallSpy };
}

describe('createUpdater: verificação e download automáticos', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('ao achar versão nova, já baixa sem o usuário clicar em "Baixar"', async () => {
    const { au, updater } = setup();
    const state = await updater.check();
    expect(au.downloadUpdate).toHaveBeenCalledTimes(1);
    expect(state.status).toBe('downloaded');
    expect(state.latestVersion).toBe('1.0.9');
  });

  it('sem versão nova, não baixa nada', async () => {
    const { au, updater, emit } = setup({ check: () => emit('update-not-available') });
    const state = await updater.check();
    expect(au.downloadUpdate).not.toHaveBeenCalled();
    expect(state.status).toBe('not-available');
  });

  it('verificação automática sem internet volta a "idle" em vez de mostrar erro', async () => {
    const { updater } = setup({ check: () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })) });
    const state = await updater.check({ automatic: true });
    expect(state.status).toBe('idle');
  });

  it('verificação manual sem internet continua mostrando o erro', async () => {
    const { updater } = setup({ check: () => Promise.reject(Object.assign(new Error('x'), { code: 'ENOTFOUND' })) });
    const state = await updater.check();
    expect(state.status).toBe('error');
  });

  it('startAutoCheck verifica depois do atraso inicial e repete no intervalo', async () => {
    vi.useFakeTimers();
    const { au, updater, emit } = setup({ check: () => emit('update-not-available') });
    const stop = updater.startAutoCheck({ initialDelayMs: 1000, intervalMs: 5000 });
    expect(au.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(20000);
    expect(au.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it('não agenda nada quando as atualizações estão desativadas (app não empacotado)', async () => {
    vi.useFakeTimers();
    const { au, updater } = setup({ packaged: false });
    updater.startAutoCheck({ initialDelayMs: 10, intervalMs: 10 });
    await vi.advanceTimersByTimeAsync(100);
    expect(au.checkForUpdates).not.toHaveBeenCalled();
  });

  describe('checkStartupUpdate (atualização antes do menu)', () => {
    it('quando há versão nova: baixa, executa install, notifica status e retorna true', async () => {
      const { au, updater, beforeInstall } = setup();
      const statusUpdates: string[] = [];

      const result = await updater.checkStartupUpdate({
        timeoutMs: 2000,
        onStatus: (msg: string) => statusUpdates.push(msg),
      });

      expect(result).toBe(true);
      expect(au.checkForUpdates).toHaveBeenCalledTimes(1);
      expect(au.downloadUpdate).toHaveBeenCalledTimes(1);
      expect(beforeInstall).toHaveBeenCalledTimes(1);
      expect(au.quitAndInstall).toHaveBeenCalledWith(true, true);
      expect(statusUpdates).toContain('Procurando atualizações...');
      expect(statusUpdates).toContain('Reiniciando para aplicar atualização...');
    });

    it('quando não há versão nova: retorna false e não trava o startup', async () => {
      const { au, updater, emit } = setup({ check: () => emit('update-not-available') });
      const statusUpdates: string[] = [];

      const result = await updater.checkStartupUpdate({
        timeoutMs: 2000,
        onStatus: (msg: string) => statusUpdates.push(msg),
      });

      expect(result).toBe(false);
      expect(au.downloadUpdate).not.toHaveBeenCalled();
      expect(au.quitAndInstall).not.toHaveBeenCalled();
    });

    it('quando offline ou com erro de rede: retorna false silenciosamente', async () => {
      const { au, updater } = setup({
        check: () => Promise.reject(Object.assign(new Error('no internet'), { code: 'ENOTFOUND' })),
      });

      const result = await updater.checkStartupUpdate({ timeoutMs: 2000 });
      expect(result).toBe(false);
      expect(au.quitAndInstall).not.toHaveBeenCalled();
    });

    it('quando desativado (não empacotado): retorna false imediatamente', async () => {
      const { au, updater } = setup({ packaged: false });

      const result = await updater.checkStartupUpdate({ timeoutMs: 2000 });
      expect(result).toBe(false);
      expect(au.checkForUpdates).not.toHaveBeenCalled();
    });
  });
});
