/**
 * codecSelection.ts
 *
 * Escolha automática do codec de vídeo por espectador.
 *
 * Regra do modo 'auto': HEVC (H265) só quando os DOIS lados o processam por hardware
 * (encode no apresentador e decode no espectador); caso contrário, H.264. HEVC por software
 * em qualquer ponta aumenta latência e CPU, então não vale como "preferência automática".
 *
 * "Por hardware" = `MediaCapabilities.{encodingInfo,decodingInfo}` (tipo 'webrtc') com
 * `supported && smooth && powerEfficient`. Isso é um indicador do navegador, não uma garantia
 * de que a GPU será usada; a escolha manual no painel de vídeo continua disponível.
 */

import type { VideoCodec, VideoCodecPreference } from '@shared/index';

export type CodecDirection = 'encode' | 'decode';

export interface CodecCapabilityLike {
  mimeType: string;
  sdpFmtpLine?: string;
}

export interface MediaInfoResult {
  supported: boolean;
  smooth: boolean;
  powerEfficient: boolean;
}

/** Dependências do navegador, injetáveis nos testes */
export interface CodecDetectionEnv {
  getCodecs(direction: CodecDirection): readonly CodecCapabilityLike[];
  mediaInfo(
    direction: CodecDirection,
    config: { contentType: string; width: number; height: number; bitrate: number; framerate: number },
  ): Promise<MediaInfoResult>;
}

const MIME_BY_CODEC: Record<VideoCodec, string> = {
  H264: 'video/h264',
  H265: 'video/h265',
  VP9: 'video/vp9',
  VP8: 'video/vp8',
  AV1: 'video/av1',
};

/** Codecs avaliados na detecção (VP8 é sempre software; não interessa) */
const PROBED_CODECS: readonly VideoCodec[] = ['H265', 'H264', 'AV1', 'VP9'];

/** Perfil de teste: o alvo do app (1080p60) */
const PROBE = { width: 1920, height: 1080, bitrate: 15_000_000, framerate: 60 };

const DETECTION_TIMEOUT_MS = 1500;

function defaultEnv(): CodecDetectionEnv | null {
  if (typeof navigator === 'undefined' || !navigator.mediaCapabilities) return null;
  if (typeof RTCRtpSender === 'undefined' || typeof RTCRtpReceiver === 'undefined') return null;
  return {
    getCodecs: (direction) =>
      (direction === 'encode' ? RTCRtpSender : RTCRtpReceiver).getCapabilities?.('video')?.codecs ?? [],
    mediaInfo: async (direction, config) => {
      const configuration = { type: 'webrtc' as const, video: config };
      return direction === 'encode'
        ? navigator.mediaCapabilities.encodingInfo(configuration)
        : navigator.mediaCapabilities.decodingInfo(configuration);
    },
  };
}

/**
 * Codecs que o navegador processa por hardware na direção pedida.
 * Retorna `undefined` quando não dá para saber (API ausente, erro ou timeout) — diferente de
 * `[]`, que significa "medi e nenhum é por hardware".
 */
export async function detectHwCodecs(
  direction: CodecDirection,
  env: CodecDetectionEnv | null = defaultEnv(),
  timeoutMs: number = DETECTION_TIMEOUT_MS,
): Promise<VideoCodec[] | undefined> {
  if (!env) return undefined;

  const probe = async (): Promise<VideoCodec[]> => {
    const capabilities = env.getCodecs(direction);
    const found: VideoCodec[] = [];
    for (const codec of PROBED_CODECS) {
      const mime = MIME_BY_CODEC[codec];
      const entries = capabilities.filter((c) => {
        if (c.mimeType.toLowerCase() !== mime) return false;
        // H.264: só packetization-mode=1, que é o que o app negocia
        return codec !== 'H264' || (c.sdpFmtpLine ?? '').includes('packetization-mode=1');
      });
      const results = await Promise.all(
        entries.map((c) =>
          env
            .mediaInfo(direction, {
              contentType: c.sdpFmtpLine ? `${c.mimeType};${c.sdpFmtpLine}` : c.mimeType,
              ...PROBE,
            })
            .then((r) => r.supported && r.smooth && r.powerEfficient)
            .catch(() => false),
        ),
      );
      if (results.some(Boolean)) found.push(codec);
    }
    return found;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probe(),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let decodeCache: Promise<VideoCodec[] | undefined> | null = null;
let encodeCache: Promise<VideoCodec[] | undefined> | null = null;

/** Codecs que ESTE navegador decodifica por hardware (calculado uma vez) */
export function detectViewerHwDecode(): Promise<VideoCodec[] | undefined> {
  return (decodeCache ??= detectHwCodecs('decode'));
}

/** Codecs que ESTE navegador codifica por hardware (calculado uma vez) */
export function detectBroadcasterHwEncode(): Promise<VideoCodec[] | undefined> {
  return (encodeCache ??= detectHwCodecs('encode'));
}

/** Só para testes */
export function resetCodecDetectionCache(): void {
  decodeCache = null;
  encodeCache = null;
}

export interface CodecChoice {
  codec: VideoCodec;
  /** Motivo legível, para log/diagnóstico */
  reason: string;
}

/**
 * Decide o codec de UM espectador.
 * - Escolha manual (≠ 'auto'): respeitada como está.
 * - 'auto': H265 se encode (aqui) e decode (espectador) forem por hardware; senão H264.
 */
export function resolveVideoCodec(
  preference: VideoCodecPreference,
  ctx: { hwEncode?: readonly VideoCodec[]; viewerHwDecode?: readonly VideoCodec[] },
): CodecChoice {
  if (preference !== 'auto') return { codec: preference, reason: 'escolha manual' };

  const encodeOk = ctx.hwEncode?.includes('H265') === true;
  const decodeOk = ctx.viewerHwDecode?.includes('H265') === true;
  if (encodeOk && decodeOk) return { codec: 'H265', reason: 'HEVC por hardware nos dois lados' };
  if (!encodeOk) return { codec: 'H264', reason: 'sem encode HEVC por hardware (ou desconhecido) no apresentador' };
  return {
    codec: 'H264',
    reason: ctx.viewerHwDecode === undefined
      ? 'espectador não informou decode por hardware'
      : 'espectador sem decode HEVC por hardware',
  };
}
