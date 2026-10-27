/**
 * e2ee.test.ts
 * Integração da criptografia de ponta a ponta com o WebRTCBroadcaster e o WebRTCViewer, usando
 * uma transformação falsa: o que se verifica é que NENHUM sender/receiver fica sem proteção e que
 * a sala E2EE só negocia VP9/VP8.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebRTCBroadcaster, WebRTCViewer } from './webrtcService';
import { e2eeCodecs, E2EE_VIDEO_CODEC } from './webrtcShared';
import type { E2eeTransform } from './e2ee';
import {
  FakeSocket,
  FakeMediaStream,
  FakeMediaStreamTrack,
  FakeRTCPeerConnection,
  installRtcGlobals,
} from '../test/rtcFakes';
import type { VideoConfig } from '@shared/index';

const config: VideoConfig = { width: 1920, height: 1080, frameRate: 60, codec: 'auto', bitrate: 8000, quality: 'high' };

function fakeE2ee() {
  const senders: RTCRtpSender[] = [];
  const receivers: RTCRtpReceiver[] = [];
  const e2ee: E2eeTransform = {
    protectSender: (s) => { senders.push(s); },
    protectReceiver: (r) => { receivers.push(r); },
    destroy: vi.fn(),
  };
  return { e2ee, senders, receivers };
}

describe('e2eeCodecs', () => {
  it('mantém só VP9, VP8 e RTX (H.264, H.265 e AV1 falham na cifra de quadros)', () => {
    const codecs = [
      { mimeType: 'video/AV1' },
      { mimeType: 'video/H264' },
      { mimeType: 'video/H265' },
      { mimeType: 'video/VP9' },
      { mimeType: 'video/VP8' },
      { mimeType: 'video/rtx' },
      { mimeType: 'video/red' },
    ];
    expect(e2eeCodecs(codecs).map((c) => c.mimeType)).toEqual(['video/VP9', 'video/VP8', 'video/rtx']);
    expect(E2EE_VIDEO_CODEC).toBe('VP9');
  });
});

describe('WebRTCBroadcaster em sala E2EE', () => {
  let restore: () => void;
  let socket: FakeSocket;

  beforeEach(() => {
    restore = installRtcGlobals();
    socket = new FakeSocket();
  });
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  async function connectViewer(id: string) {
    socket.simulateEvent('room:viewer-joined', { viewerId: id });
    await vi.waitFor(() => expect(socket.getEmissions('webrtc:offer').length).toBeGreaterThan(0));
    return FakeRTCPeerConnection.instances[FakeRTCPeerConnection.instances.length - 1];
  }

  it('protege todos os senders (vídeo e áudio) e negocia só VP9/VP8, ignorando o modo auto', async () => {
    const { e2ee, senders } = fakeE2ee();
    const broadcaster = new WebRTCBroadcaster(socket as unknown as never, config, {
      iceServers: [], privacyMode: false, maxViewers: 0, e2ee,
    });
    broadcaster.setLocalStream(
      new FakeMediaStream([new FakeMediaStreamTrack('video'), new FakeMediaStreamTrack('audio')]) as unknown as MediaStream,
    );

    const pc = await connectViewer('viewer-1');
    expect(senders).toHaveLength(2);
    expect(senders.every((s) => pc.getSenders().includes(s))).toBe(true);

    const video = pc.transceivers.find((t) => t.sender.track?.kind === 'video');
    const mimes = video?.preferredCodecs.map((c) => c.mimeType);
    expect(mimes?.[0]).toBe('video/VP9');
    expect(mimes).not.toContain('video/H264');
    broadcaster.destroy();
  });

  it('protege o transceiver de áudio criado quando a captura não tem áudio', async () => {
    const { e2ee, senders } = fakeE2ee();
    const broadcaster = new WebRTCBroadcaster(socket as unknown as never, config, {
      iceServers: [], privacyMode: false, maxViewers: 0, e2ee,
    });
    broadcaster.setLocalStream(new FakeMediaStream([new FakeMediaStreamTrack('video')]) as unknown as MediaStream);

    await connectViewer('viewer-2');
    expect(senders).toHaveLength(2);
    broadcaster.destroy();
  });

  it('protege os transceivers criados antes de haver stream local', async () => {
    const { e2ee, senders } = fakeE2ee();
    const broadcaster = new WebRTCBroadcaster(socket as unknown as never, config, {
      iceServers: [], privacyMode: false, maxViewers: 0, e2ee,
    });
    await connectViewer('viewer-3');
    expect(senders).toHaveLength(2);
    broadcaster.destroy();
  });

  it('protege o sender novo criado por replaceVideoTrack e por setLocalStream tardio', async () => {
    const { e2ee, senders } = fakeE2ee();
    const broadcaster = new WebRTCBroadcaster(socket as unknown as never, config, {
      iceServers: [], privacyMode: false, maxViewers: 0, e2ee,
    });
    await connectViewer('viewer-4');
    expect(senders).toHaveLength(2);

    // Os transceivers sendonly criados sem faixa não têm track: replaceVideoTrack adiciona um sender novo
    await broadcaster.replaceVideoTrack(new FakeMediaStreamTrack('video') as unknown as MediaStreamTrack);
    expect(senders.length).toBeGreaterThan(2);

    const before = senders.length;
    broadcaster.setLocalStream(
      new FakeMediaStream([new FakeMediaStreamTrack('video'), new FakeMediaStreamTrack('audio')]) as unknown as MediaStream,
    );
    // Cada faixa sem sender com track do mesmo tipo recebe proteção; nunca fica sender novo sem ela
    const pc = FakeRTCPeerConnection.instances[0];
    for (const sender of pc.getSenders()) {
      if (sender.track) expect(senders).toContain(sender);
    }
    expect(senders.length).toBeGreaterThanOrEqual(before);
    broadcaster.destroy();
  });

  it('sem e2ee mantém o comportamento anterior (modo auto cai no H.264)', async () => {
    const broadcaster = new WebRTCBroadcaster(socket as unknown as never, config);
    broadcaster.setLocalStream(
      new FakeMediaStream([new FakeMediaStreamTrack('video'), new FakeMediaStreamTrack('audio')]) as unknown as MediaStream,
    );
    const pc = await connectViewer('viewer-5');
    const video = pc.transceivers.find((t) => t.sender.track?.kind === 'video');
    expect(video?.preferredCodecs[0].mimeType).toBe('video/H264');
    broadcaster.destroy();
  });
});

describe('WebRTCViewer em sala E2EE', () => {
  let restore: () => void;
  let socket: FakeSocket;

  beforeEach(() => {
    restore = installRtcGlobals();
    socket = new FakeSocket();
  });
  afterEach(() => {
    restore();
    vi.restoreAllMocks();
  });

  it('decifra os dois receivers já na criação dos transceivers', async () => {
    const { e2ee, receivers } = fakeE2ee();
    const viewer = new WebRTCViewer(socket as unknown as never, 'host-1', [], e2ee);
    socket.simulateEvent('webrtc:offer', { senderId: 'host-1', offer: { type: 'offer', sdp: 'v=0\r\no=host\r\n' } });
    await vi.waitFor(() => expect(socket.getEmissions('webrtc:answer')).toHaveLength(1));

    const pc = FakeRTCPeerConnection.instances[0];
    expect(receivers).toHaveLength(2);
    expect(receivers.every((r) => pc.transceivers.some((t) => (t.receiver as unknown) === r))).toBe(true);
    viewer.destroy();
  });

  it('protege também o receiver do evento ontrack', async () => {
    const { e2ee, receivers } = fakeE2ee();
    const viewer = new WebRTCViewer(socket as unknown as never, 'host-1', [], e2ee);
    socket.simulateEvent('webrtc:offer', { senderId: 'host-1', offer: { type: 'offer', sdp: 'v=0\r\no=host\r\n' } });
    await vi.waitFor(() => expect(socket.getEmissions('webrtc:answer')).toHaveLength(1));

    const pc = FakeRTCPeerConnection.instances[0];
    const receiver = { track: new FakeMediaStreamTrack('video') } as unknown as RTCRtpReceiver;
    pc.ontrack?.call(pc as unknown as RTCPeerConnection, {
      streams: [new FakeMediaStream([]) as unknown as MediaStream],
      receiver,
    } as unknown as RTCTrackEvent);
    expect(receivers).toContain(receiver);
    viewer.destroy();
  });

  it('sem e2ee não protege nada (sala comum inalterada)', async () => {
    const viewer = new WebRTCViewer(socket as unknown as never, 'host-1');
    socket.simulateEvent('webrtc:offer', { senderId: 'host-1', offer: { type: 'offer', sdp: 'v=0\r\no=host\r\n' } });
    await vi.waitFor(() => expect(socket.getEmissions('webrtc:answer')).toHaveLength(1));
    viewer.destroy();
  });
});
