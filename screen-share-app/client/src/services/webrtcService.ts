/**
 * webrtcService.ts
 *
 * Gerencia as conexões WebRTC entre o apresentador e cada espectador.
 *
 * Correções aplicadas:
 *   - Removido campo `roomId` que não era utilizado
 *   - Coleta de estatísticas agora usa `parseRTCStats` com peerId correto
 *   - `clearPeerSample` chamado ao encerrar cada peer
 *   - Mensagens de log em português
 */

import type { Socket } from 'socket.io-client';
import type { RTCIceCandidatePayload } from '@shared/index';
import { parseRTCStats, classifyQuality, clearPeerSample } from './statsService';
import type { StreamStats } from '@shared/index';

// Servidores STUN/TURN — os públicos do Google garantem conectividade básica.
// Para redes corporativas com NAT restritivo, configure um servidor TURN no .env.
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
  private statsCallback?: (stats: StreamStats) => void;
  private statsIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

  constructor(socket: Socket) {
    this.socket = socket;
    this.setupSocketListeners();
  }

  /**
   * Define o MediaStream local (vídeo + áudio) a ser transmitido.
   * Deve ser chamado logo após criar o broadcaster.
   */
  setLocalStream(stream: MediaStream): void {
    this.localStream = stream;
    // Atualiza as faixas em conexões que já existiam
    for (const [, pc] of this.peers) {
      this.replaceTracksInPeer(pc, stream);
    }
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
        console.warn('[ScreenShare] Não foi possível processar a resposta do espectador.');
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
        pc.addTrack(track, this.localStream);
      }
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
        console.warn(`[ScreenShare] Conexão com espectador perdida. Tentando reconectar...`);
        this.cleanupPeer(viewerId);
        setTimeout(() => this.initiateConnection(viewerId), 2000);
      }
    };

    // Coleta estatísticas a cada 2 segundos e chama o callback registrado
    if (this.statsCallback) {
      const interval = setInterval(async () => {
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
      console.error('[ScreenShare] Não foi possível iniciar a conexão com o espectador.');
      this.cleanupPeer(viewerId);
    }
  }

  private replaceTracksInPeer(pc: RTCPeerConnection, stream: MediaStream): void {
    const senders = pc.getSenders();
    for (const track of stream.getTracks()) {
      const sender = senders.find((s) => s.track?.kind === track.kind);
      if (sender) {
        sender.replaceTrack(track).catch(() => {
          // Falha silenciosa — faixa pode ter sido encerrada antes da troca
        });
      } else {
        pc.addTrack(track, stream);
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
      console.error('[ScreenShare] Não foi possível estabelecer conexão com o apresentador.');
    }
  }

  destroy(): void {
    this.pc?.close();
    this.pc = null;
    this.socket.off('webrtc:offer');
    this.socket.off('webrtc:ice-candidate');
  }
}
