/**
 * webrtcShared.ts
 * Utilitários e tipos compartilhados entre WebRTCBroadcaster e WebRTCViewer.
 */

import type { IceServerConfig, VideoConfig } from '@shared/index';
import { isMacOS } from './captureService';
import { getCaptureSize } from './nativeCapture';
import type { E2eeTransform } from './e2ee';

/** Máximo de candidatos ICE guardados antes da answer (descarta os mais antigos) */
export const MAX_ICE_CANDIDATE_BUFFER = 100;

/** Sem nenhum frame de vídeo decodificado por este tempo após a oferta, o espectador considera a tela travada */
export const VIDEO_STALL_TIMEOUT_MS = 12000;

export interface BroadcasterOptions {
  iceServers: IceServerConfig[];
  /** true ⇒ iceTransportPolicy 'relay' (esconde o IP do apresentador) */
  privacyMode: boolean;
  /** Limite de espectadores (0 = sem limite no cliente; o servidor também aplica) */
  maxViewers: number;
  /** Chamado quando um espectador é recusado por exceder maxViewers */
  onViewerRejected?: (viewerId: string) => void;
  /**
   * Sala com criptografia de ponta a ponta: todo sender criado passa por esta transformação e o
   * codec é forçado para VP9 (AV1 e H.264 falham na cifra de quadros; ver e2eeCodecs).
   */
  e2ee?: E2eeTransform;
}

/** Codec das salas E2EE (medido no Chrome 156: VP9 e VP8 decodificam; AV1 e H.264 não) */
export const E2EE_VIDEO_CODEC: VideoConfig['codec'] = 'VP9';

/**
 * Mantém só os codecs que sobrevivem à cifra do payload inteiro do quadro: VP9, VP8 e o RTX
 * (retransmissão) que os acompanha. Fora H.264, H.265 e AV1, para a negociação nunca cair neles.
 */
export function e2eeCodecs<T extends { mimeType: string }>(codecs: readonly T[]): T[] {
  return codecs.filter((codec) => /^video\/(vp9|vp8|rtx)$/i.test(codec.mimeType));
}

export const DEFAULT_BROADCASTER_OPTIONS: BroadcasterOptions = {
  iceServers: [],
  privacyMode: false,
  maxViewers: 0,
};

/** Empilha com teto, descartando os mais antigos */
export function pushCapped<T>(list: T[], item: T, max: number): void {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  width: 1920,
  height: 1080,
  frameRate: 60,
  codec: 'auto',
  bitrate: 8000,
  quality: 'game',
};

export interface RTCRtpCodecCapability {
  mimeType: string;
  clockRate: number;
  channels?: number;
  sdpFmtpLine?: string;
}

/** Altura a partir da qual (para baixo) o espectador recebe no máximo SVC_LOW_QUALITY_FPS */
const SVC_LOW_QUALITY_HEIGHT = 480;
/** Teto de FPS de quem escolheu 480p ou menos (T0+T1 do L1T3 a 60 FPS; metade de 60) */
export const SVC_LOW_QUALITY_FPS = 30;

/**
 * Modo de escalabilidade do encoder. Só camadas temporais (L1T3), em VP9 e AV1; os demais codecs
 * ficam em L1T1. Camadas espaciais (L2T*, L3T*) multiplicariam o custo de codificação em cada
 * conexão, então não são usadas.
 */
export function scalabilityModeFor(codec: VideoConfig['codec'] | undefined): 'L1T3' | 'L1T1' {
  return codec === 'AV1' || codec === 'VP9' ? 'L1T3' : 'L1T1';
}

/**
 * FPS máximo de UM espectador: o configurado pelo apresentador, limitado a 30 para quem pediu
 * 480p ou menos. Com L1T3 o encoder corta as camadas temporais de cima e mantém as de baixo.
 */
export function maxFramerateFor(configFps: number | undefined, targetHeight: number | null | undefined): number {
  const fps = configFps || 60;
  return targetHeight && targetHeight <= SVC_LOW_QUALITY_HEIGHT ? Math.min(fps, SVC_LOW_QUALITY_FPS) : fps;
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
  const profilePriority = macOS
    ? ['profile-level-id=4d', 'profile-level-id=64', 'profile-level-id=42']
    : ['profile-level-id=64', 'profile-level-id=4d', 'profile-level-id=42'];

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

/**
 * Fator de redução do encoder: alvo = menor entre a altura configurada e a preferida pelo espectador;
 * a altura de partida é a da captura nativa quando conhecida, senão a configurada.
 */
export function computeScaleDown(
  configHeight: number | undefined,
  targetHeight: number | null | undefined,
  track: MediaStreamTrack | null,
): number {
  const captured = (track && getCaptureSize(track)?.height) || configHeight || 0;
  const target = Math.min(configHeight || Infinity, targetHeight || Infinity);
  if (!captured || !Number.isFinite(target) || target >= captured) return 1;
  return Math.max(1, captured / target);
}
