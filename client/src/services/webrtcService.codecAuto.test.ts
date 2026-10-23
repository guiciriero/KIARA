/**
 * Modo de codec 'auto' no WebRTCBroadcaster: HEVC por espectador quando os dois lados
 * têm hardware; H.264 caso contrário; escolha manual intocada.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { VideoConfig } from '@shared/index';

const hwEncode = vi.hoisted(() => ({ value: ['H265', 'H264'] as string[] | undefined }));

vi.mock('./codecSelection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./codecSelection')>();
  return { ...actual, detectBroadcasterHwEncode: async () => hwEncode.value };
});

import { WebRTCBroadcaster } from './webrtcService';
import {
  FakeSocket,
  FakeMediaStream,
  FakeMediaStreamTrack,
  FakeRTCPeerConnection,
  installRtcGlobals,
} from '../test/rtcFakes';

const baseConfig: VideoConfig = {
  width: 1920,
  height: 1080,
  frameRate: 60,
  codec: 'auto',
  bitrate: 8000,
  quality: 'high',
};

describe('WebRTCBroadcaster — codec automático', () => {
  let restoreGlobals: () => void;
  let socket: FakeSocket;

  beforeEach(() => {
    restoreGlobals = installRtcGlobals();
    // Capabilities com HEVC (o fake padrão não tem)
    (globalThis.RTCRtpSender as unknown) = {
      getCapabilities: () => ({
        codecs: [
          { mimeType: 'video/VP8', clockRate: 90000 },
          { mimeType: 'video/H264', clockRate: 90000, sdpFmtpLine: 'packetization-mode=1;profile-level-id=640032' },
          { mimeType: 'video/H265', clockRate: 90000, sdpFmtpLine: 'level-id=123;profile-id=1;tier-flag=0;tx-mode=SRST' },
          { mimeType: 'video/VP9', clockRate: 90000 },
        ],
        headerExtensions: [],
      }),
    };
    hwEncode.value = ['H265', 'H264'];
    socket = new FakeSocket();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  async function connect(viewerId: string, hwDecode?: string[]) {
    const before = FakeRTCPeerConnection.instances.length;
    socket.simulateEvent('room:viewer-joined', { viewerId, viewerCount: 1, hwDecode });
    await vi.waitFor(() => expect(FakeRTCPeerConnection.instances.length).toBe(before + 1));
    const pc = FakeRTCPeerConnection.instances[before];
    const video = pc.transceivers.find((t) => t.sender.track?.kind === 'video')!;
    await vi.waitFor(() => expect(video.preferredCodecs.length).toBeGreaterThan(0));
    return video.preferredCodecs.map((c) => c.mimeType);
  }

  function makeBroadcaster(cfg: Partial<VideoConfig> = {}) {
    const b = new WebRTCBroadcaster(socket as unknown as never, { ...baseConfig, ...cfg });
    b.setLocalStream(new FakeMediaStream([new FakeMediaStreamTrack('video')]) as unknown as MediaStream);
    return b;
  }

  it('usa HEVC (com H.264 logo depois) quando encode e decode são por hardware', async () => {
    const b = makeBroadcaster();
    const order = await connect('v1', ['H265', 'H264']);
    expect(order.slice(0, 2)).toEqual(['video/H265', 'video/H264']);
    b.destroy();
  });

  it('usa H.264 primeiro quando o espectador não decodifica HEVC por hardware', async () => {
    const b = makeBroadcaster();
    const order = await connect('v1', ['H264']);
    expect(order[0]).toBe('video/H264');
    b.destroy();
  });

  it('usa H.264 quando o espectador não informou hwDecode', async () => {
    const b = makeBroadcaster();
    const order = await connect('v1');
    expect(order[0]).toBe('video/H264');
    b.destroy();
  });

  it('usa H.264 quando o apresentador não codifica HEVC por hardware', async () => {
    hwEncode.value = [];
    const b = makeBroadcaster();
    const order = await connect('v1', ['H265']);
    expect(order[0]).toBe('video/H264');
    b.destroy();
  });

  it('decide por espectador: um com HEVC e outro sem', async () => {
    const b = makeBroadcaster();
    const first = await connect('v1', ['H265']);
    const second = await connect('v2', ['H264']);
    expect(first[0]).toBe('video/H265');
    expect(second[0]).toBe('video/H264');
    b.destroy();
  });

  it('escolha manual não é alterada pelo hwDecode do espectador', async () => {
    const b = makeBroadcaster({ codec: 'H264' });
    const order = await connect('v1', ['H265']);
    expect(order[0]).toBe('video/H264');
    b.destroy();

    const b2 = makeBroadcaster({ codec: 'H265' });
    const order2 = await connect('v2', []);
    expect(order2[0]).toBe('video/H265');
    b2.destroy();
  });
});
