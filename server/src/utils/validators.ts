/**
 * Utilitários de validação para o servidor de sinalização e salas KIARA.
 * Valida rigorosamente todos os payloads recebidos via WebSocket para prevenir falhas e injeções.
 */

import type {
  CreateRoomPayload,
  RoomFeaturesPayload,
  JoinRoomPayload,
  RespondJoinPayload,
  SendChatPayload,
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

/** Sanitiza apelido: até 24 caracteres, sem caracteres de controle */
export function sanitizeNickname(name: unknown, isHost: boolean = false): string {
  if (isHost) return 'Apresentador';
  if (typeof name !== 'string') return 'Convidado';
  // Remove caracteres de controle (0x00-0x1F, 0x7F)
  const cleaned = name.replace(/[\x00-\x1F\x7F]/g, '').trim();
  if (cleaned.length === 0) return 'Convidado';
  return cleaned.slice(0, 24);
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

  if ('chatEnabled' in obj && obj.chatEnabled !== undefined) {
    if (typeof obj.chatEnabled !== 'boolean') return { valid: false };
    result.chatEnabled = obj.chatEnabled;
  }

  if ('reactionsEnabled' in obj && obj.reactionsEnabled !== undefined) {
    if (typeof obj.reactionsEnabled !== 'boolean') return { valid: false };
    result.reactionsEnabled = obj.reactionsEnabled;
  }

  return { valid: true, payload: result };
}

/** Valida RoomFeaturesPayload */
export function validateRoomFeaturesPayload(data: unknown): RoomFeaturesPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.chatEnabled !== 'boolean' || typeof obj.reactionsEnabled !== 'boolean') {
    return null;
  }

  return {
    chatEnabled: obj.chatEnabled,
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

/** Valida SendChatPayload */
export function validateChatPayload(data: unknown): SendChatPayload | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;

  if (typeof obj.text !== 'string') return null;
  const text = obj.text.trim();
  if (text.length < 1 || text.length > 500) return null;

  return { text };
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

  if (offer.config && isValidStreamConfig(offer.config)) {
    resultOffer.config = offer.config;
  }

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

/** Valida StreamConfig */
export function isValidStreamConfig(config: unknown): config is StreamConfig {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return false;
  const c = config as Record<string, unknown>;

  if (!c.video || typeof c.video !== 'object' || Array.isArray(c.video)) return false;
  const v = c.video as Record<string, unknown>;
  if (
    typeof v.width !== 'number' ||
    !Number.isFinite(v.width) ||
    typeof v.height !== 'number' ||
    !Number.isFinite(v.height) ||
    typeof v.frameRate !== 'number' ||
    !Number.isFinite(v.frameRate) ||
    typeof v.bitrate !== 'number' ||
    !Number.isFinite(v.bitrate) ||
    typeof v.codec !== 'string' ||
    typeof v.quality !== 'string'
  ) {
    return false;
  }

  if (!c.audio || typeof c.audio !== 'object' || Array.isArray(c.audio)) return false;
  const a = c.audio as Record<string, unknown>;
  if (
    typeof a.sampleRate !== 'number' ||
    !Number.isFinite(a.sampleRate) ||
    typeof a.bitrate !== 'number' ||
    !Number.isFinite(a.bitrate) ||
    typeof a.codec !== 'string' ||
    !Array.isArray(a.sources)
  ) {
    return false;
  }

  return true;
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

/** Valida StreamStats */
export function isValidStreamStats(stats: unknown): stats is StreamStats {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return false;
  const s = stats as Record<string, unknown>;

  const numFields = [
    'fps',
    'videoBitrate',
    'audioBitrate',
    'latencyMs',
    'packetsLost',
    'lossPercent',
    'jitterMs',
    'timestamp',
  ];

  for (const field of numFields) {
    if (typeof s[field] !== 'number' || !Number.isFinite(s[field])) {
      return false;
    }
  }

  if (typeof s.qualityLimitation !== 'string' || typeof s.connectionQuality !== 'string') {
    return false;
  }

  return true;
}
