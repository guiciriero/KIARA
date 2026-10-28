/**
 * webrtcViewer.ts
 * Gerencia a recepção de transmissão WebRTC no lado do espectador.
 */

import type { Socket } from 'socket.io-client';
import type { RTCIceCandidatePayload, IceServerConfig } from '@shared/index';
import { mirrorVideoBitrateHints, tuneOpusAudioSdp } from './sdpTuning';
import {
  buildRtcConfig,
  iceRestartDelayMs,
  ICE_DISCONNECTED_GRACE_MS,
  MAX_ICE_RESTART_ATTEMPTS,
} from './rtcConfig';
import { MAX_ICE_CANDIDATE_BUFFER, VIDEO_STALL_TIMEOUT_MS, pushCapped } from './webrtcShared';
import type { E2eeTransform } from './e2ee';

const VIDEO_WATCHDOG_INTERVAL_MS = 1000;

export class WebRTCViewer {
  private pc: RTCPeerConnection | null = null;
  private socket: Socket;
  private hostId: string;
  private onRemoteStream?: (stream: MediaStream) => void;
  private pendingCandidates: RTCIceCandidatePayload[] = [];
  private iceServers: IceServerConfig[];
  private destroyed = false;
  /** MediaStream remoto acumulado via ontrack (robusto para Firefox e Safari) */
  private remoteStream: MediaStream | null = null;
  /** Controle de ICE restart no lado do espectador */
  private iceRestartAttempts = 0;
  private iceGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private iceRestartTimer: ReturnType<typeof setTimeout> | null = null;
  private iceFailureHandled = false;
  /** Vigia se o vídeo realmente começou a ser decodificado (evita tela preta com conexão "ok") */
  private videoStatusCb?: (ok: boolean) => void;
  private videoWatchdog: ReturnType<typeof setInterval> | null = null;

  /** Sala E2EE: todo receiver decifra os quadros; quadro que não autentica é descartado no worker */
  private e2ee?: E2eeTransform;

  constructor(
    socket: Socket,
    hostId: string,
    iceServers: IceServerConfig[] = [],
    e2ee?: E2eeTransform,
  ) {
    this.socket = socket;
    this.hostId = hostId;
    this.iceServers = iceServers;
    this.e2ee = e2ee;
    this.setupSocketListeners();
  }

  /**
   * Protege o receiver com cifra de ponta a ponta (E2EE) caso configurada.
   */
  private protectReceiver(receiver: RTCRtpReceiver): void {
    this.e2ee?.protectReceiver(receiver);
  }

  /**
   * Atualiza o ID do host (quando o apresentador reconecta e recebe um novo socket ID).
   */
  setHostId(hostId: string): void {
    this.hostId = hostId;
  }

  /**
   * Avisa se o vídeo começou (`true`) ou se nenhum frame foi decodificado dentro de
   * VIDEO_STALL_TIMEOUT_MS (`false`). Deve ser registrado antes da primeira oferta.
   */
  onVideoStatus(cb: (ok: boolean) => void): void {
    this.videoStatusCb = cb;
  }

  private stopVideoWatchdog(): void {
    if (this.videoWatchdog) {
      clearInterval(this.videoWatchdog);
      this.videoWatchdog = null;
    }
  }

  private async hasDecodedVideo(pc: RTCPeerConnection): Promise<boolean> {
    const report = await pc.getStats();
    let decoded = false;
    report.forEach((s: Record<string, unknown>) => {
      if (s.type === 'inbound-rtp' && (s.kind === 'video' || s.mediaType === 'video') && Number(s.framesDecoded) > 0) {
        decoded = true;
      }
    });
    return decoded;
  }

  private startVideoWatchdog(pc: RTCPeerConnection): void {
    if (!this.videoStatusCb || this.videoWatchdog) return;
    const startedAt = Date.now();
    this.videoWatchdog = setInterval(() => {
      if (this.destroyed || pc !== this.pc) {
        this.stopVideoWatchdog();
        return;
      }
      this.hasDecodedVideo(pc)
        .then((ok) => {
          if (!this.videoWatchdog || pc !== this.pc) return;
          if (ok) {
            this.stopVideoWatchdog();
            this.videoStatusCb?.(true);
          } else if (Date.now() - startedAt >= VIDEO_STALL_TIMEOUT_MS) {
            this.stopVideoWatchdog();
            console.warn('[KIARA:viewer] Nenhum frame de vídeo decodificado; a conexão será refeita.');
            this.videoStatusCb?.(false);
          }
        })
        .catch(() => undefined);
    }, VIDEO_WATCHDOG_INTERVAL_MS);
  }

