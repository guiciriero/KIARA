/**
 * webrtcService.ts
 *
 * Gerencia as conexões WebRTC entre o apresentador e os espectadores.
 * Prioriza taxa de 60 FPS (degradationPreference conforme a qualidade), troca dinâmica de faixas de vídeo (replaceTrack),
 * resiliência com ICE restart, controle adaptativo de taxa de bits (AIMD) e agregação de métricas.
 */

import type { Socket } from 'socket.io-client';
import type { RTCIceCandidatePayload, VideoConfig, StreamStats, IceServerConfig } from '@shared/index';
import { parseRTCStats, classifyQuality, clearPeerSample } from './statsService';
import { isMacOS } from './captureService';
import { BitrateController } from './bitrateController';
import {
  buildRtcConfig,
  iceRestartDelayMs,
  ICE_DISCONNECTED_GRACE_MS,
  MAX_ICE_RESTART_ATTEMPTS,
} from './rtcConfig';

/** Máximo de candidatos ICE guardados antes da answer (descarta os mais antigos) */
export const MAX_ICE_CANDIDATE_BUFFER = 100;

export interface BroadcasterOptions {
  iceServers: IceServerConfig[];
  /** true ⇒ iceTransportPolicy 'relay' (esconde o IP do apresentador) */
  privacyMode: boolean;
  /** Limite de espectadores (0 = sem limite no cliente; o servidor também aplica) */
  maxViewers: number;
  /** Chamado quando um espectador é recusado por exceder maxViewers */
  onViewerRejected?: (viewerId: string) => void;
}

const DEFAULT_BROADCASTER_OPTIONS: BroadcasterOptions = { iceServers: [], privacyMode: false, maxViewers: 0 };

/** Empilha com teto, descartando os mais antigos */
function pushCapped<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  width: 1920,
  height: 1080,
  frameRate: 60,
  codec: 'H264',
  bitrate: 5000,
  quality: 'high',
};

export interface RTCRtpCodecCapability {
  mimeType: string;
  clockRate: number;
  channels?: number;
  sdpFmtpLine?: string;
}

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

/**
 * Preferência de degradação do encoder.
 * - 'low'/'medium': mantém fps (reduz resolução sob pressão).
 * - 'high'/'ultra'/undefined no macOS: 'balanced' — VideoToolbox tolera melhor
 *   quedas controladas de fps+resolução do que resolução travada em alta carga.
 * - Demais plataformas em 'high'/'ultra'/undefined: 'maintain-framerate'.
 */
export function degradationPreferenceFor(
  quality?: VideoConfig['quality'],
  mac: boolean = isMacOS(),
): RTCDegradationPreference {
  if (quality === 'low' || quality === 'medium') return 'maintain-framerate';
  return mac ? 'balanced' : 'maintain-framerate';
}

/**
 * Ordena codecs WebRTC priorizando o codec selecionado. No H264, perfis com packetization-mode=1 vêm
 * primeiro: High (64) em geral; no macOS, Main (4d) antes de High, por ter melhor suporte a
 * encode por hardware (VideoToolbox).
 */
