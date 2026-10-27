import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import { createTestServer, sleep, waitForEvent, type TestServer } from '../test/helpers';
import { resetIceServersCache } from '../utils/iceServers';

let server: TestServer;

beforeEach(async () => {
  delete process.env.TURN_URLS;
  delete process.env.TURN_SECRET;
  resetIceServersCache();
  server = await createTestServer();
});

afterEach(async () => {
  await server.close();
  delete process.env.HOST_GRACE_MS;
  resetIceServersCache();
});

async function createRoom(host: Socket, payload?: unknown): Promise<any> {
  const created = waitForEvent<any>(host, 'room:created');
  host.emit('room:create', payload);
  return created;
}

async function joinRoom(viewer: Socket, payload: unknown): Promise<any> {
  const joined = waitForEvent<any>(viewer, 'room:joined');
  viewer.emit('room:join', payload);
  return joined;
}

/** true se o evento NÃO chegar dentro da janela */
async function never(socket: Socket, event: string, ms = 250): Promise<boolean> {
  let got = false;
  const handler = (): void => {
    got = true;
  };
  socket.on(event, handler);
  await sleep(ms);
  socket.off(event, handler);
  return !got;
}

describe('período de graça do apresentador e room:resume', () => {
  it('queda do host: espectadores recebem host-reconnecting; novo socket retoma com o token e recebe room:resumed', async () => {
    process.env.HOST_GRACE_MS = '5000';
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code, name: 'Maria' });

    const reconnecting = waitForEvent<any>(viewer, 'room:host-reconnecting');
    host.disconnect();
    expect((await reconnecting).graceMs).toBe(5000);

    // Sala segue aberta durante a graça
    expect(server.roomManager.getRoom(created.roomId)?.hostInGrace).toBe(true);

    const newHost = await server.createClient();
    const hostResumed = waitForEvent<any>(viewer, 'room:host-resumed');
    const resumed = waitForEvent<any>(newHost, 'room:resumed');
    newHost.emit('room:resume', { roomId: created.roomId, hostToken: created.hostToken });

    const r = await resumed;
    expect(r.roomId).toBe(created.roomId);
    expect(r.code).toBe(created.code);
    expect(r.viewerCount).toBe(1);
    expect(r).not.toHaveProperty('hostToken');
    expect((await hostResumed).hostId).toBe(newHost.id);

    const room = server.roomManager.getRoom(created.roomId);
    expect(room?.hostId).toBe(newHost.id);
    expect(room?.hostInGrace).toBe(false);

    // O novo host passa a receber os eventos da sala
    const late = await server.createClient();
    const viewerJoined = waitForEvent<any>(newHost, 'room:viewer-joined');
    await joinRoom(late, { code: created.code });
    expect((await viewerJoined).viewerId).toBe(late.id);
  });

  it('token errado é rejeitado como not-found e a graça continua valendo', async () => {
    process.env.HOST_GRACE_MS = '5000';
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    const oldHostId = host.id;

    const reconnecting = waitForEvent(viewer, 'room:host-reconnecting');
    host.disconnect();
    await reconnecting;

    const intruder = await server.createClient();
    const err = waitForEvent<any>(intruder, 'room:error');
    intruder.emit('room:resume', { roomId: created.roomId, hostToken: 'token-errado' });
    expect((await err).code).toBe('not-found');

    // Sala inexistente é indistinguível de token errado
    const err2 = waitForEvent<any>(intruder, 'room:error');
    intruder.emit('room:resume', { roomId: 'nao-existe', hostToken: created.hostToken });
    expect((await err2).code).toBe('not-found');

    const room = server.roomManager.getRoom(created.roomId);
    expect(room?.hostInGrace).toBe(true);
    expect(room?.hostId).toBe(oldHostId);
  });

  it('payload malformado em room:resume retorna invalid-request', async () => {
    const client = await server.createClient();
    const err = waitForEvent<any>(client, 'room:error');
    client.emit('room:resume', { roomId: 123 });
    expect((await err).code).toBe('invalid-request');
  });

  it('expirar a graça fecha a sala e avisa com room:host-disconnected', async () => {
    process.env.HOST_GRACE_MS = '150';
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    const reconnecting = waitForEvent(viewer, 'room:host-reconnecting');
    const closed = waitForEvent<any>(viewer, 'room:host-disconnected');
    host.disconnect();
    await reconnecting;
    expect((await closed).message).toBeTruthy();

    expect(server.roomManager.getRoom(created.roomId)).toBeUndefined();

    // Retomar depois de expirada não funciona
    const newHost = await server.createClient();
    const err = waitForEvent<any>(newHost, 'room:error');
    newHost.emit('room:resume', { roomId: created.roomId, hostToken: created.hostToken });
    expect((await err).code).toBe('not-found');
  });

  it('room:leave explícito fecha a sala na hora, sem período de graça', async () => {
    process.env.HOST_GRACE_MS = '5000';
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    let reconnectingSeen = false;
    viewer.on('room:host-reconnecting', () => {
      reconnectingSeen = true;
    });
    const closed = waitForEvent(viewer, 'room:host-disconnected');
    host.emit('room:leave');
    await closed;

    expect(reconnectingSeen).toBe(false);
    expect(server.roomManager.getRoom(created.roomId)).toBeUndefined();

    // O disconnect posterior não revive nada
    host.disconnect();
    await sleep(100);
    expect(server.roomManager.listRooms()).toHaveLength(0);
  });
});

