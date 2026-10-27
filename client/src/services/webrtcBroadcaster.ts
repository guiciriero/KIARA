/**
 * webrtcBroadcaster.ts
 * Gerencia as conexões WebRTC do apresentador para os espectadores.
 */

import type { Socket } from 'socket.io-client';
import type {
  RTCIceCandidatePayload,
  VideoConfig,
  VideoCodec,
  StreamStats,
  ViewerJoinedPayload,
} from '@shared/index';
import { parseRTCStats, classifyQuality, clearPeerSample } from './statsService';
import { detectBroadcasterHwEncode, resolveVideoCodec } from './codecSelection';
import { BitrateController } from './bitrateController';
import { optimizeSdpForGaming } from './sdpTuning';
import {
  buildRtcConfig,
  iceRestartDelayMs,
  ICE_DISCONNECTED_GRACE_MS,
  MAX_ICE_RESTART_ATTEMPTS,
} from './rtcConfig';
import {
  BroadcasterOptions,
  DEFAULT_BROADCASTER_OPTIONS,
  DEFAULT_VIDEO_CONFIG,
  E2EE_VIDEO_CODEC,
  MAX_ICE_CANDIDATE_BUFFER,
  computeScaleDown,
  degradationPreferenceFor,
  e2eeCodecs,
  maxFramerateFor,
  orderCodecs,
  pushCapped,
  scalabilityModeFor,
} from './webrtcShared';

interface PeerConnectionData {
  pc: RTCPeerConnection;
  bitrateController: BitrateController;
  iceRestartAttempts: number;
  iceGraceTimer: ReturnType<typeof setTimeout> | null;
  /** Timer do backoff exponencial antes de cada ICE restart */
  iceRestartTimer: ReturnType<typeof setTimeout> | null;
  iceFailureHandled: boolean;
  iceCandidateBuffer: RTCIceCandidatePayload[];
  qualityPreference?: {
    targetHeight: number | null;
    maxBitrateKbps: number | null;
  };
}

export class WebRTCBroadcaster {
  private peers = new Map<string, PeerConnectionData>();
  private localStream: MediaStream | null = null;
  private socket: Socket;
  private videoConfig: VideoConfig;
  private statsCallback?: (stats: StreamStats) => void;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private options: BroadcasterOptions;
  private destroyed = false;

