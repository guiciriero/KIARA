/**
 * joinRequests.ts
 * Fila de espectadores aguardando aprovação do apresentador (funções puras).
 */

import type { JoinRequestPayload } from '@shared/index';

/** Acrescenta o pedido; repetido (mesmo viewerId) é ignorado e devolve a mesma lista */
export function addJoinRequest(list: JoinRequestPayload[], req: JoinRequestPayload): JoinRequestPayload[] {
  return list.some((r) => r.viewerId === req.viewerId) ? list : [...list, req];
}

/** Remove o pedido do espectador (responder, cancelar ou sair da sala) */
export function removeJoinRequest(list: JoinRequestPayload[], viewerId: string | undefined): JoinRequestPayload[] {
  return list.some((r) => r.viewerId === viewerId) ? list.filter((r) => r.viewerId !== viewerId) : list;
}
