import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInviteUrl, getAllowedOrigins, getPublicUrl, isOriginAllowed } from './publicUrl';

const KEYS = ['PUBLIC_URL', 'RENDER_EXTERNAL_URL', 'CLIENT_ORIGIN'];

describe('publicUrl', () => {
  beforeEach(() => {
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it('getPublicUrl: normaliza para a origem sem barra final', () => {
    process.env.PUBLIC_URL = 'https://kiara.exemplo.com/';
    expect(getPublicUrl()).toBe('https://kiara.exemplo.com');
  });

  it('getPublicUrl: aceita http só em localhost/127.0.0.1', () => {
    process.env.PUBLIC_URL = 'http://127.0.0.1:4000';
    expect(getPublicUrl()).toBe('http://127.0.0.1:4000');
    process.env.PUBLIC_URL = 'http://exemplo.com';
    expect(getPublicUrl()).toBeUndefined();
  });

  it('getPublicUrl: ignora valores inválidos e usa RENDER_EXTERNAL_URL como alternativa', () => {
    process.env.PUBLIC_URL = 'não é url';
    expect(getPublicUrl()).toBeUndefined();
    delete process.env.PUBLIC_URL;
    process.env.RENDER_EXTERNAL_URL = 'https://kiara.onrender.com';
    expect(getPublicUrl()).toBe('https://kiara.onrender.com');
  });

  it('buildInviteUrl: PUBLIC_URL > CLIENT_ORIGIN > localhost:3000, sem barra duplicada', () => {
    expect(buildInviteUrl('ABC123')).toBe('http://localhost:3000/view/ABC123');
    process.env.CLIENT_ORIGIN = 'https://cliente.exemplo.com//';
    expect(buildInviteUrl('ABC123')).toBe('https://cliente.exemplo.com/view/ABC123');
    process.env.PUBLIC_URL = 'https://publico.exemplo.com/';
    expect(buildInviteUrl('ABC123')).toBe('https://publico.exemplo.com/view/ABC123');
  });

  it('isOriginAllowed: sem Origin permitido; allowlist exata; demais recusadas', () => {
    process.env.PUBLIC_URL = 'https://kiara.exemplo.com';
    expect(isOriginAllowed(undefined, 3001)).toBe(true);
    expect(isOriginAllowed('https://kiara.exemplo.com/', 3001)).toBe(true);
    expect(isOriginAllowed('http://localhost:3001', 3001)).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:3001', 3001)).toBe(true);
    expect(isOriginAllowed('http://localhost:9999', 3001)).toBe(false);
    expect(isOriginAllowed('https://evil.example.com', 3001)).toBe(false);
    expect(isOriginAllowed('https://kiara.exemplo.com.evil.com', 3001)).toBe(false);
  });

  it('getAllowedOrigins: sem duplicatas', () => {
    process.env.CLIENT_ORIGIN = 'http://localhost:3000';
    const list = getAllowedOrigins(3001);
    expect(new Set(list).size).toBe(list.length);
  });
});
