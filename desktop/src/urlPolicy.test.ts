import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  DEV_HOSTS,
  resolveDevUrl,
  originOf,
  isTrustedUrl,
  validateViewerUrl,
  isViewerUrl,
  isInternalUrl,
  safeExternalHref,
  shouldLeaveForeignPage,
  localHomeUrl,
  buildProdCsp,
} = require('./urlPolicy.js');

describe('urlPolicy', () => {
  describe('resolveDevUrl', () => {
    it('retorna nulos quando ELECTRON_START_URL não está definida', () => {
      expect(resolveDevUrl(undefined)).toEqual({ url: null, origin: null, error: null });
      expect(resolveDevUrl('')).toEqual({ url: null, origin: null, error: null });
    });

    it('aceita URLs válidas em localhost e 127.0.0.1', () => {
      expect(resolveDevUrl('http://localhost:3000')).toEqual({
        url: 'http://localhost:3000/',
        origin: 'http://localhost:3000',
        error: null,
      });
      expect(resolveDevUrl('http://127.0.0.1:5173/app')).toEqual({
        url: 'http://127.0.0.1:5173/app',
        origin: 'http://127.0.0.1:5173',
        error: null,
      });
      expect(resolveDevUrl('http://[::1]:8080')).toEqual({
        url: 'http://[::1]:8080/',
        origin: 'http://[::1]:8080',
        error: null,
      });
    });

    it('rejeita hosts externos ou protocolos não http/https', () => {
      const ext = resolveDevUrl('https://exemplo.com:3000');
      expect(ext.url).toBeNull();
      expect(ext.error).toMatch(/apenas localhost\/127.0.0.1/);

      const invalid = resolveDevUrl('not-a-url');
      expect(invalid.url).toBeNull();
      expect(invalid.error).toMatch(/não é uma URL válida/);
    });
  });

  describe('originOf', () => {
    it('extrai protocol + host', () => {
      expect(originOf('http://127.0.0.1:4000/view/ABC234')).toBe('http://127.0.0.1:4000');
      expect(originOf('https://kiara.app/test')).toBe('https://kiara.app');
      expect(originOf('invalido')).toBeNull();
    });
  });

  describe('isTrustedUrl', () => {
    it('valida se URL pertence à origem confiável', () => {
      const origin = 'http://127.0.0.1:3500';
      expect(isTrustedUrl(origin, 'http://127.0.0.1:3500/dashboard')).toBe(true);
      expect(isTrustedUrl(origin, 'http://127.0.0.1:3501/dashboard')).toBe(false);
      expect(isTrustedUrl(origin, 'https://kiara.app')).toBe(false);
      expect(isTrustedUrl(null, 'http://127.0.0.1:3500')).toBe(false);
    });
  });

  describe('validateViewerUrl / isViewerUrl', () => {
    it('aceita URLs HTTPS válidas com código de 6 caracteres', () => {
      expect(validateViewerUrl('https://kiara.app/view/ABCDEF')).toBe('https://kiara.app/view/ABCDEF');
      expect(validateViewerUrl('https://sub.kiara.app/view/A2HJK3/')).toBe('https://sub.kiara.app/view/A2HJK3/');
      expect(isViewerUrl('https://kiara.app/view/ABCDEF')).toBe(true);
    });

    it('aceita HTTP em dev hosts', () => {
      expect(validateViewerUrl('http://localhost:3000/view/ABC234')).toBe('http://localhost:3000/view/ABC234');
      expect(validateViewerUrl('http://127.0.0.1:3000/view/ABC234')).toBe('http://127.0.0.1:3000/view/ABC234');
    });

    it('rejeita HTTP em hosts públicos', () => {
      expect(() => validateViewerUrl('http://kiara.app/view/ABCDEF')).toThrow(/deve usar HTTPS/);
      expect(isViewerUrl('http://kiara.app/view/ABCDEF')).toBe(false);
    });

    it('rejeita credenciais na URL', () => {
      expect(() => validateViewerUrl('https://user:pass@kiara.app/view/ABCDEF')).toThrow(/credenciais/);
    });

    it('rejeita códigos com tamanho inválido ou caracteres proibidos (0, O, 1, I)', () => {
      expect(() => validateViewerUrl('https://kiara.app/view/ABC')).toThrow(/Esperado: \/view\/XXXXXX/);
      expect(() => validateViewerUrl('https://kiara.app/view/ABCDEFG')).toThrow(/Esperado: \/view\/XXXXXX/);
      expect(() => validateViewerUrl('https://kiara.app/view/ABC0EF')).toThrow(/Esperado: \/view\/XXXXXX/); // 0 proibido
      expect(() => validateViewerUrl('https://kiara.app/other/ABCDEF')).toThrow(/Esperado: \/view\/XXXXXX/);
    });
  });

  describe('isInternalUrl', () => {
    it('identifica esquemas internos e URLs nulas/vazias', () => {
      expect(isInternalUrl('')).toBe(true);
      expect(isInternalUrl(null)).toBe(true);
      expect(isInternalUrl('about:blank')).toBe(true);
      expect(isInternalUrl('data:text/html,test')).toBe(true);
      expect(isInternalUrl('devtools://devtools/bundled/inspector.html')).toBe(true);
      expect(isInternalUrl('chrome-error://chromewebdata/')).toBe(true);
      expect(isInternalUrl('https://google.com')).toBe(false);
    });
  });

  describe('safeExternalHref', () => {
    it('aceita apenas HTTPS para abrir no navegador do sistema', () => {
      expect(safeExternalHref('https://github.com/guiciriero/KIARA')).toBe('https://github.com/guiciriero/KIARA');
      expect(safeExternalHref('http://inseguro.com')).toBeNull();
      expect(safeExternalHref('file:///etc/passwd')).toBeNull();
      expect(safeExternalHref('invalid')).toBeNull();
    });
  });

  describe('shouldLeaveForeignPage', () => {
    const trusted = 'http://127.0.0.1:4000';

    it('não deixa página se for url interna, confiável ou de espectador', () => {
      expect(shouldLeaveForeignPage(trusted, 'about:blank')).toBe(false);
      expect(shouldLeaveForeignPage(trusted, 'http://127.0.0.1:4000/')).toBe(false);
      expect(shouldLeaveForeignPage(trusted, 'https://kiara.app/view/ABC234')).toBe(false);
    });

    it('retorna true se navegou para página externa não autorizada', () => {
      expect(shouldLeaveForeignPage(trusted, 'https://google.com')).toBe(true);
      expect(shouldLeaveForeignPage(trusted, 'https://kiara.app/outra-coisa')).toBe(true);
    });
  });

  describe('localHomeUrl', () => {
    it('retorna devUrl em dev e http://127.0.0.1:porta em prod', () => {
      expect(localHomeUrl({ isDev: true, devUrl: 'http://localhost:3000', embeddedPort: null })).toBe('http://localhost:3000');
      expect(localHomeUrl({ isDev: false, devUrl: null, embeddedPort: 4567 })).toBe('http://127.0.0.1:4567');
      expect(localHomeUrl({ isDev: false, devUrl: null, embeddedPort: null })).toBeNull();
    });
  });

  describe('buildProdCsp', () => {
    it('injeta a origem e ws da origem em connect-src', () => {
      const csp = buildProdCsp('http://127.0.0.1:4123');
      expect(csp).toContain("connect-src 'self' http://127.0.0.1:4123 ws://127.0.0.1:4123 https: wss: ws:");
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
    });
  });
});
