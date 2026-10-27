import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Socket } from 'socket.io-client';
import { createTestServer, sleep, waitForEvent, type TestServer } from '../test/helpers';
import { resetIceServersCache } from '../utils/iceServers';

let server: TestServer;

beforeEach(async () => {
  process.env.JOIN_APPROVAL_TIMEOUT_MS = '300';
  delete process.env.TURN_URLS;
  delete process.env.TURN_SECRET;
  delete process.env.CLOUDFLARE_TURN_KEY_ID;
  delete process.env.CLOUDFLARE_TURN_API_TOKEN;
  resetIceServersCache();
  server = await createTestServer();
});

afterEach(async () => {
  await server.close();
  delete process.env.JOIN_APPROVAL_TIMEOUT_MS;
  delete process.env.MAX_VIEWERS_PER_ROOM;
  delete process.env.MAX_ROOMS;
  delete process.env.TURN_URLS;
  delete process.env.TURN_SECRET;
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

async function expectError(viewer: Socket, trigger: () => void): Promise<any> {
  const err = waitForEvent<any>(viewer, 'room:error');
  trigger();
  return err;
}

describe('criação e entrada em sala', () => {
  it('cria sala sem payload e entra como espectador', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();

    const created = await createRoom(host);
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(created.hasPassword).toBe(false);
    expect(created.requireApproval).toBe(false);
    expect(Array.isArray(created.iceServers)).toBe(true);

    const viewerJoinedOnHost = waitForEvent<any>(host, 'room:viewer-joined');
    const joined = await joinRoom(viewer, { code: created.code, name: 'Maria' });
    expect(joined.roomId).toBe(created.roomId);
    expect(joined.hostId).toBe(host.id);
    expect((await viewerJoinedOnHost).viewerId).toBe(viewer.id);
  });


  it('repassa ao host os codecs com decode por hardware do espectador (filtrados)', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);

    const viewerJoinedOnHost = waitForEvent<any>(host, 'room:viewer-joined');
    await joinRoom(viewer, { code: created.code, hwDecode: ['H265', 'H264', 'H265', 'XYZ', 42] });
    expect((await viewerJoinedOnHost).hwDecode).toEqual(['H265', 'H264']);
  });

  it('não inclui hwDecode no viewer-joined quando o espectador não informa', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);

    const viewerJoinedOnHost = waitForEvent<any>(host, 'room:viewer-joined');
    await joinRoom(viewer, { code: created.code });
    expect((await viewerJoinedOnHost).hwDecode).toBeUndefined();
  });

  it('rejeita código inexistente e código malformado', async () => {
    const viewer = await server.createClient();
    const notFound = await expectError(viewer, () => viewer.emit('room:join', { code: 'ABCDEF' }));
    expect(notFound.code).toBe('not-found');
    const invalid = await expectError(viewer, () => viewer.emit('room:join', { code: '!!' }));
    expect(invalid.code).toBe('invalid-code');
  });

  it('cria sala com payload inválido retorna invalid-request', async () => {
    const host = await server.createClient();
    const err = await expectError(host, () => host.emit('room:create', { password: 'abc' }));
    expect(err.code).toBe('invalid-request');
  });

  it('encerra a sala quando o apresentador desconecta', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    const closed = waitForEvent(viewer, 'room:host-disconnected');
    host.disconnect();
    await closed;

    const late = await server.createClient();
    const err = await expectError(late, () => late.emit('room:join', { code: created.code }));
    expect(err.code).toBe('not-found');
  });
});

