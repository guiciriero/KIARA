import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UpdateState } from '@shared/index';
import { UpdateView } from './UpdateButton';

const html = (state: UpdateState | null) =>
  renderToStaticMarkup(
    createElement(UpdateView, { state, onCheck: () => undefined, onDownload: () => undefined, onInstall: () => undefined }),
  );
const base = { currentVersion: '1.0.0' };

describe('UpdateView', () => {
  it('idle mostra "Atualizar"', () => {
    expect(html({ ...base, status: 'idle' })).toContain('Atualizar');
  });
  it('verificando', () => {
    expect(html({ ...base, status: 'checking' })).toContain('Verificando');
  });
  it('atualizado', () => {
    expect(html({ ...base, status: 'not-available' })).toContain('atualizado');
  });
  it('disponível mostra a versão', () => {
    const out = html({ ...base, status: 'available', latestVersion: '1.0.7' });
    expect(out).toContain('1.0.7');
    expect(out).toContain('Baixar');
  });
  it('baixando mostra o progresso', () => {
    const out = html({ ...base, status: 'downloading', progress: 37 });
    expect(out).toContain('37%');
    expect(out).toContain('<progress');
  });
  it('baixado oferece reiniciar', () => {
    expect(html({ ...base, status: 'downloaded', progress: 100 })).toContain('Reiniciar e atualizar');
  });
  it('erro com alerta e "Tentar novamente"', () => {
    const out = html({ ...base, status: 'error', message: 'Sem conexão' });
    expect(out).toContain('role="alert"');
    expect(out).toContain('Tentar novamente');
  });
  it('região aria-live', () => {
    expect(html(null)).toContain('aria-live="polite"');
  });
});
