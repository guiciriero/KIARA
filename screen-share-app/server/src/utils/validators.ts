/**
 * Utilitários de validação para o servidor de sinalização.
 * Valida entradas antes de processar eventos WebSocket.
 */

/** Valida se um código de sala tem o formato correto */
export function isValidRoomCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  // 6 caracteres alfanuméricos maiúsculos (sem I, O, 0, 1 para evitar ambiguidade)
  return /^[A-HJ-NP-Z2-9]{6}$/.test(code);
}

/** Valida se um SDP é uma string não-vazia */
export function isValidSdp(sdp: unknown): sdp is string {
  return typeof sdp === 'string' && sdp.length > 10;
}

/** Valida payload de candidato ICE */
export function isValidIceCandidate(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  const c = candidate as Record<string, unknown>;
  return typeof c['candidate'] === 'string';
}

/** Limita o tamanho de um string para evitar payloads maliciosos */
export function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