describe('codeChanged', () => {
  it('é true só quando o código preferido foi pedido e não pôde ser usado', async () => {
    const h1 = await server.createClient();
    const h2 = await server.createClient();
    const h3 = await server.createClient();

    const first = await createRoom(h1, { preferredCode: 'ABC234' });
    expect(first.code).toBe('ABC234');
    expect(first.codeChanged).toBeUndefined();

    const second = await createRoom(h2, { preferredCode: 'ABC234' });
    expect(second.code).not.toBe('ABC234');
    expect(second.codeChanged).toBe(true);

    const third = await createRoom(h3);
    expect(third.codeChanged).toBeUndefined();
  });
});

describe('expulsar e banir espectador', () => {
  it('kick remove o espectador, avisa host e espectador, e ele pode entrar de novo', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    const left = waitForEvent<any>(host, 'room:viewer-left');
    const kicked = waitForEvent<any>(viewer, 'room:error');
    host.emit('room:kick-viewer', { viewerId: viewer.id });

    expect((await kicked).code).toBe('kicked');
    expect((await left).viewerId).toBe(viewer.id);
    expect(server.roomManager.getRoom(created.roomId)?.viewers.has(viewer.id!)).toBe(false);

    const again = await joinRoom(viewer, { code: created.code });
    expect(again.roomId).toBe(created.roomId);
  });

  it('ban registra o IP: o espectador banido recebe banned ao tentar entrar de novo', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    const banned = waitForEvent<any>(viewer, 'room:error');
    host.emit('room:kick-viewer', { viewerId: viewer.id, ban: true });
    expect((await banned).code).toBe('banned');
    expect(server.roomManager.getRoom(created.roomId)?.bannedIps.size).toBe(1);

    const retry = waitForEvent<any>(viewer, 'room:error');
    viewer.emit('room:join', { code: created.code });
    expect((await retry).code).toBe('banned');

    // Outro socket do mesmo IP também é barrado
    const sameIp = await server.createClient();
    const retry2 = waitForEvent<any>(sameIp, 'room:error');
    sameIp.emit('room:join', { code: created.code });
    expect((await retry2).code).toBe('banned');
  });

  it('quem não é o host não consegue expulsar ninguém', async () => {
    const host = await server.createClient();
    const v1 = await server.createClient();
    const v2 = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(v1, { code: created.code });
    await joinRoom(v2, { code: created.code });

    v1.emit('room:kick-viewer', { viewerId: v2.id, ban: true });
    expect(await never(v2, 'room:error')).toBe(true);
    const room = server.roomManager.getRoom(created.roomId);
    expect(room?.viewers.has(v2.id!)).toBe(true);
    expect(room?.bannedIps.size).toBe(0);
  });

  it('payload inválido ou espectador inexistente é ignorado', async () => {
    const host = await server.createClient();
    const created = await createRoom(host);
    host.emit('room:kick-viewer', { viewerId: '' });
    host.emit('room:kick-viewer', { viewerId: 'nao-esta-na-sala', ban: true });
    host.emit('room:kick-viewer', 'lixo');
    await sleep(150);
    expect(server.roomManager.getRoom(created.roomId)?.bannedIps.size).toBe(0);
    expect(host.connected).toBe(true);
  });
});

describe('nomes dos espectadores', () => {
  it('viewer-joined traz o nome informado (sanitizado) ou "Convidado"', async () => {
    const host = await server.createClient();
    const v1 = await server.createClient();
    const v2 = await server.createClient();
    const created = await createRoom(host);

    const first = waitForEvent<any>(host, 'room:viewer-joined');
    await joinRoom(v1, { code: created.code, name: '  Maria   Silva ' });
    expect((await first).name).toBe('Maria Silva');

    const second = waitForEvent<any>(host, 'room:viewer-joined');
    await joinRoom(v2, { code: created.code });
    expect((await second).name).toBe('Convidado');
  });

  it('room:set-name de um espectador admitido gera viewer-renamed para o host', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code, name: 'Maria' });

    const renamed = waitForEvent<any>(host, 'room:viewer-renamed');
    viewer.emit('room:set-name', { name: 'Joana' });
    expect(await renamed).toEqual({ viewerId: viewer.id, name: 'Joana' });
    expect(server.roomManager.getRoom(created.roomId)?.viewerNames.get(viewer.id!)).toBe('Joana');
  });

  it('o host não gera viewer-renamed ao usar room:set-name', async () => {
    const host = await server.createClient();
    const created = await createRoom(host);
    host.emit('room:set-name', { name: 'Fulano' });
    expect(await never(host, 'room:viewer-renamed')).toBe(true);
    expect(server.roomManager.getRoom(created.roomId)?.viewerNames.size).toBe(0);
  });

  it('room:set-name fora de qualquer sala é ignorado', async () => {
    const host = await server.createClient();
    const outsider = await server.createClient();
    const created = await createRoom(host);

    outsider.emit('room:set-name', { name: 'Intruso' });
    expect(await never(host, 'room:viewer-renamed')).toBe(true);
    expect(outsider.connected).toBe(true);
    expect(server.roomManager.getRoom(created.roomId)?.viewerNames.size).toBe(0);
  });
});
