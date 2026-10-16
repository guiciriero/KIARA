import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createUpdater } = require('./updater.js');

/* Segurança: o updater empacotado NÃO pode aceitar KIARA_UPDATE_URL do ambiente do usuário. */
function setup(isPackaged: boolean, envUrl?: string) {
  const au = { on: vi.fn(), setFeedURL: vi.fn(), checkForUpdates: vi.fn().mockResolvedValue(undefined) };
  const app = { isPackaged, getVersion: () => '1.0.0' };
  const updater = createUpdater({
    app,
    isDev: false,
    onState: () => {},
    beforeInstall: () => {},
    loadAutoUpdater: () => au,
    env: { KIARA_UPDATE_URL: envUrl },
    platform: 'win32',
  });
  return { au, updater };
}

describe('createUpdater: feed de atualização', () => {
  it('app empacotado ignora KIARA_UPDATE_URL malicioso do ambiente', async () => {
    const { au, updater } = setup(true, 'https://evil.example/feed/');
    await updater.check();
    expect(au.setFeedURL).not.toHaveBeenCalled();
  });

  it('em dev aceita KIARA_UPDATE_URL https, mas o updater fica desativado se não empacotado', async () => {
    const { au, updater } = setup(false, 'https://dev.example/feed/');
    await updater.check();
    expect(au.checkForUpdates).not.toHaveBeenCalled();
    expect(au.setFeedURL).not.toHaveBeenCalled();
  });
});
