import type { AddressInfo } from 'net';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppInstance, type AppOptions } from './app';

// Evita rede real: /download/windows cai no redirecionamento de fallback
vi.mock('./utils/latestRelease', () => ({
  getLatestWindowsInstallerUrl: vi.fn().mockResolvedValue(undefined),
  getReleasesPageUrl: () => 'https://github.com/guiciriero/KIARA/releases/latest',
}));

const running: AppInstance[] = [];
const sockets: Socket[] = [];

async function start(opts: AppOptions = {}): Promise<{ inst: AppInstance; base: string }> {
  const inst = createApp({ clientDistDir: null, ...opts });
  await new Promise<void>((resolve) => inst.httpServer.listen(0, '127.0.0.1', resolve));
  running.push(inst);
  const { port } = inst.httpServer.address() as AddressInfo;
  return { inst, base: `http://127.0.0.1:${port}` };
}

function connect(base: string): Socket {
  const s = ioClient(base, { transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(s);
  return s;
}

const once = <T = unknown>(s: Socket, event: string): Promise<T> =>
  new Promise((resolve) => s.once(event, (v: T) => resolve(v)));

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  for (const inst of running.splice(0)) await inst.close();
});

describe('createApp', () => {
  it('não faz listen por conta própria', async () => {
    const inst = createApp({ clientDistDir: null });
    expect(inst.httpServer.listening).toBe(false);
    await inst.close();
  });

  it('/health responde 200 com cabeçalhos do helmet', async () => {
    const { base } = await start({ production: false });
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    expect(((await res.json()) as { status: string }).status).toBe('ok');

    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain('upgrade-insecure-requests');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-powered-by')).toBeNull();
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('segurança: Permissions-Policy, form-action, /health sem uptime e CORS sem credentials', async () => {
    const { base } = await start({ production: false });
    const res = await fetch(`${base}/health`, { headers: { Origin: base } });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('uptime');
    expect(res.headers.get('permissions-policy') ?? '').toContain('camera=()');
    expect(res.headers.get('content-security-policy') ?? '').toContain("form-action 'self'");
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('segurança: CORS não reflete origens externas', async () => {
    const { base } = await start({ production: false });
    const res = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('/download/windows redireciona e dispara 429 JSON genérico ao exceder o limite; /health é isento', async () => {
    const { base } = await start({
      rateLimit: { general: { windowMs: 60_000, limit: 100 }, download: { windowMs: 60_000, limit: 2 } },
    });
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${base}/download/windows`, { redirect: 'manual' });
      expect(r.status).toBe(302);
      expect(r.headers.get('location')).toBe('https://github.com/guiciriero/KIARA/releases/latest');
    }
    const limited = await fetch(`${base}/download/windows`, { redirect: 'manual' });
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: 'too-many-requests' });
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('limite geral não afeta /health', async () => {
    const { base } = await start({ rateLimit: { general: { windowMs: 60_000, limit: 1 } } });
    expect((await fetch(`${base}/nao-existe`)).status).toBe(404);
    expect((await fetch(`${base}/nao-existe`)).status).toBe(429);
    for (let i = 0; i < 3; i++) expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it('limite de conexões por IP recusa com server-busy e libera ao desconectar', async () => {
    const { base } = await start({ maxConnectionsPerIp: 2 });
    const a = connect(base);
    const b = connect(base);
    await Promise.all([once(a, 'connect'), once(b, 'connect')]);

    const c = connect(base);
    const err = await once<Error>(c, 'connect_error');
    expect(err.message).toBe('server-busy');

    a.disconnect();
    await vi.waitFor(async () => {
      const d = connect(base);
      const result = await Promise.race([
        once(d, 'connect').then(() => 'ok'),
        once<Error>(d, 'connect_error').then((e) => e.message),
      ]);
      expect(result).toBe('ok');
    });
  });

  it('limite global de conexões recusa com server-busy', async () => {
    const { base } = await start({ maxConnections: 1, maxConnectionsPerIp: 10 });
    const a = connect(base);
    await once(a, 'connect');
    const b = connect(base);
    expect((await once<Error>(b, 'connect_error')).message).toBe('server-busy');
  });

  it('mensagem maior que 64 KB derruba a conexão', async () => {
    const { base } = await start();
    const s = connect(base);
    await once(s, 'connect');
    const closed = once<string>(s, 'disconnect');
    s.emit('teste:grande', 'x'.repeat(70 * 1024));
    expect(await closed).toBe('transport close');
  });

  it('origem fora da allowlist é recusada no handshake', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(res.status).toBe(403);
    const ok = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: base } });
    expect(ok.status).toBe(200);
  });

  it('close() desconecta clientes, para o servidor e é idempotente', async () => {
    const { inst, base } = await start();
    const s = connect(base);
    await once(s, 'connect');
    const disconnected = once(s, 'disconnect');

    await Promise.all([inst.close(), inst.close()]);
    await disconnected;
    expect(inst.httpServer.listening).toBe(false);
    await expect(inst.close()).resolves.toBeUndefined();
    await expect(fetch(`${base}/health`)).rejects.toBeTruthy();
  });
});
