/**
 * Tipos compartilhados entre servidor e cliente.
 * Centraliza as definições de interface para garantir consistência
 * em toda a aplicação.
 */
/** Informações de uma sala de compartilhamento */
export interface Room {
    id: string;
    code: string;
    hostId: string;
    createdAt: number;
    viewerCount: number;
    isActive: boolean;
}
/** Configurações de qualidade da transmissão */
export interface StreamConfig {
    video: VideoConfig;
    audio: AudioConfig;
}
export interface VideoConfig {
    width: number;
    height: number;
    frameRate: number;
    codec: VideoCodec;
    bitrate: number;
    quality: 'low' | 'medium' | 'high' | 'ultra';
}
export interface AudioConfig {
    sampleRate: 44100 | 48000;
    bitrate: number;
    codec: AudioCodec;
    sources: AudioSource[];
}
export type VideoCodec = 'H264' | 'H265' | 'VP9' | 'VP8';
export type AudioCodec = 'opus' | 'aac';
/** Representa um processo/aplicativo com saída de áudio capturável */
export interface AudioSource {
    id: string;
    processId: number;
    processName: string;
    displayName: string;
    iconBase64?: string;
    volume: number;
    isMuted: boolean;
    platform: 'windows' | 'linux' | 'macos';
}
/** Tipos de eventos trocados entre cliente e servidor */
export type SignalingEvent = 'room:create' | 'room:join' | 'room:leave' | 'room:error' | 'room:created' | 'room:joined' | 'room:viewer-joined' | 'room:viewer-left' | 'room:host-disconnected' | 'webrtc:offer' | 'webrtc:answer' | 'webrtc:ice-candidate' | 'stream:config-update' | 'stream:stats';
/** Payload genérico de evento de sinalização */
export interface SignalingMessage<T = unknown> {
    event: SignalingEvent;
    roomId: string;
    senderId: string;
    targetId?: string;
    payload: T;
}
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
export interface StreamStats {
    fps: number;
    videoBitrate: number;
    audioBitrate: number;
    latencyMs: number;
    packetsLost: number;
    connectionQuality: 'excellent' | 'good' | 'fair' | 'poor';
    timestamp: number;
}
/** Informações de uma janela/monitor disponível para captura */
export interface CaptureSource {
    id: string;
    type: 'window' | 'monitor' | 'region';
    name: string;
    thumbnailBase64?: string;
    bounds: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
}
/** Configuração de região personalizada de captura */
export interface CaptureRegion {
    x: number;
    y: number;
    width: number;
    height: number;
    monitorIndex: number;
}
export type AppMode = 'idle' | 'broadcasting' | 'viewing';
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'failed';
