import { describe, it, expect } from 'vitest';
import { viewerReducer, INITIAL_VIEWER_STATE, isPasswordError } from './viewerReducer';
import type { ViewerAction, ViewerState } from './viewerReducer';

const run = (actions: ViewerAction[], from: ViewerState = INITIAL_VIEWER_STATE) =>
  actions.reduce(viewerReducer, from);

describe('viewerReducer', () => {
  it('joining: vai para connecting e limpa erros', () => {
    const failed = run([{ type: 'error', message: 'x', code: 'not-found' }]);
    const s = run([{ type: 'joining' }], failed);
    expect(s.connectionState).toBe('connecting');
    expect(s.error).toBeNull();
    expect(s.errorCode).toBeNull();
  });

  it.each(['password-required', 'wrong-password'] as const)('erro %s não falha: fica connecting esperando a senha', (code) => {
    const s = run([{ type: 'joining' }, { type: 'error', message: 'senha', code }]);
    expect(s.connectionState).toBe('connecting');
    expect(s.needsPassword).toBe(true);
    expect(s.wrongPassword).toBe(code === 'wrong-password');
    expect(s.errorCode).toBe(code);
    expect(isPasswordError(code)).toBe(true);
  });

  it.each(['not-found', 'closed', 'room-full', 'denied', 'rate-limited', 'internal'] as const)('erro %s ⇒ failed', (code) => {
    const s = run([{ type: 'joining' }, { type: 'error', message: 'm', code }]);
    expect(s.connectionState).toBe('failed');
    expect(s.needsPassword).toBe(false);
    expect(s.wrongPassword).toBe(false);
    expect(s.errorCode).toBe(code);
  });

  it('pending-approval liga a espera e é limpo ao entrar ou errar', () => {
    const pending = run([{ type: 'joining' }, { type: 'pending-approval' }]);
    expect(pending.pendingApproval).toBe(true);
    expect(run([{ type: 'joined', viewerCount: 2 }], pending).pendingApproval).toBe(false);
    expect(run([{ type: 'error', message: 'm', code: 'denied' }], pending).pendingApproval).toBe(false);
  });

  it('joined limpa senha pedida e registra o número de espectadores', () => {
    const s = run([
      { type: 'error', message: 'senha', code: 'wrong-password' },
      { type: 'joined', viewerCount: 3 },
    ]);
    expect(s.needsPassword).toBe(false);
    expect(s.wrongPassword).toBe(false);
    expect(s.error).toBeNull();
    expect(s.viewerCount).toBe(3);
    expect(s.connectionState).toBe('connecting');
  });

  it('stream ⇒ connected', () => {
    const stream = {} as MediaStream;
    const s = run([{ type: 'joined', viewerCount: 1 }, { type: 'stream', stream }]);
    expect(s.connectionState).toBe('connected');
    expect(s.remoteStream).toBe(stream);
  });

  it('host-disconnected ⇒ roomClosed', () => {
    const s = run([{ type: 'joined', viewerCount: 1 }, { type: 'host-disconnected' }]);
    expect(s.roomClosed).toBe(true);
    expect(s.hostDisconnected).toBe(true);
    expect(s.connectionState).toBe('disconnected');
  });

  it('socket-disconnected ⇒ reconnecting; reconnect-exhausted ⇒ roomClosed + failed', () => {
    const connected = run([{ type: 'joined', viewerCount: 1 }, { type: 'stream', stream: {} as MediaStream }]);
    const re = run([{ type: 'socket-disconnected' }], connected);
    expect(re.connectionState).toBe('reconnecting');
    const done = run([{ type: 'reconnect-exhausted' }], re);
    expect(done.roomClosed).toBe(true);
    expect(done.connectionState).toBe('failed');
  });

  it('socket-disconnected não reabre uma sala encerrada nem uma falha', () => {
    const closed = run([{ type: 'host-disconnected' }]);
    expect(run([{ type: 'socket-disconnected' }], closed)).toBe(closed);
    const failed = run([{ type: 'error', message: 'm', code: 'closed' }]);
    expect(run([{ type: 'socket-disconnected' }], failed)).toBe(failed);
  });

  it('joined depois de reconectar reabre a sala', () => {
    const s = run([{ type: 'reconnect-exhausted' }, { type: 'joined', viewerCount: 1 }]);
    expect(s.roomClosed).toBe(false);
  });

  it('quality, stats e reset', () => {
    const stats = { fps: 30 } as ViewerState['stats'];
    let s = run([{ type: 'quality', preference: '720p' }, { type: 'stats', stats: stats! }]);
    expect(s.selectedQuality).toBe('720p');
    expect(s.stats).toBe(stats);
    s = run([{ type: 'reset' }], s);
    expect(s).toEqual(INITIAL_VIEWER_STATE);
  });
});