describe('senha', () => {
  it('exige senha e rejeita senha errada', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host, { password: 'segredo123' });
    expect(created.hasPassword).toBe(true);

    const noPass = await expectError(viewer, () => viewer.emit('room:join', { code: created.code }));
    expect(noPass.code).toBe('password-required');

    const wrong = await expectError(viewer, () =>
      viewer.emit('room:join', { code: created.code, password: 'errada123' }),
    );
    expect(wrong.code).toBe('wrong-password');

    const joined = await joinRoom(viewer, { code: created.code, password: 'segredo123' });
    expect(joined.roomId).toBe(created.roomId);
  });
  it('sala E2EE: exige token de entrada, anuncia e2ee no password-required e no room:joined', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const token = 'A'.repeat(43);

    // Sem senha ou com senha comum (que chegaria em claro ao servidor) a criação é recusada
    const semSenha = await expectError(host, () => host.emit('room:create', { e2ee: true }));
    expect(semSenha.code).toBe('invalid-request');
    const comum = await expectError(host, () =>
      host.emit('room:create', { e2ee: true, password: 'segredo123' }),
    );
    expect(comum.code).toBe('invalid-request');

    const created = await createRoom(host, { e2ee: true, password: token });
    expect(created.e2ee).toBe(true);
    expect(created.hasPassword).toBe(true);

    const noPass = await expectError(viewer, () => viewer.emit('room:join', { code: created.code }));
    expect(noPass.code).toBe('password-required');
    expect(noPass.e2ee).toBe(true);

    const joined = await joinRoom(viewer, { code: created.code, password: token });
    expect(joined.e2ee).toBe(true);
  });

  it('sala comum não anuncia e2ee', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host, { password: 'segredo123' });
    expect(created.e2ee).toBe(false);
    const noPass = await expectError(viewer, () => viewer.emit('room:join', { code: created.code }));
    expect(noPass.e2ee).toBeUndefined();
  });

  it('não vaza a senha ou o hash em nenhum payload', async () => {
    const host = await server.createClient();
    const created = await createRoom(host, { password: 'segredo123' });
    expect(JSON.stringify(created)).not.toContain('segredo123');
    expect(created).not.toHaveProperty('passwordHash');
  });

  it('bloqueia tentativas excessivas com rate-limited', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host, { password: 'segredo123' });

    for (let i = 0; i < 8; i += 1) {
      const e = await expectError(viewer, () =>
        viewer.emit('room:join', { code: created.code, password: `errada${i}xx` }),
      );
      expect(e.code).toBe('wrong-password');
    }
    const limited = await expectError(viewer, () =>
      viewer.emit('room:join', { code: created.code, password: 'segredo123' }),
    );
    expect(limited.code).toBe('rate-limited');
  });
});

describe('limite de espectadores e de salas', () => {
  it('retorna room-full quando atinge MAX_VIEWERS_PER_ROOM', async () => {
    process.env.MAX_VIEWERS_PER_ROOM = '1';
    const host = await server.createClient();
    const v1 = await server.createClient();
    const v2 = await server.createClient();
    const created = await createRoom(host);
    expect(created.maxViewers).toBe(1);

    await joinRoom(v1, { code: created.code });
    const err = await expectError(v2, () => v2.emit('room:join', { code: created.code }));
    expect(err.code).toBe('room-full');
  });

  it('retorna server-busy quando MAX_ROOMS é atingido', async () => {
    process.env.MAX_ROOMS = '1';
    const h1 = await server.createClient();
    const h2 = await server.createClient();
    await createRoom(h1);
    const err = await expectError(h2, () => h2.emit('room:create'));
    expect(err.code).toBe('server-busy');
  });

  it('join duplicado do mesmo socket não duplica o espectador', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });
    const again = await joinRoom(viewer, { code: created.code });
    expect(again.viewerCount).toBe(1);
    expect(server.roomManager.getRoom(created.roomId)?.viewers.size).toBe(1);
  });
});

