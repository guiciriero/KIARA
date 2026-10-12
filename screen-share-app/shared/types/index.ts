/**
 * Tipos compartilhados entre servidor e cliente.
 * Centraliza as definições de interface para garantir consistência
 * em toda a aplicação.
 */

// ─── Sala de Compartilhamento ─────────────────────────────────────────────────

/** Informações de uma sala de compartilhamento */
export interface Room {
  id: string;
  code: string;           // Código de convite legível (ex.: "ABC-123")
  hostId: string;         // Socket ID do apresentador
  createdAt: number;      // Timestamp de criação
  viewerCount: number;
  isActive: boolean;
}

/** Configurações de qualidade da transmissão */
export interface StreamConfig {
  video: VideoConfig;
  audio: AudioConfig;
}

export interface VideoConfig {
  width: number;          // Largura em pixels (max 3840)
  height: number;         // Altura em pixels (max 2160)
  frameRate: number;      // FPS (1-60)
  codec: VideoCodec;
  bitrate: number;        // kbps
  quality: 'low' | 'medium' | 'high' | 'ultra';
}

export interface AudioConfig {
  sampleRate: 44100 | 48000;
  bitrate: number;        // kbps (até 320)
  codec: AudioCodec;
  sources: AudioSource[]; // Fontes de áudio selecionadas
}

export type VideoCodec = 'H264' | 'H265' | 'VP9' | 'VP8';
export type AudioCodec = 'opus' | 'aac';

// ─── Fontes de Áudio ─────────────────────────────────────────────────────────

/** Representa um processo/aplicativo com saída de áudio capturável */
export interface AudioSource {
  id: string;             // Identificador único (PID ou nome do sink-input)
  processId: number;      // PID do processo
  processName: string;    // Nome do executável
  displayName: string;    // Nome amigável para exibição
  iconBase64?: string;    // Ícone do aplicativo em base64
  volume: number;         // Volume 0.0 a 1.0
  isMuted: boolean;
  platform: 'windows' | 'linux' | 'macos';
}

// ─── Eventos WebSocket / Sinalização ─────────────────────────────────────────

/** Tipos de eventos trocados entre cliente e servidor */
export type SignalingEvent =
  | 'room:create'
  | 'room:join'
  | 'room:leave'
  | 'room:error'
  | 'room:created'
  | 'room:joined'
  | 'room:viewer-joined'
  | 'room:viewer-left'
  | 'room:host-disconnected'
  | 'webrtc:offer'
  | 'webrtc:answer'
  | 'webrtc:ice-candidate'
  | 'stream:config-update'
  | 'stream:stats';

/** Payload genérico de evento de sinalização */
export interface SignalingMessage<T = unknown> {
  event: SignalingEvent;
  roomId: string;
  senderId: string;
  targetId?: string;      // ID do destinatário específico (se peer-to-peer)
  payload: T;
}

// ─── WebRTC ──────────────────────────────────────────────────────────────────

export interface RTCOfferPayload {
  sdp: string;
  type: 'offer';
  /** Configuração de stream enviada opcionalmente junto com a offer */
  config?: StreamConfig;
}

export interface RTCAnswerPayload {
  sdp: string;
  type: 'answer';
}

export interface RTCIceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

// ─── Estatísticas de Transmissão ─────────────────────────────────────────────

export interface StreamStats {
  fps: number;
  videoBitrate: number;   // kbps atual
  audioBitrate: number;   // kbps atual
  latencyMs: number;      // Latência estimada em milissegundos
  packetsLost: number;    // Total de pacotes perdidos
  connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';
  timestamp: number;
}

// ─── Captura Nativa ──────────────────────────────────────────────────────────

/** Informações de uma janela/monitor disponível para captura */
export interface CaptureSource {
  id: string;
  type: 'window' | 'monitor' | 'region';
  name: string;
  thumbnailBase64?: string;
  bounds: { x: number; y: number; width: number; height: number };
}

/** Configuração de região personalizada de captura */
export interface CaptureRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  monitorIndex: number;
}

// ─── Estado da Aplicação ─────────────────────────────────────────────────────

export type AppMode = 'idle' | 'broadcasting' | 'viewing';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