  onStream(cb: (stream: MediaStream) => void): void {
    this.onRemoteStream = cb;
    if (this.remoteStream) {
      cb(this.remoteStream);
    }
  }

  private ensurePeerConnection(): RTCPeerConnection {
    if (this.pc) return this.pc;

    const pc = new RTCPeerConnection(buildRtcConfig(this.iceServers));
    this.pc = pc;
    this.remoteStream = new MediaStream();

    try {
      const video = pc.addTransceiver('video', { direction: 'recvonly' });
      const audio = pc.addTransceiver('audio', { direction: 'recvonly' });
      this.protectReceiver(video.receiver);
      this.protectReceiver(audio.receiver);
    } catch {
      // Ignora em navegadores sem suporte a addTransceiver (em sala E2EE o ontrack protege o receiver)
    }

    pc.ontrack = (event) => {
      if (this.destroyed || pc !== this.pc) return;
      if (event.receiver) this.protectReceiver(event.receiver);

      const stream = event.streams[0] ?? this.remoteStream ?? new MediaStream();

      if (event.track && !stream.getTracks().includes(event.track)) {
        stream.addTrack(event.track);
      }

      if (event.streams[0]) {
        this.remoteStream = event.streams[0];
      } else {
        this.remoteStream = stream;
      }

      if (event.track) {
        event.track.onended = () => {
          this.remoteStream?.removeTrack(event.track);
        };
      }

      this.tuneReceivers(pc);

      if (this.onRemoteStream && this.remoteStream) {
        this.onRemoteStream(this.remoteStream);
      }
    };

    pc.onicecandidate = (event) => {
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

    const handleConnectionStateChange = () => {
      if (this.destroyed || pc !== this.pc) return;
      const state = pc.connectionState;
      const iceState = pc.iceConnectionState;
      const failed = state === 'failed' || iceState === 'failed';

      if (!failed) this.iceFailureHandled = false;

      if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
        if (this.iceGraceTimer) {
          clearTimeout(this.iceGraceTimer);
          this.iceGraceTimer = null;
        }
        this.iceRestartAttempts = 0;
        console.warn('[KIARA:viewer] Conexão WebRTC estabelecida com o apresentador.');
        return;
      }

      if (failed) {
        if (this.iceFailureHandled) return;
        this.iceFailureHandled = true;
        if (this.iceGraceTimer) {
          clearTimeout(this.iceGraceTimer);
          this.iceGraceTimer = null;
        }
        console.warn(`[KIARA:viewer] ICE falhou (state=${state}, iceState=${iceState}). Tentando restart...`);
        void this.triggerIceRestart();
        return;
      }

      if (state === 'disconnected' || iceState === 'disconnected') {
        console.warn(`[KIARA:viewer] Conexão desconectada (state=${state}, iceState=${iceState}). Aguardando reconexão automática...`);
        if (!this.iceGraceTimer) {
          this.iceGraceTimer = setTimeout(() => {
            this.iceGraceTimer = null;
            if (
              this.pc === pc &&
              (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected')
            ) {
              void this.triggerIceRestart();
            }
          }, ICE_DISCONNECTED_GRACE_MS);
        }
      }
    };

    pc.onconnectionstatechange = handleConnectionStateChange;
    pc.oniceconnectionstatechange = handleConnectionStateChange;

    return pc;
  }

  private async triggerIceRestart(): Promise<void> {
    if (this.destroyed) return;
    if (this.iceRestartTimer) return;

    if (this.iceRestartAttempts < MAX_ICE_RESTART_ATTEMPTS) {
      this.iceRestartAttempts += 1;
      const delay = iceRestartDelayMs(this.iceRestartAttempts);
      console.warn(`[KIARA:viewer] ICE restart tentativa ${this.iceRestartAttempts} em ${delay}ms`);
      this.iceRestartTimer = setTimeout(() => {
        this.iceRestartTimer = null;
        if (!this.destroyed && this.pc) {
          void this.runIceRestart();
        }
      }, delay);
    } else {
      console.warn('[KIARA:viewer] ICE restart esgotado. Aguardando reoferta do apresentador.');
      this.closePeerConnection();
    }
  }

  private async runIceRestart(): Promise<void> {
    if (!this.pc || this.destroyed) return;
    try {
      if (typeof this.pc.restartIce === 'function') {
        this.pc.restartIce();
      }
      this.socket.emit('webrtc:ice-restart-request', { targetId: this.hostId });
      console.warn('[KIARA:viewer] Solicitação de ICE restart enviada ao apresentador.');
    } catch (err) {
      console.warn(`[KIARA:viewer] Falha ao solicitar ICE restart:`, err);
    }
  }

  private closePeerConnection(): void {
    this.stopVideoWatchdog();
    if (this.iceGraceTimer) { clearTimeout(this.iceGraceTimer); this.iceGraceTimer = null; }
    if (this.iceRestartTimer) { clearTimeout(this.iceRestartTimer); this.iceRestartTimer = null; }
    this.pc?.close();
    this.pc = null;
    this.remoteStream = null;
    this.pendingCandidates = [];
    this.iceRestartAttempts = 0;
    this.iceFailureHandled = false;
  }

  private tuneReceivers(pc: RTCPeerConnection): void {
    try {
      if (typeof pc.getReceivers === 'function') {
        for (const receiver of pc.getReceivers()) {
          if ('playoutDelayHint' in receiver) {
            (receiver as unknown as { playoutDelayHint: number }).playoutDelayHint = 0;
          }
          if ('jitterBufferTarget' in receiver) {
            (receiver as unknown as { jitterBufferTarget: number }).jitterBufferTarget = 0;
          }
        }
      }
    } catch {
      // Ignora se não for suportado
    }
  }

  private handleOffer = async ({ senderId, offer }: { senderId: string; offer: RTCSessionDescriptionInit }) => {
    if (senderId !== this.hostId || this.destroyed) return;

    const pc = this.ensurePeerConnection();

    try {
      const sigState = pc.signalingState ?? 'stable';
      if (sigState !== 'stable' && sigState !== 'have-remote-offer') {
        console.warn('[KIARA:viewer] Offer recebida em estado inesperado, recriando PC...');
        this.closePeerConnection();
        const freshPc = this.ensurePeerConnection();
        await freshPc.setRemoteDescription(new RTCSessionDescription(offer));
        await this.flushPendingCandidates(freshPc);
        const answer = await freshPc.createAnswer();
        const tunedSdp = mirrorVideoBitrateHints(offer.sdp ?? '', tuneOpusAudioSdp(answer.sdp ?? '', 192));
        const tunedAnswer: RTCSessionDescriptionInit = { type: answer.type, sdp: tunedSdp };
        await freshPc.setLocalDescription(tunedAnswer);
        this.tuneReceivers(freshPc);
        this.socket.emit('webrtc:answer', {
          targetId: this.hostId,
          answer: { sdp: tunedAnswer.sdp, type: tunedAnswer.type },
        });
        this.startVideoWatchdog(freshPc);
        return;
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      await this.flushPendingCandidates(pc);

      const answer = await pc.createAnswer();
      const tunedSdp = mirrorVideoBitrateHints(offer.sdp ?? '', tuneOpusAudioSdp(answer.sdp ?? '', 192));
      const tunedAnswer: RTCSessionDescriptionInit = { type: answer.type, sdp: tunedSdp };
      await pc.setLocalDescription(tunedAnswer);
      this.tuneReceivers(pc);

      this.socket.emit('webrtc:answer', {
        targetId: this.hostId,
        answer: { sdp: tunedAnswer.sdp, type: tunedAnswer.type },
      });
      this.startVideoWatchdog(pc);
    } catch (err) {
      console.error('[KIARA:viewer] Não foi possível estabelecer conexão com o apresentador:', err);
    }
  };

  private async flushPendingCandidates(pc: RTCPeerConnection): Promise<void> {
    for (const cand of this.pendingCandidates) {
      await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    }
    this.pendingCandidates = [];
  }

  private handleIceCandidate = async ({ senderId, candidate }: { senderId: string; candidate: RTCIceCandidatePayload }) => {
    if (senderId !== this.hostId || !candidate?.candidate) return;
    if (this.pc?.remoteDescription) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // Ignora
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
    this.closePeerConnection();
    this.socket.off('webrtc:offer', this.handleOffer);
    this.socket.off('webrtc:ice-candidate', this.handleIceCandidate);
  }
}
