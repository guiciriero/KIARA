import React from 'react';
import type { ReactionEmoji, ReactionEvent } from '@shared/index';
import { REACTION_EMOJIS } from '../../hooks/useReactions';
import styles from './Reactions.module.css';

/** Reações flutuantes sobre o vídeo (decorativas) */
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

interface BarProps {
  onReact: (emoji: ReactionEmoji) => void;
  /** Reações desligadas pelo apresentador: a barra some */
  enabled?: boolean;
  /** Retorna true se o nome já está definido (exigido antes de reagir) */
  onRequestName?: () => boolean;
}

/** Botões de reação na barra do player */
const ReactionBar: React.FC<BarProps> = ({ onReact, enabled = true, onRequestName }) => {
  if (!enabled) return null;

  const handleReact = (emoji: ReactionEmoji) => {
    if (onRequestName && !onRequestName()) return;
    onReact(emoji);
  };

  return (
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
  );
};

export default ReactionBar;
