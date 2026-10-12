/**
 * webrtcService.ts
 *
 * Gerencia as conexões WebRTC entre o apresentador e cada espectador.
 * Otimizado para fluidez a 60 FPS com priorização de framerate (maintain-framerate),
 * troca dinâmica de tela/janela em tempo real (replaceTrack) e ajuste de qualidade ao vivo.
 */

import type { Socket } from 'socket.io-client';
import type { RTCIceCandidatePayload, VideoConfig } from '@shared/index';
import { parseRTCStats, classifyQuality, clearPeerSample } from './statsService';
import type { StreamStats } from '@shared/index';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  ...(import.meta.env.VITE_TURN_URL
    ? [
        {
          urls: import.meta.env.VITE_TURN_URL as string,
          username: import.meta.env.VITE_TURN_USER as string,
          credential: import.meta.env.VITE_TURN_CREDENTIAL as string,
        },
      ]
    : []),
];

type PeerMap = Map<string, RTCPeerConnection>;

export class WebRTCBroadcaster {
  private peers: PeerMap = new Map();
  private localStream: MediaStream | null = null;
  private socket: Socket;
  private videoConfig?: VideoConfig;
  private statsCallback?: (stats: StreamStats) => void;
  private statsIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(socket: Socket, videoConfig?: VideoConfig) {
    this.socket = socket;
    this.videoConfig = videoConfig;
    this.setupSocketListeners();
  }

  /**
   * Define o MediaStream local (vídeo + áudio) a ser transmitido.
   * Deve ser chamado logo após criar o broadcaster.
   */
  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    // Garante que todas as faixas de vídeo usem contentHint='motion' para 60 FPS
    for (const track of stream.getVideoTracks()) {
      if ('contentHint' in track) {
        track.contentHint = 'motion';
      }
    }
    // Atualiza as faixas em conexões que já existiam
    for (const [, pc] of this.peers) {
      this.replaceTracksInPeer(pc, stream);
    }
  }

  /**
   * Substitui a faixa de vídeo em tempo real para todos os espectadores conectados
   * sem precisar renegociar SDP e sem derrubar a sala.
   */
  async replaceVideoTrack(newTrack: MediaStreamTrack): Promise<void> {
    if ('contentHint' in newTrack) {
      newTrack.contentHint = 'motion';
    }

    // 1. Atualiza o MediaStream local
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

    // 2. Substitui a faixa em todos os RTCPeerConnections ativos
    const promises: Promise<void>[] = [];
    for (const [, pc] of this.peers) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        promises.push(
          sender.replaceTrack(newTrack).then(() => {
            return this.applySenderParameters(sender, this.videoConfig);
          }).catch((err) => {
            console.warn('[KIARA] Erro ao substituir track no sender:', err);
          }),
        );
      } else {
        pc.addTrack(newTrack, this.localStream);
      }
    }

    await Promise.allSettled(promises);
  }

  /**
   * Configura parâmetros de fluidez (maintain-framerate e limites de bitrate/fps) no sender.
   */
  private async applySenderParameters(sender: RTCRtpSender, config?: VideoConfig): Promise<void> {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      // Prioriza a manutenção da taxa de quadros (60 fps) mesmo se houver variação de rede
      params.degradationPreference = 'maintain-framerate';
      const fps = config?.frameRate || 60;
      const bitrateKbps = config?.bitrate || 5000;

      params.encodings[0].maxFramerate = fps;
      params.encodings[0].maxBitrate = bitrateKbps * 1000;
      params.encodings[0].priority = 'high';
      params.encodings[0].networkPriority = 'high';

      await sender.setParameters(params);
    } catch {
      // Ignora silenciosamente se o browser não permitir ajuste imediato de parâmetros
    }
  }

  /**
   * Atualiza as configurações de vídeo a quente (bitrate, fps) para todos os senders ativos.
   */
  async updateVideoConfig(partial: Partial<VideoConfig>): Promise<void> {
    if (this.videoConfig) {
      this.videoConfig = { ...this.videoConfig, ...partial };
    }
    const promises: Promise<void>[] = [];
    for (const [, pc] of this.peers) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) {
        promises.push(this.applySenderParameters(sender, this.videoConfig));
      }
    }
    await Promise.allSettled(promises);
  }

  /** Registra callback para receber estatísticas agregadas a cada 2 segundos */
  onStats(cb: (stats: StreamStats) => void): void {
    this.statsCallback = cb;
  }

  private setupSocketListeners(): void {
    // Espectador respondeu à nossa oferta de conexão
    this.socket.on('webrtc:answer', async ({ senderId, answer }) => {
      const pc = this.peers.get(senderId);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch {
        console.warn('[KIARA] Não foi possível processar a resposta do espectador.');
      }
    });

    // Novo caminho de rede sugerido por um espectador
    this.socket.on('webrtc:ice-candidate', async ({ senderId, candidate }) => {
      const pc = this.peers.get(senderId);
      if (!pc || !candidate?.candidate) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // ICE candidates obsoletos são descartados silenciosamente
      }
    });

    // Novo espectador entrou na sala — inicia a negociação de conexão com ele
    this.socket.on('room:viewer-joined', async ({ viewerId }) => {
      await this.initiateConnection(viewerId);
    });
  }

  private async initiateConnection(viewerId: string): Promise<void> {
    if (this.peers.has(viewerId)) return;

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.peers.set(viewerId, pc);

    // Adiciona todas as faixas do stream local
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) {
        const sender = pc.addTrack(track, this.localStream);
        if (track.kind === 'video') {
          void this.applySenderParameters(sender, this.videoConfig);
        }
      }
    }

    // Configura codec preferences se disponível no navegador
    try {
      const transceivers = pc.getTransceivers();
      const videoTransceiver = transceivers.find((t) => t.sender.track?.kind === 'video');
      if (videoTransceiver && 'setCodecPreferences' in videoTransceiver && RTCRtpSender.getCapabilities) {
        const capabilities = RTCRtpSender.getCapabilities('video');
        if (capabilities?.codecs) {
          const selectedCodecName = (this.videoConfig?.codec || 'H264').toLowerCase();
          const preferredCodecs = capabilities.codecs.slice().sort((a, b) => {
            const aMatch = a.mimeType.toLowerCase().includes(selectedCodecName);
            const bMatch = b.mimeType.toLowerCase().includes(selectedCodecName);
            if (aMatch && !bMatch) return -1;
            if (!aMatch && bMatch) return 1;
            return 0;
          });
          videoTransceiver.setCodecPreferences(preferredCodecs);
        }
      }
    } catch {
      // Ignora fallback se setCodecPreferences não for suportado
    }

    // Envia candidatos ICE ao espectador via servidor de sinalização
    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      const payload: RTCIceCandidatePayload = {
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
      };
      this.socket.emit('webrtc:ice-candidate', { targetId: viewerId, candidate: payload });
    };

    // Acompanha o estado da conexão e tenta reconectar se falhar
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        console.warn(`[KIARA] Conexão com espectador perdida. Tentando reconectar...`);
        this.cleanupPeer(viewerId);
        setTimeout(() => this.initiateConnection(viewerId), 2000);
      }
    };

    // Coleta estatísticas a cada 2 segundos e chama o callback registrado
    if (this.statsCallback) {
      const interval = setInterval(async () => {
        try {
          const report = await pc.getStats();
          const partial = parseRTCStats(report, viewerId);
          const quality = classifyQuality(partial.latencyMs ?? 0, partial.packetsLost ?? 0);
          const stats: StreamStats = {
            fps:               partial.fps ?? 0,
            videoBitrate:      partial.videoBitrate ?? 0,
            audioBitrate:      partial.audioBitrate ?? 0,
            latencyMs:         partial.latencyMs ?? 0,
            packetsLost:       partial.packetsLost ?? 0,
            connectionQuality: quality,
            timestamp:         Date.now(),
          };
          this.statsCallback!(stats);
        } catch {
          // Peer pode ter sido fechado durante o getStats
        }
      }, 2000);
      this.statsIntervals.set(viewerId, interval);
    }

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
    } catch {
      console.error('[KIARA] Não foi possível iniciar a conexão com o espectador.');
      this.cleanupPeer(viewerId);
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
    const interval = this.statsIntervals.get(peerId);
    if (interval) {
      clearInterval(interval);
      this.statsIntervals.delete(peerId);
    }
    clearPeerSample(peerId);
    const pc = this.peers.get(peerId);
    if (pc) {
      pc.close();
      this.peers.delete(peerId);
    }
  }

  /** Encerra todas as conexões e libera todos os recursos */
  destroy(): void {
    for (const [id] of this.peers) {
      this.cleanupPeer(id);
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.socket.off('webrtc:answer');
    this.socket.off('webrtc:ice-candidate');
    this.socket.off('room:viewer-joined');
  }
}

