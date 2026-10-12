/**
 * webrtcService.test.ts
 *
 * Testes unitários para o subsistema WebRTC:
 * ordenação de codecs, WebRTCBroadcaster e WebRTCViewer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { orderCodecs, WebRTCBroadcaster, WebRTCViewer } from './webrtcService';
import type { RTCRtpCodecCapability } from './webrtcService';
import {
  FakeSocket,
  FakeMediaStream,
  FakeMediaStreamTrack,
  FakeRTCPeerConnection,
  createMockStatsReport,
  installRtcGlobals,
} from '../test/rtcFakes';
import type { VideoConfig, StreamStats, RTCIceCandidatePayload } from '@shared/index';

const mockVideoConfig: VideoConfig = {
  width: 1920,
  height: 1080,
  frameRate: 60,
  codec: 'H264',
  bitrate: 5000,
  quality: 'high',
};

describe('webrtcService', () => {
  let restoreGlobals: () => void;
  let socket: FakeSocket;

  beforeEach(() => {
    restoreGlobals = installRtcGlobals();
    socket = new FakeSocket();
  });

  afterEach(() => {
    restoreGlobals();
    vi.restoreAllMocks();
  });

  describe('orderCodecs', () => {
    const sampleCodecs: RTCRtpCodecCapability[] = [
      { mimeType: 'video/VP8', clockRate: 90000 },
      {
        mimeType: 'video/H264',
        clockRate: 90000,
        sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f',
      },
      {
        mimeType: 'video/H264',
        clockRate: 90000,
        sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640032',
      },
      { mimeType: 'video/VP9', clockRate: 90000 },
      { mimeType: 'video/rtx', clockRate: 90000 },
    ];

    it('prioriza H264 High Profile (profile-level-id=64) com packetization-mode=1', () => {
      const ordered = orderCodecs(sampleCodecs, 'H264');
      expect(ordered[0].mimeType).toBe('video/H264');
      expect(ordered[0].sdpFmtpLine).toContain('profile-level-id=640032');
      expect(ordered[1].mimeType).toBe('video/H264');
      expect(ordered[1].sdpFmtpLine).toContain('profile-level-id=42e01f');
      expect(ordered[2].mimeType).toBe('video/VP8');
      expect(ordered[3].mimeType).toBe('video/VP9');
      expect(ordered[4].mimeType).toBe('video/rtx');
    });

    it('prioriza VP9 mantendo ordem dos demais quando solicitado', () => {
      const ordered = orderCodecs(sampleCodecs, 'VP9');
      expect(ordered[0].mimeType).toBe('video/VP9');
      expect(ordered[1].mimeType).toBe('video/VP8');
      expect(ordered[2].mimeType).toBe('video/H264');
      expect(ordered[4].mimeType).toBe('video/rtx');
    });

    it('retorna array vazio para lista vazia de codecs', () => {
      expect(orderCodecs([], 'H264')).toEqual([]);
    });
  });

  describe('WebRTCBroadcaster', () => {
    it('cria oferta WebRTC ao receber room:viewer-joined', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      const videoTrack = new FakeMediaStreamTrack('video');
      const audioTrack = new FakeMediaStreamTrack('audio');
      const stream = new FakeMediaStream([videoTrack, audioTrack]);
      broadcaster.setLocalStream(stream as unknown as MediaStream);

      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-1' });

      // Aguarda criação assíncrona da offer
      await vi.waitFor(() => {
        const offers = socket.getEmissions('webrtc:offer');
        expect(offers.length).toBe(1);
      });

      const offerEmission = socket.getEmissions('webrtc:offer')[0] as {
        targetId: string;
        offer: RTCSessionDescriptionInit;
      };
      expect(offerEmission.targetId).toBe('viewer-1');
      expect(offerEmission.offer.type).toBe('offer');

      broadcaster.destroy();
    });

    it('adiciona transceiver de áudio caso localStream não possua faixa de áudio', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      const videoTrack = new FakeMediaStreamTrack('video');
      const stream = new FakeMediaStream([videoTrack]);
      broadcaster.setLocalStream(stream as unknown as MediaStream);

      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-audio-check' });

      await vi.waitFor(() => {
        expect(socket.getEmissions('webrtc:offer').length).toBe(1);
      });

      const pc = FakeRTCPeerConnection.instances[0];
      const audioTransceiver = pc.transceivers.find((t) => t.receiver.track.kind === 'audio');
      expect(audioTransceiver).toBeDefined();

      broadcaster.destroy();
    });

    it('executa cleanup do peer ao receber room:viewer-left', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-1' });

      await vi.waitFor(() => {
        expect(FakeRTCPeerConnection.instances.length).toBe(1);
      });

      const pc = FakeRTCPeerConnection.instances[0];
      expect(pc.isClosed).toBe(false);

      socket.simulateEvent('room:viewer-left', { viewerId: 'viewer-1' });
      expect(pc.isClosed).toBe(true);

      broadcaster.destroy();
    });

    it('dispara ICE restart imediatamente quando a conexão atinge estado failed', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-failed' });

      await vi.waitFor(() => {
        expect(FakeRTCPeerConnection.instances.length).toBe(1);
      });

      const pc = FakeRTCPeerConnection.instances[0];
      pc.simulateConnectionState('failed');

      await vi.waitFor(() => {
        expect(pc.restartIceCount).toBe(1);
        const offers = socket.getEmissions('webrtc:offer');
        expect(offers.length).toBe(2);
      });

      broadcaster.destroy();
    });

    it('ignora o segundo evento failed (connectionState + iceConnectionState) e envia só um restart', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-dup' });
      await vi.waitFor(() => expect(FakeRTCPeerConnection.instances.length).toBe(1));

      const pc = FakeRTCPeerConnection.instances[0];
      pc.simulateConnectionState('failed');
      pc.simulateIceConnectionState('failed');

      await vi.waitFor(() => expect(socket.getEmissions('webrtc:offer').length).toBe(2));
      await new Promise((r) => setTimeout(r, 20));
      expect(pc.restartIceCount).toBe(1);
      expect(socket.getEmissions('webrtc:offer').length).toBe(2);

      broadcaster.destroy();
    });

    it('dispara ICE restart em disconnected apenas após o período de grace (3000ms)', async () => {
      vi.useFakeTimers();
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-disc' });

      await vi.advanceTimersByTimeAsync(10);
      const pc = FakeRTCPeerConnection.instances[0];
      expect(pc).toBeDefined();

      // Muda para disconnected
      pc.simulateConnectionState('disconnected');
      expect(pc.restartIceCount).toBe(0);

      // Avança 2000ms (ainda no grace) -> não dispara
      await vi.advanceTimersByTimeAsync(2000);
      expect(pc.restartIceCount).toBe(0);

      // Avança mais 1500ms (total > 3000ms) -> dispara ICE restart
      await vi.advanceTimersByTimeAsync(1500);
      expect(pc.restartIceCount).toBe(1);

      vi.useRealTimers();
      broadcaster.destroy();
    });

    it('cancela timer de grace e não reinicia ICE se a conexão recuperar antes dos 3000ms', async () => {
      vi.useFakeTimers();
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-recover' });

      await vi.advanceTimersByTimeAsync(10);
      const pc = FakeRTCPeerConnection.instances[0];

      pc.simulateConnectionState('disconnected');
      await vi.advanceTimersByTimeAsync(1500);

      // Recupera conexão
      pc.simulateConnectionState('connected');

      // Avança além do grace inicial
      await vi.advanceTimersByTimeAsync(2000);
      expect(pc.restartIceCount).toBe(0);

      vi.useRealTimers();
      broadcaster.destroy();
    });

    it('recria o peer do zero após esgotar o limite máximo de tentativas de ICE restart (3x)', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-max-restart' });

      await vi.waitFor(() => {
        expect(FakeRTCPeerConnection.instances.length).toBe(1);
      });

      const initialPc = FakeRTCPeerConnection.instances[0];

      // 3 tentativas de restart
      initialPc.simulateConnectionState('failed');
      await vi.waitFor(() => expect(initialPc.restartIceCount).toBe(1));

      initialPc.simulateConnectionState('connecting');
      initialPc.simulateConnectionState('failed');
      await vi.waitFor(() => expect(initialPc.restartIceCount).toBe(2));

      initialPc.simulateConnectionState('connecting');
      initialPc.simulateConnectionState('failed');
      await vi.waitFor(() => expect(initialPc.restartIceCount).toBe(3));

      // 4ª falha -> deve fechar o peer antigo e criar um novo
      initialPc.simulateConnectionState('connecting');
      initialPc.simulateConnectionState('failed');
      await vi.waitFor(() => {
        expect(initialPc.isClosed).toBe(true);
        expect(FakeRTCPeerConnection.instances.length).toBe(2);
      });

      broadcaster.destroy();
    });

    it('bufferiza candidatos ICE recebidos antes da answer e aplica-os após setRemoteDescription', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-buf' });

      await vi.waitFor(() => {
        expect(FakeRTCPeerConnection.instances.length).toBe(1);
      });

      const pc = FakeRTCPeerConnection.instances[0];

      const candidate1: RTCIceCandidatePayload = {
        candidate: 'candidate:1 1 UDP 2122260223 192.168.1.1 50000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      };

      // Envia candidato ICE antes da answer
      socket.simulateEvent('webrtc:ice-candidate', {
        senderId: 'viewer-buf',
        candidate: candidate1,
      });

      expect(pc.appliedIceCandidates.length).toBe(0);

      // Agora chega a answer
      socket.simulateEvent('webrtc:answer', {
        senderId: 'viewer-buf',
        answer: { type: 'answer', sdp: 'v=0\r\no=viewer\r\n' },
      });

      await vi.waitFor(() => {
        expect(pc.appliedIceCandidates.length).toBe(1);
        expect(pc.appliedIceCandidates[0].candidate).toBe(candidate1.candidate);
      });

      broadcaster.destroy();
    });

    it('replaceVideoTrack substitui faixas sem criar nova offer, para a faixa antiga e atualiza localStream', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      const oldTrack = new FakeMediaStreamTrack('video', 'old-v');
      const stream = new FakeMediaStream([oldTrack]);
      broadcaster.setLocalStream(stream as unknown as MediaStream);

      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-rep' });
      await vi.waitFor(() => expect(socket.getEmissions('webrtc:offer').length).toBe(1));

      const newTrack = new FakeMediaStreamTrack('video', 'new-v');
      await broadcaster.replaceVideoTrack(newTrack as unknown as MediaStreamTrack);

      expect(oldTrack.stopped).toBe(true);
      expect(stream.getVideoTracks()[0].id).toBe('new-v');
      expect((newTrack as unknown as FakeMediaStreamTrack).contentHint).toBe('motion');

      // Não deve ter emitido nova offer
      expect(socket.getEmissions('webrtc:offer').length).toBe(1);

      broadcaster.destroy();
    });

    it('replaceVideoTrack rejeita com Error se algum sender falhar', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      const oldTrack = new FakeMediaStreamTrack('video');
      const stream = new FakeMediaStream([oldTrack]);
      broadcaster.setLocalStream(stream as unknown as MediaStream);

      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-err' });
      await vi.waitFor(() => expect(FakeRTCPeerConnection.instances.length).toBe(1));

      const pc = FakeRTCPeerConnection.instances[0];
      const videoSender = pc.senders.find((s) => s.track?.kind === 'video');
      if (videoSender) {
        videoSender.failReplaceTrack = true;
      }

      const newTrack = new FakeMediaStreamTrack('video');
      await expect(broadcaster.replaceVideoTrack(newTrack as unknown as MediaStreamTrack)).rejects.toThrow();

      broadcaster.destroy();
    });

    it('updateVideoConfig atualiza parâmetros dos senders e alvo do bitrateController', async () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      const track = new FakeMediaStreamTrack('video');
      const stream = new FakeMediaStream([track]);
      broadcaster.setLocalStream(stream as unknown as MediaStream);

      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-cfg' });
      await vi.waitFor(() => expect(FakeRTCPeerConnection.instances.length).toBe(1));

      const pc = FakeRTCPeerConnection.instances[0];
      const sender = pc.senders.find((s) => s.track?.kind === 'video');

      await broadcaster.updateVideoConfig({ bitrate: 8000, frameRate: 30 });
      expect(sender?.parameters.encodings[0].maxBitrate).toBe(8000000);
      expect(sender?.parameters.encodings[0].maxFramerate).toBe(30);

      broadcaster.destroy();
    });

    it('destroy fecha conexões, remove apenas os próprios listeners e NÃO para as faixas de localStream', () => {
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);
      const videoTrack = new FakeMediaStreamTrack('video');
      const stream = new FakeMediaStream([videoTrack]);
      broadcaster.setLocalStream(stream as unknown as MediaStream);

      const otherListener = vi.fn();
      socket.on('room:viewer-joined', otherListener);

      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-dest' });

      broadcaster.destroy();

      expect(videoTrack.stopped).toBe(false);

      // O listener de outro módulo continua preservado
      socket.simulateEvent('room:viewer-joined', { viewerId: 'viewer-other' });
      expect(otherListener).toHaveBeenCalledTimes(2);
    });

    it('agrega estatísticas de múltiplos peers emitindo pior latência/perda/jitter e primeira taxa válida', async () => {
      vi.useFakeTimers();
      const broadcaster = new WebRTCBroadcaster(socket as unknown as never, mockVideoConfig);

      socket.simulateEvent('room:viewer-joined', { viewerId: 'p1' });
      socket.simulateEvent('room:viewer-joined', { viewerId: 'p2' });
      await vi.advanceTimersByTimeAsync(10);

      const pc1 = FakeRTCPeerConnection.instances[0];
      const pc2 = FakeRTCPeerConnection.instances[1];

      pc1.mockStatsReport = createMockStatsReport([
        { id: 'v1', type: 'outbound-rtp', kind: 'video', framesPerSecond: 60, bytesSent: 500000, packetsSent: 500, qualityLimitationReason: 'none' },
        { id: 'r1', type: 'remote-inbound-rtp', kind: 'video', packetsLost: 2, jitter: 0.005, roundTripTime: 0.02 },
      ]);

      pc2.mockStatsReport = createMockStatsReport([
        { id: 'v2', type: 'outbound-rtp', kind: 'video', framesPerSecond: 58, bytesSent: 480000, packetsSent: 480, qualityLimitationReason: 'bandwidth' },
        { id: 'r2', type: 'remote-inbound-rtp', kind: 'video', packetsLost: 15, jitter: 0.025, roundTripTime: 0.18 },
      ]);

      let emittedStats: StreamStats | null = null;
      broadcaster.onStats((stats) => {
        emittedStats = stats;
      });

      // Avança 2000ms para disparar intervalo de métricas
      await vi.advanceTimersByTimeAsync(2000);

      expect(emittedStats).not.toBeNull();
      if (emittedStats) {
        const stats: StreamStats = emittedStats;
        expect(stats.fps).toBe(60);
        expect(stats.latencyMs).toBe(180); // Pior caso (0.18s vs 0.02s)
        expect(stats.jitterMs).toBe(25);   // Pior caso (25ms vs 5ms)
        expect(stats.qualityLimitation).toBe('bandwidth'); // Pior limitação
      }

      vi.useRealTimers();
      broadcaster.destroy();
    });
  });

  describe('WebRTCViewer', () => {
    it('cria conexão, processa oferta do host e emite answer', async () => {
      const viewer = new WebRTCViewer(socket as unknown as never, 'host-1');
      let remoteStreamReceived: MediaStream | null = null;
      viewer.onStream((stream) => {
        remoteStreamReceived = stream;
      });

      socket.simulateEvent('webrtc:offer', {
        senderId: 'host-1',
        offer: { type: 'offer', sdp: 'v=0\r\no=host\r\n' },
      });

      await vi.waitFor(() => {
        const answers = socket.getEmissions('webrtc:answer');
        expect(answers.length).toBe(1);
      });

      const answer = socket.getEmissions('webrtc:answer')[0] as {
        targetId: string;
        answer: RTCSessionDescriptionInit;
      };
      expect(answer.targetId).toBe('host-1');
      expect(answer.answer.type).toBe('answer');

      const pc = FakeRTCPeerConnection.instances[0];
      const mockStream = new FakeMediaStream([]) as unknown as MediaStream;
      if (pc.ontrack) {
        pc.ontrack.call(pc as unknown as RTCPeerConnection, {
          streams: [mockStream],
        } as unknown as RTCTrackEvent);
      }
      expect(remoteStreamReceived).toBe(mockStream);

      viewer.destroy();
    });

    it('reutiliza a mesma instância de RTCPeerConnection em ofertas subsequentes (ICE restart)', async () => {
      const viewer = new WebRTCViewer(socket as unknown as never, 'host-1');

      socket.simulateEvent('webrtc:offer', {
        senderId: 'host-1',
        offer: { type: 'offer', sdp: 'v=0\r\no=host-1\r\n' },
      });

      await vi.waitFor(() => {
        expect(FakeRTCPeerConnection.instances.length).toBe(1);
      });

      const firstPc = FakeRTCPeerConnection.instances[0];

      // Segunda offer do mesmo host (ICE restart)
      socket.simulateEvent('webrtc:offer', {
        senderId: 'host-1',
        offer: { type: 'offer', sdp: 'v=0\r\no=host-ice-restart\r\n' },
      });

      await vi.waitFor(() => {
        const answers = socket.getEmissions('webrtc:answer');
        expect(answers.length).toBe(2);
      });

      // Não deve ter criado nova instância de RTCPeerConnection
      expect(FakeRTCPeerConnection.instances.length).toBe(1);
      expect(FakeRTCPeerConnection.instances[0]).toBe(firstPc);

      viewer.destroy();
    });

    it('bufferiza candidatos ICE recebidos antes da offer e aplica-os após setRemoteDescription', async () => {
      const viewer = new WebRTCViewer(socket as unknown as never, 'host-1');

      const candidate: RTCIceCandidatePayload = {
        candidate: 'candidate:2 1 UDP 2122260223 10.0.0.1 60000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      };

      // Candidato chega ANTES da offer
      socket.simulateEvent('webrtc:ice-candidate', {
        senderId: 'host-1',
        candidate,
      });

      expect(FakeRTCPeerConnection.instances.length).toBe(0);

      // Oferta chega depois
      socket.simulateEvent('webrtc:offer', {
        senderId: 'host-1',
        offer: { type: 'offer', sdp: 'v=0\r\no=host\r\n' },
      });

      await vi.waitFor(() => {
        expect(FakeRTCPeerConnection.instances.length).toBe(1);
        const pc = FakeRTCPeerConnection.instances[0];
        expect(pc.appliedIceCandidates.length).toBe(1);
        expect(pc.appliedIceCandidates[0].candidate).toBe(candidate.candidate);
      });

      viewer.destroy();
    });

    it('destroy fecha RTCPeerConnection e remove apenas seus próprios listeners', () => {
      const viewer = new WebRTCViewer(socket as unknown as never, 'host-1');

      const otherOfferListener = vi.fn();
      socket.on('webrtc:offer', otherOfferListener);

      viewer.destroy();

      socket.simulateEvent('webrtc:offer', {
        senderId: 'host-1',
        offer: { type: 'offer', sdp: 'v=0\r\n' },
      });

      expect(otherOfferListener).toHaveBeenCalledTimes(1);
    });
  });
});
