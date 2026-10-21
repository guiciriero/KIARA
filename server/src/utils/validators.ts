/**
 * Utilitários de validação para o servidor de sinalização e salas KIARA.
 * Valida rigorosamente todos os payloads recebidos via WebSocket para prevenir falhas e injeções.
 */

import type {
  CreateRoomPayload,
  RoomFeaturesPayload,
  JoinRoomPayload,
  RespondJoinPayload,
  SendReactionPayload,
  UpdateNamePayload,
  ReactionEmoji,
  RTCOfferPayload,
  RTCAnswerPayload,
  RTCIceCandidatePayload,
  StreamConfig,
  QualityRequestPayload,
  StreamStats,
  ViewerQualityPreference,
  CopresentStartPayload,
} from '@screen-share/shared';

export const ALLOWED_REACTIONS: readonly ReactionEmoji[] = ['👍', '❤️', '😂', '😮', '👏', '🔥'] as const;
export const ALLOWED_QUALITY_PREFERENCES: readonly ViewerQualityPreference[] = [
  'auto',
  '1080p',
  '720p',
  '480p',
  '360p',
] as const;

/** Valida código de sala: 6 caracteres alfanuméricos sem ambiguidade */
export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code.toUpperCase());
}

/** Valida senha de sala (4 a 64 caracteres) */
export function isValidRoomPassword(password: unknown): password is string {
  return typeof password === 'string' && password.length >= 4 && password.length <= 64;
}

/**
 * Remove caracteres invisíveis/de controle (Cc) e de formatação (Cf: zero-width, marcas
 * bidirecionais como U+202E "right-to-left override") e separadores de linha/parágrafo.
 * SEGURANÇA: evita spoofing visual de apelidos/mensagens (inversão de texto, nomes "vazios").
 */
export function stripUnsafeChars(text: string): string {
  return text.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, '');
}

/** Nomes que fariam um espectador se passar pelo apresentador nas reações */
const RESERVED_NICKNAME = /apresentador|\(\s*host\s*\)/i;

/**
 * Sanitiza apelido: até 24 caracteres, sem caracteres de controle/invisíveis.
 * SEGURANÇA: normaliza (NFKC, dobra letras "largas" parecidas), colapsa espaços e recusa nomes
 * reservados ("Apresentador", "(host)") para impedir personificação do apresentador.
 */
export function sanitizeNickname(name: unknown, isHost: boolean = false): string {
  if (isHost) return 'Apresentador';
  if (typeof name !== 'string') return 'Convidado';
  // Limita antes de normalizar para não processar entradas gigantes
  const cleaned = stripUnsafeChars(name.slice(0, 200).normalize('NFKC'))
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned.length === 0 || RESERVED_NICKNAME.test(cleaned)) return 'Convidado';
  return Array.from(cleaned).slice(0, 24).join('').trim() || 'Convidado';
}

/** Valida CreateRoomPayload */
export function validateCreateRoomPayload(data: unknown): {
  valid: boolean;
  payload?: CreateRoomPayload;
  invalidPassword?: boolean;
} {
  if (data === null || data === undefined) {
    return { valid: true, payload: {} };
  }
  if (typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false };
  }

  const obj = data as Record<string, unknown>;
  const result: CreateRoomPayload = {};

  if ('password' in obj && obj.password !== undefined && obj.password !== null && obj.password !== '') {
    if (!isValidRoomPassword(obj.password)) {
      return { valid: false, invalidPassword: true };
    }
    result.password = obj.password;
  }

  if ('requireApproval' in obj && obj.requireApproval !== undefined) {
    if (typeof obj.requireApproval !== 'boolean') return { valid: false };
    result.requireApproval = obj.requireApproval;
  }

  if ('privacyMode' in obj && obj.privacyMode !== undefined) {
    if (typeof obj.privacyMode !== 'boolean') return { valid: false };
    result.privacyMode = obj.privacyMode;
  }

  if ('reactionsEnabled' in obj && obj.reactionsEnabled !== undefined) {
    if (typeof obj.reactionsEnabled !== 'boolean') return { valid: false };
    result.reactionsEnabled = obj.reactionsEnabled;
  }

  if ('preferredCode' in obj && obj.preferredCode !== undefined && obj.preferredCode !== null) {
    if (typeof obj.preferredCode === 'string') {
      result.preferredCode = obj.preferredCode;
    }
  }

  return { valid: true, payload: result };
}

