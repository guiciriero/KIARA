/**
 * Utilitários de rate-limiting para a sinalização (anti-força-bruta).
 */

import type { SignalingState } from './state';

/** Anti-força-bruta: máximo de tentativas falhas de room:join por socket na janela */
export const MAX_JOIN_FAILURES = 8;
export const JOIN_FAILURE_WINDOW_MS = 60_000;

/**
 * SEGURANÇA (anti-força-bruta além do socket): o limite por socket sozinho é contornado
 * reconectando. Por isso há também limites por IP e por sala (senha), mantidos por instância
 * de setupSignaling (ver dentro dela).
 */
export const MAX_JOIN_FAILURES_PER_IP = 40;
export const MAX_PASSWORD_FAILURES_PER_ROOM = 30;
export const ROOM_PASSWORD_WINDOW_MS = 5 * 60_000;

/** Limite geral de eventos por socket (inunda ICE/stats/nome/qualidade): descarta o excesso */
export const EVENT_WINDOW_MS = 10_000;
export const EVENT_LIMIT = 600;
export const EVENT_HARD_LIMIT = 3_000; // acima disto o socket é desconectado

/** Timestamps recentes de uma chave (poda os antigos) */
export function recentHits(map: Map<string, number[]>, key: string, windowMs: number): number[] {
  const cutoff = Date.now() - windowMs;
  const recent = (map.get(key) ?? []).filter((t) => t > cutoff);
  map.set(key, recent);
  return recent;
}

/** Remove chaves sem eventos recentes (evita crescimento ilimitado do mapa) */
export function sweepHits(map: Map<string, number[]>, windowMs: number): void {
  const cutoff = Date.now() - windowMs;
  for (const [key, list] of map) {
    if (!list.some((t) => t > cutoff)) map.delete(key);
  }
}

export function recentJoinFailures(state: SignalingState, socketId: string): number[] {
  const cutoff = Date.now() - JOIN_FAILURE_WINDOW_MS;
  const recent = (state.joinFailures.get(socketId) ?? []).filter((t) => t > cutoff);
  state.joinFailures.set(socketId, recent);
  return recent;
}

export function registerJoinFailure(state: SignalingState, socketId: string): void {
  recentJoinFailures(state, socketId).push(Date.now());
}