// ─── Lado do Espectador ───────────────────────────────────────────────────────

export class WebRTCViewer {
  private pc: RTCPeerConnection | null = null;
  private socket: Socket;
  private hostId: string;
  private onRemoteStream?: (stream: MediaStream) => void;

  constructor(socket: Socket, hostId: string) {
    this.socket = socket;
    this.hostId = hostId;
    this.setupSocketListeners();
  }

  /** Registra callback para quando o vídeo do apresentador chegar */
  onStream(cb: (stream: MediaStream) => void): void {
    this.onRemoteStream = cb;
  }

  private setupSocketListeners(): void {
    this.socket.on('webrtc:offer', async ({ senderId, offer }) => {
      if (senderId !== this.hostId) return;
      await this.handleOffer(offer);
    });

    this.socket.on('webrtc:ice-candidate', async ({ senderId, candidate }) => {
      if (senderId !== this.hostId || !this.pc) return;
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Candidato ICE obsoleto — descartado silenciosamente
      }
    });
  }

  private async handleOffer(offer: RTCSessionDescriptionInit): Promise<void> {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Assim que o vídeo/áudio chegarem, repassa ao componente
    this.pc.ontrack = (event) => {
      if (event.streams[0] && this.onRemoteStream) {
        this.onRemoteStream(event.streams[0]);
      }
    };

    // Envia nossos caminhos de rede ao apresentador
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

    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);

      this.socket.emit('webrtc:answer', {
        targetId: this.hostId,
        answer: { sdp: answer.sdp, type: answer.type },
      });
    } catch {
      console.error('[KIARA] Não foi possível estabelecer conexão com o apresentador.');
    }
  }

  destroy(): void {
    this.pc?.close();
    this.pc = null;
    this.socket.off('webrtc:offer');
    this.socket.off('webrtc:ice-candidate');
  }
}
