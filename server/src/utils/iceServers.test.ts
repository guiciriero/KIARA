import { createHmac } from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getIceServers, isTurnConfigured, resetIceServersCache } from './iceServers';

const ENV_KEYS = ['TURN_URLS', 'TURN_SECRET', 'CLOUDFLARE_TURN_KEY_ID', 'CLOUDFLARE_TURN_API_TOKEN'];

function clearEnv(): void {
  for (const k of ENV_KEYS) delete process.env[k];
}

const CF_RESPONSE = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'user-cf',
      credential: 'cred-cf',
    },
  ],
};

describe('iceServers', () => {
  beforeEach(() => {
    clearEnv();
    resetIceServersCache();
  });
  afterEach(() => {
    clearEnv();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('sem configuração: só STUN e isTurnConfigured=false', async () => {
    expect(isTurnConfigured()).toBe(false);
    const servers = await getIceServers('room-1');
    expect(servers).toHaveLength(1);
    expect(servers[0].username).toBeUndefined();
    expect(servers[0].urls).toContain('stun:stun.l.google.com:19302');
    expect(servers[0].urls).toContain('stun:stun1.l.google.com:19302');
  });

  it('modo A: username expira em 6 h e credential é HMAC-SHA1 base64 (valor independente)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));
    process.env.TURN_URLS = 'turn:turn.exemplo.com:3478, turns:turn.exemplo.com:5349?transport=tcp';
    process.env.TURN_SECRET = 'segredo-de-teste';
    expect(isTurnConfigured()).toBe(true);

    const servers = await getIceServers('sala-abc');
    const turn = servers[1];
    const expires = 1735689600 + 6 * 3600; // 2025-01-01T00:00:00Z em epoch + 6 h
    expect(turn.username).toBe(`${expires}:sala-abc`);
    expect(turn.urls).toEqual(['turn:turn.exemplo.com:3478', 'turns:turn.exemplo.com:5349?transport=tcp']);

    // Valor de referência calculado fora do código:
    // printf '1735711200:sala-abc' | openssl dgst -sha1 -hmac 'segredo-de-teste' -binary | base64
    expect(turn.credential).toBe('hZlckikxk48ER33BNplBrus3dPc=');
    expect(turn.credential).toBe(createHmac('sha1', 'segredo-de-teste').update(`${expires}:sala-abc`).digest('base64'));
  });

  it('modo A: descarta URLs com esquema inválido; sem nenhuma válida não considera configurado', async () => {
    process.env.TURN_SECRET = 's';
    process.env.TURN_URLS = 'http://evil.example.com, javascript:alert(1), ftp://x, turn:ok.example.com:3478';
    const servers = await getIceServers('r');
    expect(servers[1].urls).toEqual(['turn:ok.example.com:3478']);

    process.env.TURN_URLS = 'http://evil.example.com,turn:';
    expect(isTurnConfigured()).toBe(false);
    expect(await getIceServers('r')).toHaveLength(1);
  });

  it('modo A tem precedência sobre Cloudflare', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.TURN_URLS = 'turn:turn.exemplo.com:3478';
    process.env.TURN_SECRET = 's';
    process.env.CLOUDFLARE_TURN_KEY_ID = 'abc';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'tok';
    await getIceServers('r');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Cloudflare: sucesso, chamada correta, filtra porta 53 e usa cache', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(CF_RESPONSE), { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key123';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token-secreto';
    expect(isTurnConfigured()).toBe(true);

    const servers = await getIceServers('r1');
    const turn = servers.find((s) => s.username);
    expect(turn?.username).toBe('user-cf');
    expect(turn?.credential).toBe('cred-cf');
    expect(turn?.urls).toEqual([
      'turn:turn.cloudflare.com:3478?transport=udp',
      'turns:turn.cloudflare.com:443?transport=tcp',
    ]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key123/credentials/generate-ice-servers');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer token-secreto');
    expect(JSON.parse(init.body)).toEqual({ ttl: 21600 });
    expect(init.signal).toBeInstanceOf(AbortSignal);

    await getIceServers('r2');
    expect(fetchMock).toHaveBeenCalledTimes(1); // cache de 10 min
  });

  it('Cloudflare: erro HTTP cai para só STUN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('no', { status: 403 })));
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key123';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token-secreto';
    const servers = await getIceServers('r');
    expect(servers).toHaveLength(1);
    expect(servers.some((s) => s.username)).toBe(false);
  });

  it('Cloudflare: timeout/abort cai para só STUN', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')));
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key123';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token-secreto';
    expect(await getIceServers('r')).toHaveLength(1);
  });

  it('Cloudflare: resposta sem TURN utilizável cai para só STUN', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ iceServers: [{ urls: ['turn:x:3478'] }] }), { status: 201 })),
    );
    process.env.CLOUDFLARE_TURN_KEY_ID = 'key123';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'token-secreto';
    expect(await getIceServers('r')).toHaveLength(1);
  });

  it('Cloudflare: key id com formato inválido é ignorado (sem fetch)', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    process.env.CLOUDFLARE_TURN_KEY_ID = '../evil';
    process.env.CLOUDFLARE_TURN_API_TOKEN = 'tok';
    expect(isTurnConfigured()).toBe(false);
    await getIceServers('r');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
