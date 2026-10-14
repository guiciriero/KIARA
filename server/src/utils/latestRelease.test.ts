import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getLatestWindowsInstallerUrl, getReleasesPageUrl, resetLatestReleaseCache } from './latestRelease';

const REPO = 'guiciriero/KIARA';
const GOOD = `https://github.com/${REPO}/releases/download/v1.2.3/KIARA-Setup-1.2.3.exe`;

function apiResponse(assets: unknown, init: { status?: number; url?: string } = {}): Response {
  const res = new Response(JSON.stringify({ assets }), { status: init.status ?? 200 });
  if (init.url) Object.defineProperty(res, 'url', { value: init.url });
  return res;
}

describe('latestRelease', () => {
  beforeEach(() => {
    delete process.env.GITHUB_REPO;
    resetLatestReleaseCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.GITHUB_REPO;
  });

  it('devolve o asset .exe válido (ignora .blockmap) e usa cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      apiResponse([
        { name: 'KIARA-Setup-1.2.3.exe.blockmap', browser_download_url: `${GOOD}.blockmap` },
        { name: 'KIARA-Setup-1.2.3.exe', browser_download_url: GOOD },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);
    expect(await getLatestWindowsInstallerUrl()).toBe(GOOD);
    expect(await getLatestWindowsInstallerUrl()).toBe(GOOD);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`https://api.github.com/repos/${REPO}/releases/latest`);
  });

  it('ignora asset com host inesperado, esquema http ou outro repositório', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        apiResponse([
          { name: 'KIARA-Setup-1.exe', browser_download_url: 'https://evil.example.com/KIARA-Setup-1.exe' },
          { name: 'KIARA-Setup-2.exe', browser_download_url: `http://github.com/${REPO}/releases/download/v/KIARA-Setup-2.exe` },
          { name: 'KIARA-Setup-3.exe', browser_download_url: 'https://github.com/outro/repo/releases/download/v/KIARA-Setup-3.exe' },
          { name: 'KIARA-Setup-4.exe', browser_download_url: `https://github.com.evil.com/${REPO}/releases/download/v/KIARA-Setup-4.exe` },
          { name: 'KIARA-Setup-5.exe', browser_download_url: `https://user@github.com/${REPO}/releases/download/v/KIARA-Setup-5.exe` },
        ]),
      ),
    );
    expect(await getLatestWindowsInstallerUrl()).toBeUndefined();
  });

  it('ignora resposta cujo host final não é api.github.com', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(apiResponse([{ name: 'KIARA-Setup-1.exe', browser_download_url: GOOD }], { url: 'https://evil.example.com/x' })),
    );
    expect(await getLatestWindowsInstallerUrl()).toBeUndefined();
  });

  it('erro HTTP, rede ou timeout ⇒ undefined (chamador usa a página de releases)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('x', { status: 500 })));
    expect(await getLatestWindowsInstallerUrl()).toBeUndefined();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    expect(await getLatestWindowsInstallerUrl()).toBeUndefined();
  });

  it('GITHUB_REPO inválido volta ao padrão; válido é usado', () => {
    process.env.GITHUB_REPO = '../../etc';
    expect(getReleasesPageUrl()).toBe(`https://github.com/${REPO}/releases/latest`);
    process.env.GITHUB_REPO = 'dono/repo';
    expect(getReleasesPageUrl()).toBe('https://github.com/dono/repo/releases/latest');
  });
});
