import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactionEvent } from '@shared/index';
import ReactionBar, { ReactionOverlay } from './Reactions';

describe('ReactionOverlay', () => {
  it('renderiza múltiplos emojis simultâneos sem colisão ou erro', () => {
    const reactions: ReactionEvent[] = [
      { id: 'rec-1', senderId: 'user1', name: 'Alice', emoji: '❤️', timestamp: 1000 },
      { id: 'rec-2', senderId: 'user2', name: 'Bob', emoji: '🔥', timestamp: 1000 },
      { id: 'rec-3', senderId: 'user1', name: 'Alice', emoji: '👏', timestamp: 1005 },
    ];
    const out = renderToStaticMarkup(createElement(ReactionOverlay, { reactions, enabled: true }));
    expect(out).toContain('❤️');
    expect(out).toContain('🔥');
    expect(out).toContain('👏');
    expect(out).toContain('title="Alice"');
    expect(out).toContain('title="Bob"');
  });

  it('não renderiza nada quando desabilitado', () => {
    const reactions: ReactionEvent[] = [
      { id: 'rec-1', senderId: 'user1', name: 'Alice', emoji: '❤️', timestamp: 1000 },
    ];
    const out = renderToStaticMarkup(createElement(ReactionOverlay, { reactions, enabled: false }));
    expect(out).toBe('');
  });
});

describe('ReactionBar', () => {
  it('renderiza os botões de reação quando habilitada', () => {
    const out = renderToStaticMarkup(createElement(ReactionBar, { onReact: () => undefined, enabled: true }));
    expect(out).toContain('aria-label="Reações"');
    expect(out).toContain('aria-label="Reagir com 🔥"');
  });

  it('some quando as reações estão desligadas', () => {
    const out = renderToStaticMarkup(createElement(ReactionBar, { onReact: () => undefined, enabled: false }));
    expect(out).toBe('');
  });

  it('não mostra nenhum controle de chat', () => {
    const out = renderToStaticMarkup(createElement(ReactionBar, { onReact: () => undefined }));
    expect(out).not.toContain('Chat');
    expect(out).not.toContain('mensagem');
  });
});
