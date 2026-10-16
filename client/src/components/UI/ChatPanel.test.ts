import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactionEvent } from '@shared/index';
import ChatPanel, { ReactionOverlay } from './ChatPanel';

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

describe('ChatPanel', () => {
  const baseProps = {
    messages: [],
    reactions: [],
    unreadCount: 0,
    onSend: () => undefined,
    onReact: () => undefined,
    onMarkRead: () => undefined,
  };

  it('renderiza botões de chat e reações quando habilitados', () => {
    const out = renderToStaticMarkup(
      createElement(ChatPanel, { ...baseProps, chatEnabled: true, reactionsEnabled: true }),
    );
    expect(out).toContain('aria-label="Reações"');
    expect(out).toContain('title="Chat"');
  });

  it('esconde o chat quando chatEnabled for false', () => {
    const out = renderToStaticMarkup(
      createElement(ChatPanel, { ...baseProps, chatEnabled: false, reactionsEnabled: true }),
    );
    expect(out).not.toContain('title="Chat"');
    expect(out).toContain('aria-label="Reações"');
  });

  it('esconde as reações quando reactionsEnabled for false', () => {
    const out = renderToStaticMarkup(
      createElement(ChatPanel, { ...baseProps, chatEnabled: true, reactionsEnabled: false }),
    );
    expect(out).toContain('title="Chat"');
    expect(out).not.toContain('aria-label="Reações"');
  });

  it('retorna null / vazio quando ambos estiverem desabilitados', () => {
    const out = renderToStaticMarkup(
      createElement(ChatPanel, { ...baseProps, chatEnabled: false, reactionsEnabled: false }),
    );
    expect(out).toBe('');
  });
});
