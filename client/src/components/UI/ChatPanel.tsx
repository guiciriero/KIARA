import React, { useEffect, useRef, useState } from 'react';
import type { ChatMessage, ReactionEmoji, ReactionEvent } from '@shared/index';
import { IconMessageSquare, IconSend, IconX } from './Icons';
import { REACTION_EMOJIS, MAX_CHAT_TEXT_LENGTH } from '../../hooks/useChat';
import styles from './ChatPanel.module.css';

interface Props {
  messages: ChatMessage[];
  reactions: ReactionEvent[];
  unreadCount: number;
  onSend: (text: string) => void;
  onReact: (emoji: ReactionEmoji) => void;
  onMarkRead: () => void;
  /** Id do socket local, para destacar as próprias mensagens */
  selfId?: string;
  chatEnabled?: boolean;
  reactionsEnabled?: boolean;
  currentName?: string;
  onUpdateName?: (name: string) => void;
  onRequestName?: () => boolean; // retorna true se o nome é válido / configurado
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

/** Reações flutuantes sobre o vídeo (decorativas: o texto vai para a região aria-live do chat) */
export const ReactionOverlay: React.FC<{
  reactions: ReactionEvent[];
  enabled?: boolean;
}> = ({ reactions, enabled = true }) => {
  if (!enabled || reactions.length === 0) return null;

  return (
    <div className={styles.reactionOverlay} aria-hidden="true">
      {reactions.map((r) => {
        let hash = 0;
        const seed = r.id || `${r.senderId}-${r.timestamp}`;
        for (let j = 0; j < seed.length; j++) {
          hash = (hash << 5) - hash + seed.charCodeAt(j);
          hash |= 0;
        }
        const pos = Math.abs(hash);
        const leftPercent = 8 + (pos % 78);
        const scale = 0.85 + ((pos >> 2) % 4) * 0.1;

        return (
          <span
            key={r.id || `${r.senderId}-${r.timestamp}`}
            className={styles.floatingReaction}
            style={{
              left: `${leftPercent}%`,
              transform: `scale(${scale}) translate3d(0, 0, 0)`,
            }}
            title={r.name}
          >
            {r.emoji}
          </span>
        );
      })}
    </div>
  );
};

const ChatPanel: React.FC<Props> = ({
  messages,
  unreadCount,
  onSend,
  onReact,
  onMarkRead,
  selfId,
  chatEnabled = true,
  reactionsEnabled = true,
  currentName,
  onUpdateName,
  onRequestName,
}) => {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInputValue, setNameInputValue] = useState(currentName || '');
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (currentName !== undefined) {
      setNameInputValue(currentName);
    }
  }, [currentName]);

  useEffect(() => {
    if (open) {
      onMarkRead();
      inputRef.current?.focus();
    }
  }, [open, messages.length, onMarkRead]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, open]);

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  const handleReact = (emoji: ReactionEmoji) => {
    if (!reactionsEnabled) return;
    if (onRequestName && !onRequestName()) {
      return;
    }
    onReact(emoji);
  };

  const handleSaveName = (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = nameInputValue.trim();
    if (clean.length > 0 && onUpdateName) {
      onUpdateName(clean);
    }
    setIsEditingName(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatEnabled) return;
    if (onRequestName && !onRequestName()) {
      return;
    }
    if (text.trim().length === 0) return;
    onSend(text);
    setText('');
  };

  if (!chatEnabled && !reactionsEnabled) {
    return null;
  }

  return (
    <div className={styles.wrapper}>
      {chatEnabled && (
        <button
          ref={toggleRef}
          type="button"
          className={styles.toggleBtn}
          onClick={() => (open ? close() : setOpen(true))}
          aria-expanded={open}
          aria-controls="kiara-chat-panel"
          aria-label={
            unreadCount > 0 && !open ? `Abrir chat, ${unreadCount} mensagens novas` : open ? 'Fechar chat' : 'Abrir chat'
          }
          title="Chat"
        >
          <IconMessageSquare size={18} />
          {unreadCount > 0 && !open && (
            <span className={styles.badge} aria-hidden="true">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      )}

      {reactionsEnabled && (
        <div className={styles.reactionBar} role="group" aria-label="Reações">
          {REACTION_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={styles.reactionBtn}
              onClick={() => handleReact(emoji)}
              aria-label={`Reagir com ${emoji}`}
            >
              <span aria-hidden="true">{emoji}</span>
            </button>
          ))}
        </div>
      )}

      {chatEnabled && open && (
        <section
          id="kiara-chat-panel"
          className={styles.panel}
          aria-label="Chat da sala"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className={styles.panelHeader}>
            <span>Chat da sala</span>
            <button type="button" className={styles.closeBtn} onClick={close} aria-label="Fechar chat">
              <IconX size={16} />
            </button>
          </div>

          {onUpdateName && (
            <div className={styles.userBadgeRow}>
              {isEditingName ? (
                <form onSubmit={handleSaveName} style={{ display: 'flex', gap: '4px', width: '100%', alignItems: 'center' }}>
                  <input
                    type="text"
                    maxLength={24}
                    value={nameInputValue}
                    onChange={(e) => setNameInputValue(e.target.value)}
                    className={styles.nameInputInline}
                    autoFocus
                    placeholder="Seu nome"
                  />
                  <button type="submit" className={styles.editNameBtn}>Salvar</button>
                  <button type="button" className={styles.editNameBtn} onClick={() => setIsEditingName(false)}>Cancelar</button>
                </form>
              ) : (
                <>
                  <span>
                    Identificado como: <strong>{currentName || 'Convidado'}</strong>
                  </span>
                  <button
                    type="button"
                    className={styles.editNameBtn}
                    onClick={() => {
                      setNameInputValue(currentName || '');
                      setIsEditingName(true);
                    }}
                  >
                    Alterar
                  </button>
                </>
              )}
            </div>
          )}

          <div
            ref={logRef}
            className={styles.log}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            tabIndex={0}
            aria-label="Mensagens"
          >
            {messages.length === 0 && <p className={styles.empty}>Nenhuma mensagem ainda.</p>}
            {messages.map((m) => (
              <div
                key={m.id}
                className={`${styles.message} ${m.senderId === selfId ? styles.mine : ''}`}
              >
                <div className={styles.meta}>
                  <span className={m.fromHost ? styles.hostName : styles.name}>
                    {m.fromHost ? `${m.name} (host)` : m.name}
                  </span>
                  <time className={styles.time} dateTime={new Date(m.timestamp).toISOString()}>
                    {formatTime(m.timestamp)}
                  </time>
                </div>
                <p className={styles.text}>{m.text}</p>
              </div>
            ))}
          </div>

          {reactionsEnabled && (
            <div className={styles.reactionRowInPanel} role="group" aria-label="Reações">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className={styles.reactionBtn}
                  onClick={() => handleReact(emoji)}
                  aria-label={`Reagir com ${emoji}`}
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              ))}
            </div>
          )}

          <form className={styles.form} onSubmit={submit}>
            <label htmlFor="kiara-chat-input" className={styles.srOnly}>Mensagem</label>
            <input
              id="kiara-chat-input"
              ref={inputRef}
              className={styles.input}
              value={text}
              maxLength={MAX_CHAT_TEXT_LENGTH}
              autoComplete="off"
              placeholder="Escreva uma mensagem"
              onChange={(e) => setText(e.target.value)}
            />
            <button
              type="submit"
              className={styles.sendBtn}
              disabled={text.trim().length === 0}
              aria-label="Enviar mensagem"
            >
              <IconSend size={16} />
            </button>
          </form>
        </section>
      )}
    </div>
  );
};

export default ChatPanel;
