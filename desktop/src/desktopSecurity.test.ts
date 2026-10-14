import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const L = require('./updateLogic.js');
const I = require('./runtime/integrity.js');

describe('resolveFeedUrl / parseFeedUrl', () => {
  const ok = 'https://updates.exemplo.com/kiara/';
  it('app empacotado ignora KIARA_UPDATE_URL do ambiente', () => {
    expect(L.resolveFeedUrl({ isPackaged: true, envUrl: 'https://evil.example/', buildInfoUrl: undefined })).toBeNull();
    expect(L.resolveFeedUrl({ isPackaged: true, envUrl: 'https://evil.example/', buildInfoUrl: ok })).toBe(ok);
  });
  it('dev aceita https do ambiente e prefere-o ao build-info', () => {
    expect(L.resolveFeedUrl({ isPackaged: false, envUrl: 'https://dev.example/x', buildInfoUrl: ok })).toBe('https://dev.example/x');
  });
  it('dev rejeita http e cai no build-info/nulo', () => {
    expect(L.resolveFeedUrl({ isPackaged: false, envUrl: 'http://dev.example/', buildInfoUrl: undefined })).toBeNull();
    expect(L.resolveFeedUrl({ isPackaged: false, envUrl: 'http://dev.example/', buildInfoUrl: ok })).toBe(ok);
  });
  it('rejeita esquemas estranhos, credenciais e lixo', () => {
    for (const bad of ['file:///etc/passwd', 'ftp://x.com', 'javascript:alert(1)', 'https://u:p@x.com/', '', '   ', 'não é url', undefined, 42]) {
      expect(L.parseFeedUrl(bad as never)).toBeNull();
    }
  });
});

describe('integridade do cloudflared (SHA-256)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiara-int-'));
  const file = path.join(dir, 'cloudflared.exe');
  fs.writeFileSync(file, 'conteudo-falso-do-binario');
  const sha = crypto.createHash('sha256').update('conteudo-falso-do-binario').digest('hex');

  it('normalizeSha256 aceita prefixo/maiúsculas e rejeita inválidos', () => {
    expect(I.normalizeSha256(`sha256:${sha.toUpperCase()}`)).toBe(sha);
    expect(I.normalizeSha256('abc')).toBeNull();
    expect(I.normalizeSha256(undefined)).toBeNull();
  });
  it('sha256File confere com crypto', async () => {
    expect(await I.sha256File(file)).toBe(sha);
  });
  it('hash correto => ok', async () => {
    expect((await I.checkBinaryIntegrity(file, sha)).status).toBe('ok');
  });
  it('hash divergente => mismatch com mensagem em pt-BR', async () => {
    const r = await I.checkBinaryIntegrity(file, 'a'.repeat(64));
    expect(r.status).toBe('mismatch');
    expect(r.message).toMatch(/não será iniciado/);
  });
  it('sem hash esperado => skipped (comportamento atual)', async () => {
    expect((await I.checkBinaryIntegrity(file, null)).status).toBe('skipped');
  });
  it('readExpectedCloudflaredSha lê build-info.json e tolera ausência', () => {
    fs.writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify({ cloudflaredSha256: sha }));
    expect(I.readExpectedCloudflaredSha(dir)).toBe(sha);
    expect(I.readExpectedCloudflaredSha(path.join(dir, 'nao-existe'))).toBeNull();
    expect(I.readExpectedCloudflaredSha(undefined)).toBeNull();
  });
});

describe('política de redirecionamento (prepare-resources)', () => {
  it('aceita só https nos hosts do GitHub', async () => {
    const { isAllowedRedirectTarget: f } = await import('../scripts/redirect-policy.mjs');
    expect(f('https://github.com/a/b/releases/download/x/y.exe')).toBe(true);
    expect(f('https://objects.githubusercontent.com/z')).toBe(true);
    expect(f('https://release-assets.githubusercontent.com/z')).toBe(true);
    expect(f('http://github.com/x')).toBe(false);
    expect(f('https://evil.com/github.com')).toBe(false);
    expect(f('https://github.com.evil.com/x')).toBe(false);
    expect(f('https://u:p@github.com/x')).toBe(false);
    expect(f('lixo')).toBe(false);
  });
});
