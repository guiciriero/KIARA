import { describe, expect, it } from 'vitest';
import {
  sanitizeNickname,
  sanitizeStreamConfig,
  sanitizeStreamStats,
  stripUnsafeChars,
  validateChatPayload,
} from './validators';

/* Testes de segurança: spoofing de apelido/chat e reconstrução de payloads retransmitidos. */

const validConfig = () => ({
  video: { width: 1920, height: 1080, frameRate: 60, codec: 'H264', bitrate: 8000, quality: 'high' },
  audio: {
    sampleRate: 48000,
    bitrate: 128,
    codec: 'opus',
    sources: [
      {
        id: 's1',
        processId: 42,
        processName: 'app.exe',
        displayName: 'App',
        volume: 0.5,
        isMuted: false,
        platform: 'windows',
      },
    ],
  },
});

const validStats = () => ({
  fps: 60,
  videoBitrate: 5000,
  audioBitrate: 128,
  latencyMs: 20,
  packetsLost: 0,
  lossPercent: 0,
  jitterMs: 1,
  timestamp: Date.now(),
  qualityLimitation: 'none',
  connectionQuality: 'good',
});

describe('stripUnsafeChars / sanitizeNickname', () => {
  it('remove marcas bidirecionais, zero-width e controles', () => {
    expect(stripUnsafeChars('a\u202Eb\u200Bc\u0007d')).toBe('abcd');
  });

  it('apelido só com caracteres invisíveis vira Convidado', () => {
    expect(sanitizeNickname('\u200B\u200E\u202E')).toBe('Convidado');
  });

  it('impede se passar pelo apresentador (inclusive com letras largas e invisíveis)', () => {
    expect(sanitizeNickname('Apresentador')).toBe('Convidado');
    expect(sanitizeNickname('apresen\u200Btador')).toBe('Convidado');
    expect(sanitizeNickname('Ａｐｒｅｓｅｎｔａｄｏｒ')).toBe('Convidado');
    expect(sanitizeNickname('Fulano (host)')).toBe('Convidado');
    expect(sanitizeNickname('Fulano ( HOST )')).toBe('Convidado');
  });

  it('host sempre é "Apresentador"; apelido normal é preservado e limitado a 24 caracteres', () => {
    expect(sanitizeNickname('qualquer', true)).toBe('Apresentador');
    expect(sanitizeNickname('  Maria  Silva ')).toBe('Maria Silva');
    expect(Array.from(sanitizeNickname('x'.repeat(100))).length).toBe(24);
    expect(sanitizeNickname(123)).toBe('Convidado');
  });
});

describe('validateChatPayload', () => {
  it('remove bidi/controles da mensagem', () => {
    expect(validateChatPayload({ text: 'oi\u202E mundo\u0000' })).toEqual({ text: 'oi mundo' });
  });

  it('rejeita mensagem composta só de caracteres invisíveis, tipos errados e tamanho excessivo', () => {
    expect(validateChatPayload({ text: '\u200B\u200B' })).toBeNull();
    expect(validateChatPayload({ text: 5 })).toBeNull();
    expect(validateChatPayload([])).toBeNull();
    expect(validateChatPayload({ text: 'a'.repeat(501) })).toBeNull();
  });
});

describe('sanitizeStreamConfig', () => {
  it('aceita config válida e a reconstrói', () => {
    const out = sanitizeStreamConfig(validConfig());
    expect(out).not.toBeNull();
    expect(out?.video.codec).toBe('H264');
    expect(out?.audio.sources).toHaveLength(1);
  });

  it('descarta propriedades extras (não retransmite lixo do remetente)', () => {
    const cfg: any = validConfig();
    cfg.evil = '<img src=x onerror=alert(1)>';
    cfg.video.extra = 'x';
    cfg.audio.sources[0].injected = { a: 1 };
    const out: any = sanitizeStreamConfig(cfg);
    expect(out.evil).toBeUndefined();
    expect(out.video.extra).toBeUndefined();
    expect(out.audio.sources[0].injected).toBeUndefined();
  });

  it('rejeita enums e faixas inválidas', () => {
    const badCodec: any = validConfig();
    badCodec.video.codec = 'EVIL';
    expect(sanitizeStreamConfig(badCodec)).toBeNull();

    const huge: any = validConfig();
    huge.video.width = 1e9;
    expect(sanitizeStreamConfig(huge)).toBeNull();

    const nan: any = validConfig();
    nan.video.frameRate = Number.NaN;
    expect(sanitizeStreamConfig(nan)).toBeNull();

    const badRate: any = validConfig();
    badRate.audio.sampleRate = 12345;
    expect(sanitizeStreamConfig(badRate)).toBeNull();

    expect(sanitizeStreamConfig(null)).toBeNull();
    expect(sanitizeStreamConfig('x')).toBeNull();
    expect(sanitizeStreamConfig([])).toBeNull();
  });

  it('limita a lista de fontes de áudio e sanitiza textos', () => {
    const cfg: any = validConfig();
    cfg.audio.sources = Array.from({ length: 500 }, () => ({
      id: 'a'.repeat(1000),
      processId: 1,
      processName: 'x\u202E'.repeat(100),
      displayName: 'd',
      volume: 99,
      isMuted: 'sim',
      platform: 'plan9',
    }));
    const out: any = sanitizeStreamConfig(cfg);
    expect(out.audio.sources.length).toBeLessThanOrEqual(32);
    const s = out.audio.sources[0];
    expect(s.id.length).toBeLessThanOrEqual(64);
    expect(s.processName).not.toMatch(/\u202E/);
    expect(s.volume).toBe(1);
    expect(s.isMuted).toBe(false);
    expect(s.platform).toBe('windows');
  });
});

describe('sanitizeStreamStats', () => {
  it('aceita stats válidas e remove propriedades extras', () => {
    const out: any = sanitizeStreamStats({ ...validStats(), evil: 'x' });
    expect(out).not.toBeNull();
    expect(out.evil).toBeUndefined();
    expect(out.fps).toBe(60);
  });

  it('rejeita números não finitos, enums inválidos e tipos errados', () => {
    expect(sanitizeStreamStats({ ...validStats(), fps: Infinity })).toBeNull();
    expect(sanitizeStreamStats({ ...validStats(), fps: '60' })).toBeNull();
    expect(sanitizeStreamStats({ ...validStats(), connectionQuality: 'otima' })).toBeNull();
    expect(sanitizeStreamStats({ ...validStats(), qualityLimitation: 'x' })).toBeNull();
    expect(sanitizeStreamStats(null)).toBeNull();
    expect(sanitizeStreamStats([])).toBeNull();
  });
});
