/**
 * Política de redirecionamento do prepare-resources.mjs.
 * Módulo puro (sem rede), testado em src/redirectPolicy.test.ts.
 */

/** Hosts permitidos como DESTINO de redirecionamento ao baixar o cloudflared. */
export const ALLOWED_REDIRECT_HOSTS = Object.freeze([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
]);

/**
 * @param {string} url URL absoluta do destino do redirecionamento.
 * @returns {boolean} true somente para https em um dos hosts permitidos (sem credenciais).
 */
export function isAllowedRedirectTarget(url) {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      ALLOWED_REDIRECT_HOSTS.includes(u.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}
