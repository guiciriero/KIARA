/**
 * Wrapper para execução segura de handlers Socket.IO.
 */

import type { Socket } from 'socket.io';
import type { RoomErrorPayload } from '@screen-share/shared';
import { logger } from '../utils/logger';

/** Wrapper para execução segura de handlers Socket.IO */
export function safe(
  socket: Socket,
  fn: (...args: unknown[]) => Promise<void> | void,
  emitErrorOnThrow: boolean = true,
): (...args: unknown[]) => void {
  return (...args: unknown[]) => {
    try {
      const res = fn(...args);
      if (res && typeof res.catch === 'function') {
        res.catch((err: unknown) => {
          logger.error(`Exceção assíncrona no socket ${socket.id.slice(0, 8)}:`, err);
          if (emitErrorOnThrow && socket.connected) {
            const errorPayload: RoomErrorPayload = {
              code: 'internal',
              message: 'Ocorreu um erro interno ao processar a solicitação.',
            };
            socket.emit('room:error', errorPayload);
          }
        });
      }
    } catch (err) {
      logger.error(`Exceção síncrona no socket ${socket.id.slice(0, 8)}:`, err);
      if (emitErrorOnThrow && socket.connected) {
        const errorPayload: RoomErrorPayload = {
          code: 'internal',
          message: 'Ocorreu um erro interno ao processar a solicitação.',
        };
        socket.emit('room:error', errorPayload);
      }
    }
  };
}