/** Valida RoomFeaturesPayload */
export function validateRoomFeaturesPayload(data: unknown): RoomFeaturesPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.reactionsEnabled !== 'boolean') {
    return null;
  }

  return {
    reactionsEnabled: obj.reactionsEnabled,
  };
}

/** Valida UpdateNamePayload */
export function validateUpdateNamePayload(data: unknown): UpdateNamePayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.name !== 'string') return null;
  const name = sanitizeNickname(obj.name);

  return { name };
}

/** Valida JoinRoomPayload */
export function validateJoinRoomPayload(data: unknown): JoinRoomPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.code !== 'string') return null;
  const code = obj.code.toUpperCase().trim();
  if (!isValidRoomCode(code)) return null;

  const result: JoinRoomPayload = { code };

  if (typeof obj.password === 'string') {
    result.password = obj.password;
  }

  if (typeof obj.name === 'string') {
    result.name = sanitizeNickname(obj.name);
  }

  return result;
}

/** Valida RespondJoinPayload */
export function validateRespondJoinPayload(data: unknown): RespondJoinPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.viewerId !== 'string' || obj.viewerId.trim().length === 0) return null;
  if (typeof obj.approved !== 'boolean') return null;

  return {
    viewerId: obj.viewerId,
    approved: obj.approved,
  };
}

/** Valida SendReactionPayload */
export function validateReactionPayload(data: unknown): SendReactionPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.emoji !== 'string') return null;
  if (!ALLOWED_REACTIONS.includes(obj.emoji as ReactionEmoji)) return null;

  return { emoji: obj.emoji as ReactionEmoji };
}

/** Valida RTCOfferPayload */
export function validateOfferPayload(
  data: unknown,
): { targetId: string; offer: RTCOfferPayload } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.targetId !== 'string' || obj.targetId.trim().length === 0) return null;
  if (!obj.offer || typeof obj.offer !== 'object' || Array.isArray(obj.offer)) return null;

  const offer = obj.offer as Record<string, unknown>;
  if (offer.type !== 'offer') return null;
  if (typeof offer.sdp !== 'string' || offer.sdp.length === 0 || offer.sdp.length > 200_000) {
    return null;
  }

  const resultOffer: RTCOfferPayload = {
    type: 'offer',
    sdp: offer.sdp,
  };

  // Reconstrói a config só com campos conhecidos (nada de propriedades extras repassadas)
  const cleanConfig = sanitizeStreamConfig(offer.config);
  if (cleanConfig) resultOffer.config = cleanConfig;

  return {
    targetId: obj.targetId,
    offer: resultOffer,
  };
}

/** Valida RTCAnswerPayload */
export function validateAnswerPayload(
  data: unknown,
): { targetId: string; answer: RTCAnswerPayload } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.targetId !== 'string' || obj.targetId.trim().length === 0) return null;
  if (!obj.answer || typeof obj.answer !== 'object' || Array.isArray(obj.answer)) return null;

  const answer = obj.answer as Record<string, unknown>;
  if (answer.type !== 'answer') return null;
  if (typeof answer.sdp !== 'string' || answer.sdp.length === 0 || answer.sdp.length > 200_000) {
    return null;
  }

  return {
    targetId: obj.targetId,
    answer: {
      type: 'answer',
      sdp: answer.sdp,
    },
  };
}