describe('aprovação do apresentador', () => {
  it('aprova um pedido e admite o espectador', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host, { requireApproval: true });

    const pending = waitForEvent(viewer, 'room:pending-approval');
    const request = waitForEvent<any>(host, 'room:join-request');
    viewer.emit('room:join', { code: created.code, name: 'João' });
    await pending;
    const req = await request;
    expect(req.viewerId).toBe(viewer.id);
    expect(req.name).toBe('João');

    const joined = waitForEvent<any>(viewer, 'room:joined');
    host.emit('room:respond-join', { viewerId: viewer.id, approved: true });
    expect((await joined).roomId).toBe(created.roomId);
  });

  it('nega um pedido e retorna denied', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host, { requireApproval: true });

    const request = waitForEvent<any>(host, 'room:join-request');
    viewer.emit('room:join', { code: created.code });
    const req = await request;

    const denied = waitForEvent<any>(viewer, 'room:error');
    host.emit('room:respond-join', { viewerId: req.viewerId, approved: false });
    expect((await denied).code).toBe('denied');
  });

  it('expira o pedido por timeout e avisa host e espectador', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host, { requireApproval: true });

    const cancelled = waitForEvent<any>(host, 'room:join-cancelled');
    viewer.emit('room:join', { code: created.code });
    const err = await waitForEvent<any>(viewer, 'room:error');
    expect(err.code).toBe('denied');
    expect((await cancelled).viewerId).toBe(viewer.id);
  });

  it('avisa o host quando o espectador pendente desconecta', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host, { requireApproval: true });

    const request = waitForEvent<any>(host, 'room:join-request');
    viewer.emit('room:join', { code: created.code });
    await request;

    const cancelled = waitForEvent<any>(host, 'room:join-cancelled');
    const viewerId = viewer.id;
    viewer.disconnect();
    expect((await cancelled).viewerId).toBe(viewerId);
  });

  it('ignora room:respond-join vindo de quem não é o host', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const intruder = await server.createClient();
    const created = await createRoom(host, { requireApproval: true });

    const request = waitForEvent<any>(host, 'room:join-request');
    viewer.emit('room:join', { code: created.code });
    await request;

    intruder.emit('room:respond-join', { viewerId: viewer.id, approved: true });
    await sleep(100);
    expect(server.roomManager.getRoom(created.roomId)?.viewers.size).toBe(0);
  });
});

describe('modo privacidade', () => {
  it('só é efetivo quando há TURN configurado', async () => {
    const host = await server.createClient();
    const created = await createRoom(host, { privacyMode: true });
    expect(created.privacyMode).toBe(false);

    process.env.TURN_URLS = 'turn:turn.example.com:3478';
    process.env.TURN_SECRET = 'x'.repeat(32);
    resetIceServersCache();
    const host2 = await server.createClient();
    const created2 = await createRoom(host2, { privacyMode: true });
    expect(created2.privacyMode).toBe(true);
  });
});

describe('robustez contra payloads malformados', () => {
  it('stream:config-update sem payload não derruba o servidor', async () => {
    const host = await server.createClient();
    await createRoom(host);
    host.emit('stream:config-update');
    host.emit('stream:config-update', null);
    host.emit('stream:config-update', 'texto');
    host.emit('stream:config-update', { config: null });
    await sleep(100);
    const other = await server.createClient();
    expect(other.connected).toBe(true);
    expect(host.connected).toBe(true);
  });

  it('eventos sem payload ou com tipos errados são ignorados', async () => {
    const host = await server.createClient();
    await createRoom(host);
    for (const ev of [
      'webrtc:offer',
      'webrtc:answer',
      'webrtc:ice-candidate',
      'stream:quality-request',
      'stream:stats',
      'room:respond-join',
      'room:join',
    ]) {
      host.emit(ev);
      host.emit(ev, null);
      host.emit(ev, 42);
      host.emit(ev, { targetId: 123, emoji: [] });
    }
    await sleep(150);
    expect(host.connected).toBe(true);
    const other = await server.createClient();
    expect(other.connected).toBe(true);
  });
});

