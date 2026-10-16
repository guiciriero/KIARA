/**
 * useChat.ts
 * Chat e reações da sala (válido para apresentador e espectador).
 * O servidor difunde `chat:message` / `chat:reaction` a toda a sala, inclusive ao remetente.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../services/SocketContext';
import type { ChatMessage, ReactionEvent, ReactionEmoji, SendChatPayload, SendReactionPayload } from '@shared/index';

export const REACTION_EMOJIS: ReactionEmoji[] = ['👍', '❤️', '😂', '😮', '👏', '🔥'];

export const MAX_CHAT_MESSAGES = 200;
export const MAX_CHAT_TEXT_LENGTH = 500;
/** Tempo (ms) que uma reação permanece visível */
export const REACTION_TTL_MS = 4000;

export function useChat() {
  const { socket } = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
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

    const onMessage = (msg: ChatMessage) => {
      setMessages((prev) => [...prev, msg].slice(-MAX_CHAT_MESSAGES));
      setUnreadCount((n) => n + 1);
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
      setMessages([]);
      setReactions([]);
      setUnreadCount(0);
    };

    socket.on('chat:message', onMessage);
    socket.on('chat:reaction', onReaction);
    socket.on('connect', reset);
    socket.on('room:host-disconnected', reset);

    return () => {
      socket.off('chat:message', onMessage);
      socket.off('chat:reaction', onReaction);
      socket.off('connect', reset);
      socket.off('room:host-disconnected', reset);
      clearExpiry();
    };
  }, [socket]);

  const sendMessage = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!socket || clean.length === 0) return;
      const payload: SendChatPayload = { text: clean.slice(0, MAX_CHAT_TEXT_LENGTH) };
      socket.emit('chat:message', payload);
    },
    [socket],
  );

  const sendReaction = useCallback(
    (emoji: ReactionEmoji) => {
      if (!socket || !REACTION_EMOJIS.includes(emoji)) return;
      const payload: SendReactionPayload = { emoji };
      socket.emit('chat:reaction', payload);
    },
    [socket],
  );

  const markRead = useCallback(() => setUnreadCount(0), []);

  return { messages, reactions, sendMessage, sendReaction, unreadCount, markRead };
}