/** Valida RTCIceCandidatePayload */
export function validateIceCandidatePayload(
  data: unknown,
): { targetId: string; candidate: RTCIceCandidatePayload } | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.targetId !== 'string' || obj.targetId.trim().length === 0) return null;
  if (!obj.candidate || typeof obj.candidate !== 'object' || Array.isArray(obj.candidate)) return null;

  const candidate = obj.candidate as Record<string, unknown>;
  if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 2000) {
    return null;
  }

  const sdpMid =
    candidate.sdpMid === null || candidate.sdpMid === undefined
      ? null
      : typeof candidate.sdpMid === 'string'
        ? candidate.sdpMid
        : null;

  const sdpMLineIndex =
    candidate.sdpMLineIndex === null || candidate.sdpMLineIndex === undefined
      ? null
      : typeof candidate.sdpMLineIndex === 'number' && Number.isInteger(candidate.sdpMLineIndex)
        ? candidate.sdpMLineIndex
        : null;

  return {
    targetId: obj.targetId,
    candidate: {
      candidate: candidate.candidate,
      sdpMid,
      sdpMLineIndex,
    },
  };
}

const ALLOWED_VIDEO_CODECS = ['H264', 'H265', 'VP9', 'VP8', 'AV1'] as const;
const ALLOWED_AUDIO_CODECS = ['opus', 'aac'] as const;
const ALLOWED_VIDEO_QUALITIES = ['low', 'medium', 'high', 'ultra'] as const;
const MAX_AUDIO_SOURCES = 32;

/** true se `n` é número finito dentro de [min, max] */
function inRange(n: unknown, min: number, max: number): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
}

/** Texto curto, sem controles/bidi */
function shortText(v: unknown, max: number): string {
  return typeof v === 'string' ? stripUnsafeChars(v).slice(0, max) : '';
}

/**
 * Valida E reconstrói um StreamConfig.
 * SEGURANÇA: o servidor retransmite esta estrutura a outros clientes; por isso só campos
 * conhecidos, com faixas e listas de valores permitidas, são copiados (sem propriedades
 * extras, strings livres nem listas gigantes). Retorna null se inválido.
 */
export function sanitizeStreamConfig(config: unknown): StreamConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const c = config as Record<string, unknown>;

  if (!c.video || typeof c.video !== 'object' || Array.isArray(c.video)) return null;
  const v = c.video as Record<string, unknown>;
  if (
    !inRange(v.width, 1, 7680) ||
    !inRange(v.height, 1, 4320) ||
    !inRange(v.frameRate, 1, 240) ||
    !inRange(v.bitrate, 1, 200_000) ||
    !ALLOWED_VIDEO_CODECS.includes(v.codec as (typeof ALLOWED_VIDEO_CODECS)[number]) ||
    !ALLOWED_VIDEO_QUALITIES.includes(v.quality as (typeof ALLOWED_VIDEO_QUALITIES)[number])
  ) {
    return null;
  }

  if (!c.audio || typeof c.audio !== 'object' || Array.isArray(c.audio)) return null;
  const a = c.audio as Record<string, unknown>;
  if (
    (a.sampleRate !== 44100 && a.sampleRate !== 48000) ||
    !inRange(a.bitrate, 1, 640) ||
    !ALLOWED_AUDIO_CODECS.includes(a.codec as (typeof ALLOWED_AUDIO_CODECS)[number]) ||
    !Array.isArray(a.sources)
  ) {
    return null;
  }

  const sources = a.sources
    .slice(0, MAX_AUDIO_SOURCES)
    .filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !Array.isArray(s))
    .map((s) => ({
      id: shortText(s.id, 64),
      processId: Number.isInteger(s.processId) ? (s.processId as number) : 0,
      processName: shortText(s.processName, 64),
      displayName: shortText(s.displayName, 64),
      volume: inRange(s.volume, 0, 1) ? s.volume : 1,
      isMuted: s.isMuted === true,
      platform: (['windows', 'linux', 'macos'] as const).includes(s.platform as 'windows')
        ? (s.platform as 'windows' | 'linux' | 'macos')
        : 'windows',
    }));

  return {
    video: {
      width: v.width,
      height: v.height,
      frameRate: v.frameRate,
      codec: v.codec as StreamConfig['video']['codec'],
      bitrate: v.bitrate,
      quality: v.quality as StreamConfig['video']['quality'],
    },
    audio: {
      sampleRate: a.sampleRate,
      bitrate: a.bitrate,
      codec: a.codec as StreamConfig['audio']['codec'],
      sources,
    },
  };
}