describe('relay WebRTC e controle', () => {
  it('encaminha offer/answer/ICE apenas dentro da mesma sala e envolvendo o host', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const outsider = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    const gotOffer = waitForEvent<any>(viewer, 'webrtc:offer');
    host.emit('webrtc:offer', { targetId: viewer.id, offer: { type: 'offer', sdp: 'v=0' } });
    const offer = await gotOffer;
    expect(offer.senderId).toBe(host.id);

    const gotAnswer = waitForEvent<any>(host, 'webrtc:answer');
    viewer.emit('webrtc:answer', { targetId: host.id, answer: { type: 'answer', sdp: 'v=0' } });
    expect((await gotAnswer).senderId).toBe(viewer.id);

    let leaked = false;
    outsider.on('webrtc:offer', () => {
      leaked = true;
    });
    host.emit('webrtc:offer', { targetId: outsider.id, offer: { type: 'offer', sdp: 'v=0' } });
    outsider.emit('webrtc:offer', { targetId: viewer.id, offer: { type: 'offer', sdp: 'v=0' } });
    await sleep(100);
    expect(leaked).toBe(false);
  });

  it('espectadores não conseguem trocar mensagens entre si', async () => {
    const host = await server.createClient();
    const v1 = await server.createClient();
    const v2 = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(v1, { code: created.code });
    await joinRoom(v2, { code: created.code });

    let leaked = false;
    v2.on('webrtc:ice-candidate', () => {
      leaked = true;
    });
    v1.emit('webrtc:ice-candidate', { targetId: v2.id, candidate: { candidate: 'x', sdpMid: '0' } });
    await sleep(100);
    expect(leaked).toBe(false);
  });

  it('stream:stats e config-update só são aceitos do host', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    let received = 0;
    host.on('stream:stats', () => {
      received += 1;
    });
    host.on('stream:config-update', () => {
      received += 1;
    });
    viewer.emit('stream:stats', { latencyMs: 1, packetLossPercent: 0, jitterMs: 0, bitrateKbps: 1 });
    viewer.emit('stream:config-update', { config: { codec: 'H264' } });
    await sleep(100);
    expect(received).toBe(0);
  });
});

describe('segurança: anti-força-bruta, sanitização e concorrência', () => {
  it('limite de senha vale por sala: reconectar (novo socket) não zera as tentativas', async () => {
    const host = await server.createClient();
    const created = await createRoom(host, { password: 'segredo123' });

    // 30 falhas distribuídas em vários sockets (cada um abaixo do limite por socket)
    for (let s = 0; s < 4; s += 1) {
      const viewer = await server.createClient();
      const attempts = s < 3 ? 8 : 6;
      for (let i = 0; i < attempts; i += 1) {
        const e = await expectError(viewer, () =>
          viewer.emit('room:join', { code: created.code, password: `errada${s}${i}x` }),
        );
        expect(['wrong-password', 'rate-limited']).toContain(e.code);
      }
    }

    // Mesmo com a senha CORRETA, a sala está travada para qualquer novo socket
    const fresh = await server.createClient();
    const blocked = await expectError(fresh, () =>
      fresh.emit('room:join', { code: created.code, password: 'segredo123' }),
    );
    expect(blocked.code).toBe('rate-limited');
  });

  it('room:create simultâneos do mesmo socket criam apenas uma sala', async () => {
    const host = await server.createClient();
    let created = 0;
    host.on('room:created', () => {
      created += 1;
    });
    host.emit('room:create', { password: 'segredo123' });
    host.emit('room:create', { password: 'segredo123' });
    host.emit('room:create', { password: 'segredo123' });
    await sleep(500);
    expect(created).toBe(1);
    expect(server.roomManager.listRooms()).toHaveLength(1);
  });

  it('desconectar durante o hash da senha não deixa sala órfã nem espectador fantasma', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host, { password: 'segredo123' });

    viewer.emit('room:join', { code: created.code, password: 'segredo123' });
    viewer.disconnect();
    await sleep(500);

    const room = server.roomManager.getRoom(created.roomId);
    expect(room?.viewers.has(viewer.id as string)).toBe(false);

    // criar sala com senha (hash assíncrono) e desconectar logo em seguida: nenhuma sala órfã
    const ghost = await server.createClient();
    ghost.emit('room:create', { password: 'segredo123' });
    ghost.disconnect();
    await sleep(500);
    expect(server.roomManager.listRooms()).toHaveLength(1); // só a sala do host
  });

  it('stream:config-update do host é reconstruído (sem propriedades extras)', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    const got = waitForEvent<any>(viewer, 'stream:config-update');
    host.emit('stream:config-update', {
      config: {
        video: { width: 1280, height: 720, frameRate: 30, codec: 'H264', bitrate: 3000, quality: 'medium', x: 1 },
        audio: { sampleRate: 48000, bitrate: 128, codec: 'opus', sources: [], y: 2 },
        evil: 'payload',
      },
      evil2: 'x',
    });
    const payload = await got;
    expect(payload.config.evil).toBeUndefined();
    expect(payload.config.video.x).toBeUndefined();
    expect(payload.config.audio.y).toBeUndefined();
    expect(payload.evil2).toBeUndefined();
  });

  it('stream:stats com enum inválido não é retransmitido; válido é limpo', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code });

    const base = {
      fps: 30, videoBitrate: 1, audioBitrate: 1, latencyMs: 1, packetsLost: 0,
      lossPercent: 0, jitterMs: 0, timestamp: 1, qualityLimitation: 'none', connectionQuality: 'good',
    };
    let count = 0;
    viewer.on('stream:stats', () => {
      count += 1;
    });
    host.emit('stream:stats', { ...base, connectionQuality: '<script>' });
    await sleep(150);
    expect(count).toBe(0);

    const got = waitForEvent<any>(viewer, 'stream:stats');
    host.emit('stream:stats', { ...base, evil: 'x' });
    const stats = await got;
    expect(stats.evil).toBeUndefined();
    expect(stats.connectionQuality).toBe('good');
  });
});

