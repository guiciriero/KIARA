/**
 * lowLatency.test.ts (serviço)
 * Integração do modo "baixa latência" com o WebRTCViewer: roteamento dos receivers e watchdog.
 * O worker em si (WebCodecs + WebGL) só existe no navegador e foi validado no Chrome headless.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WebRTCViewer } from './webrtcService';
import type { LowLatencyVideoSink } from './lowLatencyRenderer';
import type { E2eeTransform } from './e2ee';
import { VIDEO_STALL_TIMEOUT_MS } from './webrtcShared';
import { FakeSocket, FakeRTCPeerConnection, installRtcGlobals } from '../test/rtcFakes';

const offer = { senderId: 'host-1', offer: { type: 'offer', sdp: 'v=0\r\no=host\r\n' } };

function fakeSink(framesRendered = 0) {
  const attached: RTCRtpReceiver[] = [];
  const sink: LowLatencyVideoSink & { framesRendered: number } = {
    framesRendered,
    attachVideoReceiver: (r) => {
      attached.push(r);
    },
  };
  return { sink, attached };
}

describe('WebRTCViewer em modo baixa latência', () => {
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

  async function receiveOffer() {
    socket.simulateEvent('webrtc:offer', offer);
    await vi.waitFor(() => expect(socket.getEmissions('webrtc:answer')).toHaveLength(1));
    return FakeRTCPeerConnection.instances[0];
  }

  it('manda só o receiver de VÍDEO para o worker de baixa latência', async () => {
    const { sink, attached } = fakeSink();
    const viewer = new WebRTCViewer(socket as unknown as never, 'host-1', [], undefined, sink);
    const pc = await receiveOffer();

    expect(attached).toHaveLength(1);
    const video = pc.transceivers.find((t) => t.receiver.track.kind === 'video');
    expect((attached[0] as unknown) === video?.receiver).toBe(true);
    viewer.destroy();
  });

  it('em sala E2EE o áudio segue pela E2EE comum e o vídeo NÃO passa por ela (o worker decifra)', async () => {
    const { sink, attached } = fakeSink();
    const protectedReceivers: RTCRtpReceiver[] = [];
    const e2ee: E2eeTransform = {
      protectSender: () => undefined,
      protectReceiver: (r) => {
        protectedReceivers.push(r);
      },
      destroy: () => undefined,
    };
    const viewer = new WebRTCViewer(socket as unknown as never, 'host-1', [], e2ee, sink);
    const pc = await receiveOffer();

    expect(attached).toHaveLength(1);
    expect(protectedReceivers).toHaveLength(1);
    const audio = pc.transceivers.find((t) => t.receiver.track.kind === 'audio');
    expect((protectedReceivers[0] as unknown) === audio?.receiver).toBe(true);
    viewer.destroy();
  });

  it('sem o modo, tudo segue como antes (nenhum receiver desviado)', async () => {
    const viewer = new WebRTCViewer(socket as unknown as never, 'host-1');
    await receiveOffer();
    viewer.destroy();
  });

  describe('vigia de tela preta', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('quadros desenhados no canvas contam como vídeo ok, mesmo com framesDecoded 0', async () => {
      const { sink } = fakeSink(5);
      const viewer = new WebRTCViewer(socket as unknown as never, 'host-1', [], undefined, sink);
      const status = vi.fn();
      viewer.onVideoStatus(status);
      socket.simulateEvent('webrtc:offer', offer);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1100);
      expect(status).toHaveBeenCalledExactlyOnceWith(true);
      viewer.destroy();
    });

    it('nada desenhado e nada decodificado dentro do prazo ⇒ falha (refaz a entrada)', async () => {
      const { sink } = fakeSink(0);
      const viewer = new WebRTCViewer(socket as unknown as never, 'host-1', [], undefined, sink);
      const status = vi.fn();
      viewer.onVideoStatus(status);
      socket.simulateEvent('webrtc:offer', offer);
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(VIDEO_STALL_TIMEOUT_MS + 2000);
      expect(status).toHaveBeenCalledExactlyOnceWith(false);
      viewer.destroy();
    });
  });
});