/** Valida StreamConfig */
export function isValidStreamConfig(config: unknown): config is StreamConfig {
  return sanitizeStreamConfig(config) !== null;
}

/** Valida QualityRequestPayload */
export function validateQualityRequestPayload(data: unknown): QualityRequestPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (
    typeof obj.preference !== 'string' ||
    !ALLOWED_QUALITY_PREFERENCES.includes(obj.preference as ViewerQualityPreference)
  ) {
    return null;
  }

  let targetHeight: number | null = null;
  if (obj.targetHeight !== undefined && obj.targetHeight !== null) {
    if (
      typeof obj.targetHeight !== 'number' ||
      !Number.isInteger(obj.targetHeight) ||
      obj.targetHeight < 144 ||
      obj.targetHeight > 4320
    ) {
      return null;
    }
    targetHeight = obj.targetHeight;
  }

  let maxBitrateKbps: number | null = null;
  if (obj.maxBitrateKbps !== undefined && obj.maxBitrateKbps !== null) {
    if (
      typeof obj.maxBitrateKbps !== 'number' ||
      !Number.isInteger(obj.maxBitrateKbps) ||
      obj.maxBitrateKbps < 100 ||
      obj.maxBitrateKbps > 100_000
    ) {
      return null;
    }
    maxBitrateKbps = obj.maxBitrateKbps;
  }

  return {
    preference: obj.preference as ViewerQualityPreference,
    targetHeight,
    maxBitrateKbps,
  };
}

const STATS_NUMERIC_FIELDS = [
  'fps',
  'videoBitrate',
  'audioBitrate',
  'latencyMs',
  'packetsLost',
  'lossPercent',
  'jitterMs',
  'timestamp',
] as const;
const ALLOWED_QUALITY_LIMITATIONS = ['none', 'cpu', 'bandwidth', 'other'] as const;
const ALLOWED_CONNECTION_QUALITIES = ['excellent', 'good', 'fair', 'poor'] as const;

/**
 * Valida E reconstrói StreamStats antes de retransmitir aos espectadores.
 * SEGURANÇA: só campos conhecidos, números finitos e enums permitidos; nada de propriedades
 * extras vindas do remetente. Retorna null se inválido.
 */
export function sanitizeStreamStats(stats: unknown): StreamStats | null {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null;
  const s = stats as Record<string, unknown>;

  const out: Record<string, unknown> = {};
  for (const field of STATS_NUMERIC_FIELDS) {
    const value = s[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e15) return null;
    out[field] = value;
  }

  if (
    !ALLOWED_QUALITY_LIMITATIONS.includes(s.qualityLimitation as (typeof ALLOWED_QUALITY_LIMITATIONS)[number]) ||
    !ALLOWED_CONNECTION_QUALITIES.includes(s.connectionQuality as (typeof ALLOWED_CONNECTION_QUALITIES)[number])
  ) {
    return null;
  }
  out.qualityLimitation = s.qualityLimitation;
  out.connectionQuality = s.connectionQuality;

  return out as unknown as StreamStats;
}

/** Valida StreamStats */
export function isValidStreamStats(stats: unknown): stats is StreamStats {
  return sanitizeStreamStats(stats) !== null;
}

/** Valida CopresentStartPayload (name opcional, máx 24 chars) */
export function validateCopresentStartPayload(data: unknown): CopresentStartPayload | null {
  if (data === null || data === undefined) return {};
  if (typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  const result: CopresentStartPayload = {};
  if ('name' in obj && obj.name !== undefined && obj.name !== null) {
    if (typeof obj.name !== 'string') return null;
    const name = sanitizeNickname(obj.name);
    if (name.length > 24) return null;
    result.name = name;
  }

  return result;
}