export function orderCodecs(
  codecs: readonly RTCRtpCodecCapability[],
  preferredCodecName: string,
  macOS: boolean = isMacOS(),
): RTCRtpCodecCapability[] {
  if (!codecs || codecs.length === 0) return [];
  const preferred = preferredCodecName.toUpperCase();
  const isH264 = preferred === 'H264';
  const profilePriority = macOS ? ['profile-level-id=4d', 'profile-level-id=64'] : ['profile-level-id=64'];

  const preferredByProfile: RTCRtpCodecCapability[][] = profilePriority.map(() => []);
  const preferredRest: RTCRtpCodecCapability[] = [];
  const others: RTCRtpCodecCapability[] = [];

  for (const codec of codecs) {
    const mime = codec.mimeType.toUpperCase();
    const matchesPreferred = mime === `VIDEO/${preferred}` || mime.endsWith(`/${preferred}`);

    if (matchesPreferred) {
      if (isH264) {
        const fmtp = (codec.sdpFmtpLine ?? '').toLowerCase();
        const profileIndex = profilePriority.findIndex((profile) => fmtp.includes(profile));
        if (profileIndex >= 0 && fmtp.includes('packetization-mode=1')) {
          preferredByProfile[profileIndex].push(codec);
        } else {
          preferredRest.push(codec);
        }
      } else {
        preferredRest.push(codec);
      }
    } else {
      others.push(codec);
    }
  }

  return [...preferredByProfile.flat(), ...preferredRest, ...others];
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

    if (this.localStream) {
      const oldTracks = this.localStream.getVideoTracks();
      for (const old of oldTracks) {
        this.localStream.removeTrack(old);
        old.stop();
      }
      this.localStream.addTrack(newTrack);
    } else {
      this.localStream = new MediaStream([newTrack]);
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
        const newSender = peerData.pc.addTrack(newTrack, this.localStream);
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
    qualityPref?: { targetHeight: number | null; maxBitrateKbps: number | null }
  ): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.degradationPreference = degradationPreferenceFor(config?.quality);
      const fps = config?.frameRate || 60;
      const baseBitrateKbps = config?.bitrate || 5000;
      const targetBitrateKbps = qualityPref?.maxBitrateKbps
        ? Math.min(qualityPref.maxBitrateKbps, baseBitrateKbps)
        : baseBitrateKbps;

      params.encodings[0].maxFramerate = fps;
      params.encodings[0].maxBitrate = targetBitrateKbps * 1000;
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';

      // Downscale individual para o espectador via scaleResolutionDownBy
      if (qualityPref?.targetHeight && config?.height && qualityPref.targetHeight < config.height) {
        const scale = config.height / qualityPref.targetHeight;
        params.encodings[0].scaleResolutionDownBy = Math.max(1, scale);
      } else {
        delete params.encodings[0].scaleResolutionDownBy;
      }

      // scalabilityMode é tratado na etapa separada abaixo; não reenviar aqui
      delete (params.encodings[0] as RTCRtpEncodingParameters & { scalabilityMode?: string }).scalabilityMode;
      await sender.setParameters(params);
    } catch (err) {
      console.warn('[KIARA] Falha ao aplicar parâmetros no sender:', err);
      return;
    }

    // SVC opcional (AV1/VP9): tentativa separada, nunca impede o envio
    if (config?.codec === 'AV1' || config?.codec === 'VP9') {
      try {
        const params = sender.getParameters();
        if (params.encodings && params.encodings[0]) {
          (params.encodings[0] as RTCRtpEncodingParameters & { scalabilityMode?: string }).scalabilityMode = 'L1T3';
          await sender.setParameters(params);
        }
      } catch {
        // Navegador rejeitou scalabilityMode: segue sem SVC
      }
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
            params.encodings[0].maxBitrate = newBitrate;
            params.encodings[0].maxFramerate = this.videoConfig.frameRate || 60;
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
        // Peer pode estar em transição ou fechado
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

  private handleViewerJoined = async ({ viewerId }: { viewerId: string }) => {
    await this.initiateConnection(viewerId);
  };

  private handleViewerLeft = ({ viewerId }: { viewerId: string }) => {
    this.cleanupPeer(viewerId);
  };

  /** Inicia conexão com um peer específico (usado pelo co-apresentador para conectar ao host) */
  connectToPeer(peerId: string): void {
    void this.initiateConnection(peerId);
  }

  private setupSocketListeners(): void {
    this.socket.on('webrtc:answer', this.handleAnswer);
    this.socket.on('webrtc:ice-candidate', this.handleIceCandidate);
    this.socket.on('room:viewer-joined', this.handleViewerJoined);
    this.socket.on('room:viewer-left', this.handleViewerLeft);
    this.socket.on('stream:quality-request', this.handleQualityRequest);
  }

  private async initiateConnection(viewerId: string): Promise<void> {
    if (this.destroyed || this.peers.has(viewerId)) return;

    // Defesa em profundidade: o servidor já aplica o limite
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
        if (track.kind === 'video') {
          void this.applySenderParameters(sender, this.videoConfig);
        }
      }
      if (this.localStream.getAudioTracks().length === 0) {
        pc.addTransceiver('audio', { direction: 'sendonly' });
      }
    } else {
      pc.addTransceiver('video', { direction: 'sendonly' });
      pc.addTransceiver('audio', { direction: 'sendonly' });
    }

    try {
      const transceivers = pc.getTransceivers();
      const videoTransceiver = transceivers.find((t) => t.sender.track?.kind === 'video');
      if (videoTransceiver && 'setCodecPreferences' in videoTransceiver && RTCRtpSender.getCapabilities) {
        const capabilities = RTCRtpSender.getCapabilities('video');
        if (capabilities?.codecs) {
          const ordered = orderCodecs(capabilities.codecs, this.videoConfig.codec);
          videoTransceiver.setCodecPreferences(ordered);
        }
      }
    } catch {
      // Ignora se não houver suporte a setCodecPreferences
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

      // Chrome costuma reportar 'failed' nos dois eventos; sem isso o restart rodaria duas vezes.
      if (!failed) peerData.iceFailureHandled = false;

      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        if (peerData.iceGraceTimer) {
          clearTimeout(peerData.iceGraceTimer);
          peerData.iceGraceTimer = null;
        }
        peerData.iceRestartAttempts = 0;
        return;
      }

      if (failed) {
        if (peerData.iceFailureHandled) return;
        peerData.iceFailureHandled = true;
        if (peerData.iceGraceTimer) {
          clearTimeout(peerData.iceGraceTimer);
          peerData.iceGraceTimer = null;
        }
        void this.triggerIceRestart(viewerId);
        return;
      }

      if (state === 'disconnected' || iceState === 'disconnected') {
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
      await pc.setLocalDescription(offer);

      this.socket.emit('webrtc:offer', {
        targetId: viewerId,
        offer: { sdp: offer.sdp, type: offer.type },
      });
    } catch (err) {
      console.error('[KIARA] Não foi possível iniciar a conexão com o espectador:', err);
      this.cleanupPeer(viewerId);
    }
  }

  private async triggerIceRestart(viewerId: string): Promise<void> {
    const peerData = this.peers.get(viewerId);
    if (!peerData || this.destroyed) return;
    if (peerData.iceRestartTimer) return; // já há um restart agendado

    if (peerData.iceRestartAttempts < MAX_ICE_RESTART_ATTEMPTS) {
      peerData.iceRestartAttempts += 1;
      // Backoff exponencial (1 s, 2 s, 4 s…) com timer cancelável em cleanupPeer/destroy
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
  }
}