  constructor(
    socket: Socket,
    videoConfig: VideoConfig = DEFAULT_VIDEO_CONFIG,
    options: BroadcasterOptions = DEFAULT_BROADCASTER_OPTIONS,
  ) {
    this.socket = socket;
    this.videoConfig = { ...DEFAULT_VIDEO_CONFIG, ...videoConfig };
    this.options = options;
    this.setupSocketListeners();
  }

  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    for (const track of stream.getVideoTracks()) {
      if ('contentHint' in track && !track.contentHint) {
        track.contentHint = 'motion';
      }
    }
    for (const [, peerData] of this.peers) {
      this.replaceTracksInPeer(peerData.pc, stream);
    }
  }

  async replaceVideoTrack(newTrack: MediaStreamTrack): Promise<void> {
    if ('contentHint' in newTrack && !newTrack.contentHint) {
      newTrack.contentHint = 'motion';
    }

    const localStream = this.localStream ?? new MediaStream();
    if (this.localStream) {
      const oldTracks = this.localStream.getVideoTracks();
      for (const old of oldTracks) {
        old.onended = null;
        localStream.removeTrack(old);
        old.stop();
      }
      localStream.addTrack(newTrack);
    } else {
      localStream.addTrack(newTrack);
      this.localStream = localStream;
    }

    const promises: Promise<void>[] = [];
    for (const [, peerData] of this.peers) {
      const sender = peerData.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        promises.push(
          sender
            .replaceTrack(newTrack)
            .then(() => this.applySenderParameters(sender, this.videoConfig)),
        );
      } else {
        const newSender = peerData.pc.addTrack(newTrack, localStream);
        this.options.e2ee?.protectSender(newSender);
        promises.push(this.applySenderParameters(newSender, this.videoConfig));
      }
    }

    const results = await Promise.allSettled(promises);
    const hasError = results.some((r) => r.status === 'rejected');
    if (hasError) {
      throw new Error('Falha ao substituir faixa de vídeo em um ou mais espectadores');
    }
  }

  private async applySenderParameters(
    sender: RTCRtpSender,
    config?: VideoConfig,
    qualityPref?: { targetHeight: number | null; maxBitrateKbps: number | null },
  ): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.degradationPreference = degradationPreferenceFor(config?.quality);
      const fps = maxFramerateFor(config?.frameRate, qualityPref?.targetHeight);
      const baseBitrateKbps = config?.bitrate || 8000;
      const targetBitrateKbps = qualityPref?.maxBitrateKbps
        ? Math.min(qualityPref.maxBitrateKbps, baseBitrateKbps)
        : baseBitrateKbps;

      params.encodings[0].maxFramerate = fps;
      params.encodings[0].maxBitrate = targetBitrateKbps * 1000;
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';

      const scale = computeScaleDown(config?.height, qualityPref?.targetHeight, sender.track);
      if (scale > 1) {
        params.encodings[0].scaleResolutionDownBy = scale;
      } else {
        delete params.encodings[0].scaleResolutionDownBy;
      }
      delete (params.encodings[0] as RTCRtpEncodingParameters & { scalabilityMode?: string }).scalabilityMode;
      await sender.setParameters(params);
    } catch (err) {
      console.warn('[KIARA] Falha ao aplicar parâmetros no sender:', err);
      return;
    }

    const scalabilityMode = scalabilityModeFor(config?.codec);
    try {
      const p = sender.getParameters();
      if (p.encodings && p.encodings[0]) {
        (p.encodings[0] as RTCRtpEncodingParameters & { scalabilityMode?: string }).scalabilityMode = scalabilityMode;
        await sender.setParameters(p);
      }
    } catch {
      // Ignora rejeição do navegador
    }
  }

  async updateVideoConfig(partial: Partial<VideoConfig>): Promise<void> {
    this.videoConfig = { ...this.videoConfig, ...partial };

    const promises: Promise<void>[] = [];
    for (const [, peerData] of this.peers) {
      peerData.bitrateController.updateTarget(this.videoConfig.bitrate);
      const sender = peerData.pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        promises.push(this.applySenderParameters(sender, this.videoConfig, peerData.qualityPreference));
      }
    }
    await Promise.allSettled(promises);
  }

  private handleQualityRequest = async ({
    viewerId,
    targetHeight,
    maxBitrateKbps,
  }: {
    viewerId: string;
    targetHeight: number | null;
    maxBitrateKbps: number | null;
  }) => {
    const peerData = this.peers.get(viewerId);
    if (!peerData) return;

    peerData.qualityPreference = { targetHeight, maxBitrateKbps };
    const effectiveBitrate = maxBitrateKbps
      ? Math.min(maxBitrateKbps, this.videoConfig.bitrate)
      : this.videoConfig.bitrate;

    peerData.bitrateController.updateTarget(effectiveBitrate);

    const sender = peerData.pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender) {
      await this.applySenderParameters(sender, this.videoConfig, peerData.qualityPreference);
    }
  };

  onStats(cb: (stats: StreamStats) => void): void {
    this.statsCallback = cb;
    if (!this.statsInterval) {
      this.statsInterval = setInterval(() => {
        void this.collectAggregatedStats();
      }, 2000);
    }
  }

  private async collectAggregatedStats(): Promise<void> {
    if (this.peers.size === 0 || !this.statsCallback) return;

    let firstFps = 0;
    let firstVideoBitrate = 0;
    let firstAudioBitrate = 0;
    let maxLatencyMs = 0;
    let maxPacketsLost = 0;
    let maxLossPercent = 0;
    let maxJitterMs = 0;
    let worstLimitation: StreamStats['qualityLimitation'] = 'none';
    let hasValidData = false;

    for (const [viewerId, peerData] of this.peers) {
      try {
        const report = await peerData.pc.getStats();
        const stats = parseRTCStats(report, viewerId);

        const newBitrate = peerData.bitrateController.onSample({
          lossPercent: stats.lossPercent,
          rttMs: stats.latencyMs,
        });

        const videoSender = peerData.pc.getSenders().find((s) => s.track?.kind === 'video');
        if (videoSender) {
          const params = videoSender.getParameters();
          if (params.encodings && params.encodings[0]) {
            const effectiveBitrate = peerData.qualityPreference?.maxBitrateKbps
              ? Math.min(newBitrate, peerData.qualityPreference.maxBitrateKbps * 1000)
              : newBitrate;
            params.encodings[0].maxBitrate = effectiveBitrate;
            params.encodings[0].maxFramerate = maxFramerateFor(
              this.videoConfig.frameRate,
              peerData.qualityPreference?.targetHeight,
            );
            params.degradationPreference = degradationPreferenceFor(this.videoConfig.quality);
            void videoSender.setParameters(params).catch(() => {});
          }
        }

        if (!hasValidData) {
          firstFps = stats.fps;
          firstVideoBitrate = stats.videoBitrate;
          firstAudioBitrate = stats.audioBitrate;
          hasValidData = true;
        } else {
          if (firstFps === 0 && stats.fps > 0) firstFps = stats.fps;
          if (firstVideoBitrate === 0 && stats.videoBitrate > 0) firstVideoBitrate = stats.videoBitrate;
          if (firstAudioBitrate === 0 && stats.audioBitrate > 0) firstAudioBitrate = stats.audioBitrate;
        }

        maxLatencyMs = Math.max(maxLatencyMs, stats.latencyMs);
        maxPacketsLost = Math.max(maxPacketsLost, stats.packetsLost);
        maxLossPercent = Math.max(maxLossPercent, stats.lossPercent);
        maxJitterMs = Math.max(maxJitterMs, stats.jitterMs);

        const limitationSeverity: Record<StreamStats['qualityLimitation'], number> = {
          none: 0,
          other: 1,
          cpu: 2,
          bandwidth: 3,
        };
        if (limitationSeverity[stats.qualityLimitation] > limitationSeverity[worstLimitation]) {
          worstLimitation = stats.qualityLimitation;
        }
      } catch {
        // Peer em transição ou fechado
      }
    }

    if (hasValidData) {
      const quality = classifyQuality(maxLatencyMs, maxLossPercent);
      this.statsCallback({
        fps: firstFps,
        videoBitrate: firstVideoBitrate,
        audioBitrate: firstAudioBitrate,
        latencyMs: maxLatencyMs,
        packetsLost: maxPacketsLost,
        lossPercent: maxLossPercent,
        jitterMs: maxJitterMs,
        qualityLimitation: worstLimitation,
        connectionQuality: quality,
        timestamp: Date.now(),
      });
    }
  }

  private handleAnswer = async ({ senderId, answer }: { senderId: string; answer: RTCSessionDescriptionInit }) => {
    const peerData = this.peers.get(senderId);
    if (!peerData) return;
    try {
      await peerData.pc.setRemoteDescription(new RTCSessionDescription(answer));
      for (const candidate of peerData.iceCandidateBuffer) {
        await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      }
      peerData.iceCandidateBuffer = [];
    } catch (err) {
      console.warn('[KIARA] Falha ao aplicar remote description do espectador:', err);
    }
  };

  private handleIceCandidate = async ({ senderId, candidate }: { senderId: string; candidate: RTCIceCandidatePayload }) => {
    const peerData = this.peers.get(senderId);
    if (!peerData || !candidate?.candidate) return;
    if (peerData.pc.remoteDescription) {
      try {
        await peerData.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Candidato descartado
      }
    } else {
      pushCapped(peerData.iceCandidateBuffer, candidate, MAX_ICE_CANDIDATE_BUFFER);
    }
  };

  private handleViewerJoined = async ({ viewerId, hwDecode }: ViewerJoinedPayload) => {
    await this.initiateConnection(viewerId, hwDecode);
  };

  private handleViewerLeft = ({ viewerId }: { viewerId: string }) => {
    this.cleanupPeer(viewerId);
  };

  /** Inicia conexão com um peer específico (usado pelo co-apresentador para conectar ao host) */
  connectToPeer(peerId: string): void {
    void this.initiateConnection(peerId);
  }

  /**
   * Chamado quando o host reconecta ao servidor de sinalização (room:resumed).
   * Como o socket ID do host mudou, dispara nova oferta/ICE restart para cada espectador ativo.
   */
  onSignalingResumed(): void {
    if (this.destroyed) return;
    for (const [viewerId, peerData] of this.peers) {
      if (peerData.iceRestartTimer) {
        clearTimeout(peerData.iceRestartTimer);
        peerData.iceRestartTimer = null;
      }
      if (peerData.iceGraceTimer) {
        clearTimeout(peerData.iceGraceTimer);
        peerData.iceGraceTimer = null;
      }
      peerData.iceFailureHandled = false;
      void this.triggerIceRestart(viewerId);
    }
  }

  private setupSocketListeners(): void {
    this.socket.on('webrtc:answer', this.handleAnswer);
    this.socket.on('webrtc:ice-candidate', this.handleIceCandidate);
    this.socket.on('room:viewer-joined', this.handleViewerJoined);
    this.socket.on('room:viewer-left', this.handleViewerLeft);
    this.socket.on('stream:quality-request', this.handleQualityRequest);
    this.socket.on('webrtc:ice-restart-request', this.handleIceRestartRequestFromViewer);
  }

  private async initiateConnection(viewerId: string, viewerHwDecode?: readonly VideoCodec[]): Promise<void> {
    // Sala E2EE: só VP9 passa pela cifra de quadros, então o modo 'auto' (H.264/H.265) é ignorado
    const e2ee = this.options.e2ee;
    const hwEncode = !e2ee && this.videoConfig.codec === 'auto' ? await detectBroadcasterHwEncode() : undefined;
    const choice = e2ee
      ? { codec: E2EE_VIDEO_CODEC, reason: 'sala E2EE: só VP9 passa pela cifra de quadros' }
      : resolveVideoCodec(this.videoConfig.codec, { hwEncode, viewerHwDecode });
    if (this.destroyed || this.peers.has(viewerId)) return;
    console.warn(`[KIARA:broadcaster] viewer=${viewerId.slice(0, 8)} codec=${choice.codec} (${choice.reason})`);

    if (this.options.maxViewers > 0 && this.peers.size >= this.options.maxViewers) {
      console.warn(`[KIARA] Limite de ${this.options.maxViewers} espectadores atingido; recusando ${viewerId}.`);
      this.options.onViewerRejected?.(viewerId);
      return;
    }

    const pc = new RTCPeerConnection(
      buildRtcConfig(this.options.iceServers, { relayOnly: this.options.privacyMode }),
    );
    const peerData: PeerConnectionData = {
      pc,
      bitrateController: new BitrateController(this.videoConfig.bitrate),
      iceRestartAttempts: 0,
      iceGraceTimer: null,
      iceRestartTimer: null,
      iceFailureHandled: false,
      iceCandidateBuffer: [],
    };
    this.peers.set(viewerId, peerData);

    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream);
        e2ee?.protectSender(sender);
        if (track.kind === 'video') {
          void this.applySenderParameters(sender, { ...this.videoConfig, codec: choice.codec });
        }
      }
      if (this.localStream.getAudioTracks().length === 0) {
        const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendonly' });
        e2ee?.protectSender(audioTransceiver.sender);
      }
    } else {
      // Atenção: criar o transceiver FORA do `?.` (com e2ee indefinido o argumento não seria avaliado)
      const videoTransceiver = pc.addTransceiver('video', { direction: 'sendonly' });
      const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendonly' });
      e2ee?.protectSender(videoTransceiver.sender);
      e2ee?.protectSender(audioTransceiver.sender);
    }

    try {
      const transceivers = pc.getTransceivers();
      const videoTransceiver = transceivers.find((t) => t.sender.track?.kind === 'video');
      if (videoTransceiver && 'setCodecPreferences' in videoTransceiver && RTCRtpSender.getCapabilities) {
        const capabilities = RTCRtpSender.getCapabilities('video');
        if (capabilities?.codecs) {
          const available = e2ee ? e2eeCodecs(capabilities.codecs) : capabilities.codecs;
          const base = choice.codec === 'H265' ? orderCodecs(available, 'H264') : available;
          videoTransceiver.setCodecPreferences(orderCodecs(base, choice.codec));
        }
      }
    } catch {
      // Ignora se não houver suporte
    }

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const payload: RTCIceCandidatePayload = {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      };
      this.socket.emit('webrtc:ice-candidate', { targetId: viewerId, candidate: payload });
    };

    const handleConnectionStateChange = () => {
      const state = pc.connectionState;
      const iceState = pc.iceConnectionState;
      const failed = state === 'failed' || iceState === 'failed';

      console.warn(`[KIARA:broadcaster] viewer=${viewerId.slice(0, 8)} connectionState=${state} iceConnectionState=${iceState}`);

      if (!failed) peerData.iceFailureHandled = false;

      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        if (peerData.iceGraceTimer) {
          clearTimeout(peerData.iceGraceTimer);
          peerData.iceGraceTimer = null;
        }
        peerData.iceRestartAttempts = 0;
        console.warn(`[KIARA:broadcaster] Conexão WebRTC estabelecida com espectador ${viewerId.slice(0, 8)}.`);
        return;
      }

      if (failed) {
        if (peerData.iceFailureHandled) return;
        peerData.iceFailureHandled = true;
        if (peerData.iceGraceTimer) {
          clearTimeout(peerData.iceGraceTimer);
          peerData.iceGraceTimer = null;
        }
        console.warn(`[KIARA:broadcaster] ICE falhou para viewer ${viewerId.slice(0, 8)} (state=${state}, iceState=${iceState}). Tentando restart...`);
        void this.triggerIceRestart(viewerId);
        return;
      }

      if (state === 'disconnected' || iceState === 'disconnected') {
        console.warn(`[KIARA:broadcaster] Viewer ${viewerId.slice(0, 8)} desconectado (state=${state}, iceState=${iceState}). Aguardando reconexão automática...`);
        if (!peerData.iceGraceTimer) {
          peerData.iceGraceTimer = setTimeout(() => {
            peerData.iceGraceTimer = null;
            const currentPc = this.peers.get(viewerId)?.pc;
            if (
              currentPc &&
              (currentPc.connectionState === 'disconnected' || currentPc.iceConnectionState === 'disconnected')
            ) {
              void this.triggerIceRestart(viewerId);
            }
          }, ICE_DISCONNECTED_GRACE_MS);
        }
      }
    };

    pc.onconnectionstatechange = handleConnectionStateChange;
    pc.oniceconnectionstatechange = handleConnectionStateChange;

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });

      const tunedSdp = optimizeSdpForGaming(offer.sdp ?? '', {
        targetBitrateKbps: this.videoConfig.bitrate,
        minBitrateKbps: Math.max(3000, Math.round(this.videoConfig.bitrate * 0.375)),
        maxBitrateKbps: Math.max(Math.round(this.videoConfig.bitrate * 1.5), 16000),
      });
      const tunedOffer: RTCSessionDescriptionInit = {
        type: offer.type,
        sdp: tunedSdp,
      };

      await pc.setLocalDescription(tunedOffer);

      this.socket.emit('webrtc:offer', {
        targetId: viewerId,
        offer: { sdp: tunedOffer.sdp, type: tunedOffer.type },
      });
    } catch (err) {
      console.error('[KIARA] Não foi possível iniciar a conexão com o espectador:', err);
      this.cleanupPeer(viewerId);
    }
  }

  private async triggerIceRestart(viewerId: string): Promise<void> {
    const peerData = this.peers.get(viewerId);
    if (!peerData || this.destroyed) return;
    if (peerData.iceRestartTimer) return;

    if (peerData.iceRestartAttempts < MAX_ICE_RESTART_ATTEMPTS) {
      peerData.iceRestartAttempts += 1;
      const delay = iceRestartDelayMs(peerData.iceRestartAttempts);
      peerData.iceRestartTimer = setTimeout(() => {
        peerData.iceRestartTimer = null;
        if (this.destroyed || this.peers.get(viewerId) !== peerData) return;
        void this.runIceRestart(viewerId, peerData);
      }, delay);
    } else {
      console.warn(`[KIARA] ICE restart esgotado para o espectador ${viewerId}. Recriando conexão.`);
      this.cleanupPeer(viewerId);
      void this.initiateConnection(viewerId);
    }
  }

  private async runIceRestart(viewerId: string, peerData: PeerConnectionData): Promise<void> {
    try {
      if (typeof peerData.pc.restartIce === 'function') {
        peerData.pc.restartIce();
      }
      const offer = await peerData.pc.createOffer({ iceRestart: true });
      await peerData.pc.setLocalDescription(offer);
      if (this.destroyed || this.peers.get(viewerId) !== peerData) return;
      this.socket.emit('webrtc:offer', {
        targetId: viewerId,
        offer: { sdp: offer.sdp, type: offer.type },
      });
    } catch (err) {
      console.warn(`[KIARA] Falha na tentativa ${peerData.iceRestartAttempts} de ICE restart:`, err);
    }
  }

  private replaceTracksInPeer(pc: RTCPeerConnection, stream: MediaStream): void {
    const senders = pc.getSenders();
    for (const track of stream.getTracks()) {
      const sender = senders.find((s) => s.track?.kind === track.kind);
      if (sender) {
        sender.replaceTrack(track).catch(() => {});
        if (track.kind === 'video') {
          void this.applySenderParameters(sender, this.videoConfig);
        }
      } else {
        const newSender = pc.addTrack(track, stream);
        this.options.e2ee?.protectSender(newSender);
        if (track.kind === 'video') {
          void this.applySenderParameters(newSender, this.videoConfig);
        }
      }
    }
  }

  private cleanupPeer(peerId: string): void {
    const peerData = this.peers.get(peerId);
    if (peerData) {
      if (peerData.iceGraceTimer) {
        clearTimeout(peerData.iceGraceTimer);
        peerData.iceGraceTimer = null;
      }
      if (peerData.iceRestartTimer) {
        clearTimeout(peerData.iceRestartTimer);
        peerData.iceRestartTimer = null;
      }
      clearPeerSample(peerId);
      peerData.pc.close();
      this.peers.delete(peerId);
    }
  }

  private handleIceRestartRequestFromViewer = ({ senderId }: { senderId: string }) => {
    if (this.peers.has(senderId)) {
      void this.triggerIceRestart(senderId);
    }
  };

  destroy(): void {
    this.destroyed = true;
    for (const id of [...this.peers.keys()]) {
      this.cleanupPeer(id);
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.localStream = null;
    this.socket.off('webrtc:answer', this.handleAnswer);
    this.socket.off('webrtc:ice-candidate', this.handleIceCandidate);
    this.socket.off('room:viewer-joined', this.handleViewerJoined);
    this.socket.off('room:viewer-left', this.handleViewerLeft);
    this.socket.off('stream:quality-request', this.handleQualityRequest);
    this.socket.off('webrtc:ice-restart-request', this.handleIceRestartRequestFromViewer);
  }
}
