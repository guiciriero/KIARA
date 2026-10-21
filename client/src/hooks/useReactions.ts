/**
 * useReactions.ts
 * Reações com emoji da sala (válido para apresentador e espectador).
 * O servidor difunde `chat:reaction` a toda a sala, inclusive ao remetente.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../services/SocketContext';
import type { ReactionEvent, ReactionEmoji, SendReactionPayload } from '@shared/index';

export const REACTION_EMOJIS: ReactionEmoji[] = ['👍', '❤️', '😂', '😮', '👏', '🔥'];

/** Tempo (ms) que uma reação permanece visível */
export const REACTION_TTL_MS = 4000;

export function useReactions() {
  const { socket } = useSocket();
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const expiryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!socket) return;

    const clearExpiry = () => {
      if (expiryTimerRef.current) {
        clearTimeout(expiryTimerRef.current);
        expiryTimerRef.current = null;
      }
    };

    /** Agenda a próxima expiração (a mais antiga) e remove as vencidas */
    const scheduleExpiry = (list: ReactionEvent[]) => {
      clearExpiry();
      if (list.length === 0) return;
      const oldest = Math.min(...list.map((r) => r.timestamp));
      const wait = Math.max(0, oldest + REACTION_TTL_MS - Date.now());
      expiryTimerRef.current = setTimeout(() => {
        expiryTimerRef.current = null;
        setReactions((prev) => {
          const alive = prev.filter((r) => Date.now() - r.timestamp < REACTION_TTL_MS);
          scheduleExpiry(alive);
          return alive;
        });
      }, wait);
    };

    const onReaction = (reaction: ReactionEvent) => {
      const stableId =
        reaction.id || `${reaction.senderId}-${reaction.timestamp}-${Math.random().toString(36).slice(2, 8)}`;
      const safeReaction: ReactionEvent = { ...reaction, id: stableId };

      setReactions((prev) => {
        const alive = prev.filter((r) => Date.now() - r.timestamp < REACTION_TTL_MS);
        const next = [...alive, safeReaction].slice(-60);
        scheduleExpiry(next);
        return next;
      });
    };

    const reset = () => {
      clearExpiry();
      setReactions([]);
    };

    socket.on('chat:reaction', onReaction);
    socket.on('connect', reset);
    socket.on('room:host-disconnected', reset);

    return () => {
      socket.off('chat:reaction', onReaction);
      socket.off('connect', reset);
      socket.off('room:host-disconnected', reset);
      clearExpiry();
    };
  }, [socket]);

  const sendReaction = useCallback(
    (emoji: ReactionEmoji) => {
      if (!socket || !REACTION_EMOJIS.includes(emoji)) return;
      const payload: SendReactionPayload = { emoji };
      socket.emit('chat:reaction', payload);
    },
    [socket],
  );

  return { reactions, sendReaction };
}