// ─── Lado do Espectador ───────────────────────────────────────────────────────

export class WebRTCViewer {
  private pc: RTCPeerConnection | null = null;
  private socket: Socket;
  private hostId: string;
  private onRemoteStream?: (stream: MediaStream) => void;
  private pendingCandidates: RTCIceCandidatePayload[] = [];
  private iceServers: IceServerConfig[];
  private destroyed = false;

  constructor(socket: Socket, hostId: string, iceServers: IceServerConfig[] = []) {
    this.socket = socket;
    this.hostId = hostId;
    this.iceServers = iceServers;
    this.setupSocketListeners();
  }

  onStream(cb: (stream: MediaStream) => void): void {
    this.onRemoteStream = cb;
  }

  private handleOffer = async ({ senderId, offer }: { senderId: string; offer: RTCSessionDescriptionInit }) => {
    if (senderId !== this.hostId || this.destroyed) return;

    if (!this.pc) {
      this.pc = new RTCPeerConnection(buildRtcConfig(this.iceServers));

      this.pc.ontrack = (event) => {
        if (event.streams[0] && this.onRemoteStream) {
          this.onRemoteStream(event.streams[0]);
        }
      };

      this.pc.onicecandidate = (event) => {
        if (!event.candidate) return;
        this.socket.emit('webrtc:ice-candidate', {
          targetId: this.hostId,
          candidate: {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          },
        });
      };
    }

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));

      for (const cand of this.pendingCandidates) {
        await this.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
      }
      this.pendingCandidates = [];

      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      this.socket.emit('webrtc:answer', {
        targetId: this.hostId,
        answer: { sdp: answer.sdp, type: answer.type },
      });
    } catch (err) {
      console.error('[KIARA] Não foi possível estabelecer conexão com o apresentador:', err);
    }
  };

  private handleIceCandidate = async ({ senderId, candidate }: { senderId: string; candidate: RTCIceCandidatePayload }) => {
    if (senderId !== this.hostId || !candidate?.candidate) return;
    if (this.pc?.remoteDescription) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignora candidatos obsoletos
      }
    } else {
      pushCapped(this.pendingCandidates, candidate, MAX_ICE_CANDIDATE_BUFFER);
    }
  };

  private setupSocketListeners(): void {
    this.socket.on('webrtc:offer', this.handleOffer);
    this.socket.on('webrtc:ice-candidate', this.handleIceCandidate);
  }

  destroy(): void {
    this.destroyed = true;
    this.pendingCandidates = [];
    this.pc?.close();
    this.pc = null;
    this.socket.off('webrtc:offer', this.handleOffer);
    this.socket.off('webrtc:ice-candidate', this.handleIceCandidate);
  }
}