describe('co-apresentação direta (sem aprovação do host)', () => {
  it('espectador inicia na hora; host e sala são notificados e o host recebe o hostId', async () => {
    const host = await server.createClient();
    const viewer = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(viewer, { code: created.code, name: 'Maria' });

    const joinedOnHost = waitForEvent<any>(host, 'room:copresenter-joined');
    const response = waitForEvent<any>(viewer, 'room:copresent-response');
    viewer.emit('room:start-copresent', { name: 'Maria' });

    expect(await response).toEqual({ accepted: true, hostId: host.id });
    expect((await joinedOnHost).copresenterId).toBe(viewer.id);
  });

  it('a vaga é única: o segundo espectador recebe accepted=false', async () => {
    const host = await server.createClient();
    const v1 = await server.createClient();
    const v2 = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(v1, { code: created.code });
    await joinRoom(v2, { code: created.code });

    const first = waitForEvent<any>(v1, 'room:copresent-response');
    v1.emit('room:start-copresent', {});
    expect((await first).accepted).toBe(true);

    const second = waitForEvent<any>(v2, 'room:copresent-response');
    v2.emit('room:start-copresent', {});
    expect((await second).accepted).toBe(false);
  });

  it('room:stop-copresent libera a vaga e avisa a sala', async () => {
    const host = await server.createClient();
    const v1 = await server.createClient();
    const v2 = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(v1, { code: created.code });
    await joinRoom(v2, { code: created.code });

    const ok = waitForEvent<any>(v1, 'room:copresent-response');
    v1.emit('room:start-copresent', {});
    await ok;

    const left = waitForEvent<any>(host, 'room:copresenter-left');
    v1.emit('room:stop-copresent');
    expect((await left).copresenterId).toBe(v1.id);

    const again = waitForEvent<any>(v2, 'room:copresent-response');
    v2.emit('room:start-copresent', {});
    expect((await again).accepted).toBe(true);
  });

  it('o host não pode co-apresentar e quem não está na sala é ignorado', async () => {
    const host = await server.createClient();
    const outsider = await server.createClient();
    await createRoom(host);

    let got = false;
    host.on('room:copresent-response', () => { got = true; });
    outsider.on('room:copresent-response', () => { got = true; });
    host.emit('room:start-copresent', {});
    outsider.emit('room:start-copresent', {});
    await sleep(150);
    expect(got).toBe(false);
  });

  it('desconectar o co-apresentador libera a vaga', async () => {
    const host = await server.createClient();
    const v1 = await server.createClient();
    const created = await createRoom(host);
    await joinRoom(v1, { code: created.code });

    const ok = waitForEvent<any>(v1, 'room:copresent-response');
    v1.emit('room:start-copresent', {});
    await ok;

    const v1Id = v1.id;
    const left = waitForEvent<any>(host, 'room:copresenter-left');
    v1.disconnect();
    expect((await left).copresenterId).toBe(v1Id);
  });
});

describe('link fixo: código preferencial', () => {
  it('reutiliza o código pedido quando está livre e gera outro se estiver em uso', async () => {
    const h1 = await server.createClient();
    const h2 = await server.createClient();
    const first = await createRoom(h1, { preferredCode: 'ABC234' });
    expect(first.code).toBe('ABC234');
    const second = await createRoom(h2, { preferredCode: 'ABC234' });
    expect(second.code).not.toBe('ABC234');
  });
});
