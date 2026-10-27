/**
 * rtcConfig.ts
 *
 * Configuração de WebRTC e constantes de resiliência (ICE restart).
 *
 * Os servidores TURN NÃO ficam no bundle: o servidor de sinalização entrega
 * `iceServers` (com credencial efêmera) em `room:created` / `room:joined`, e a
 * configuração é montada em tempo de execução por `buildRtcConfig`.
 */

import type { IceServerConfig, VideoConfig } from '@shared/index';

/** Configuração de vídeo padrão usada no apresentador e no co-apresentador */
export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  width: 1920,
  height: 1080,
  frameRate: 60,
  codec: 'auto',
  bitrate: 8000,
  quality: 'game',
};

/**
 * STUN público usado apenas como fallback quando o servidor não entrega nenhum ICE server.
 * Múltiplos servidores aumentam a chance de conectividade em redes restritas.
 */
const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  // Google STUN — mais comum e geralmente disponível
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  // Cloudflare STUN — alternativa confiável
  { urls: 'stun:stun.cloudflare.com:3478' },
];

export interface BuildRtcConfigOptions {
  /** Força conexão somente via relay TURN (esconde o IP do apresentador) */
  relayOnly?: boolean;
}

/**
 * Monta o RTCConfiguration a partir dos ICE servers entregues pelo servidor.
 * Lista vazia ⇒ STUN público (Google + Cloudflare). `relayOnly` ⇒ iceTransportPolicy 'relay'.
 */
export function buildRtcConfig(
  iceServers: IceServerConfig[],
  opts: BuildRtcConfigOptions = {},
): RTCConfiguration {
  const servers: RTCIceServer[] =
    iceServers.length > 0 ? iceServers.map((s) => ({ ...s })) : FALLBACK_ICE_SERVERS.map((s) => ({ ...s }));

  const config: RTCConfiguration = {
    iceServers: servers,
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    // Pool maior: o browser pré-coleta candidatos ICE antes do offer, acelerando a negociação
    iceCandidatePoolSize: 4,
  };
  if (opts.relayOnly) config.iceTransportPolicy = 'relay';
  return config;
}

/** Período de tolerância (em ms) para reconexão espontânea em caso de 'disconnected' */
export const ICE_DISCONNECTED_GRACE_MS = 3000;

/** Número máximo de tentativas de ICE restart antes de recriar o peer */
export const MAX_ICE_RESTART_ATTEMPTS = 3;

/** Intervalo base de backoff (em ms) entre tentativas: 1 s, 2 s, 4 s… */
export const ICE_RESTART_BACKOFF_BASE_MS = 1000;

/** Teto do backoff exponencial do ICE restart (ms) */
export const ICE_RESTART_BACKOFF_MAX_MS = 8000;

/** Atraso antes da tentativa `attempt` (1-based): base * 2^(attempt-1), limitado ao teto */
export function iceRestartDelayMs(attempt: number): number {
  const exp = Math.max(0, attempt - 1);
  return Math.min(ICE_RESTART_BACKOFF_BASE_MS * 2 ** exp, ICE_RESTART_BACKOFF_MAX_MS);
}
