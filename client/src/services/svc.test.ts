import { describe, expect, it } from 'vitest';
import { SVC_LOW_QUALITY_FPS, maxFramerateFor, scalabilityModeFor } from './webrtcShared';

describe('scalabilityModeFor', () => {
  it('usa camadas temporais L1T3 em VP9 e AV1', () => {
    expect(scalabilityModeFor('VP9')).toBe('L1T3');
    expect(scalabilityModeFor('AV1')).toBe('L1T3');
  });

  it('mantém L1T1 nos demais codecs', () => {
    for (const codec of ['H264', 'H265', 'VP8', 'auto'] as const) {
      expect(scalabilityModeFor(codec)).toBe('L1T1');
    }
    expect(scalabilityModeFor(undefined)).toBe('L1T1');
  });
});

describe('maxFramerateFor', () => {
  it('mantém o FPS configurado para 720p ou mais e para o modo automático', () => {
    expect(maxFramerateFor(60, null)).toBe(60);
    expect(maxFramerateFor(60, 1080)).toBe(60);
    expect(maxFramerateFor(60, 720)).toBe(60);
  });

  it('limita a 30 FPS quem pediu 480p ou menos', () => {
    expect(maxFramerateFor(60, 480)).toBe(SVC_LOW_QUALITY_FPS);
    expect(maxFramerateFor(60, 360)).toBe(SVC_LOW_QUALITY_FPS);
  });

  it('nunca sobe o FPS acima do configurado', () => {
    expect(maxFramerateFor(24, 480)).toBe(24);
  });

  it('usa 60 quando o FPS não está definido', () => {
    expect(maxFramerateFor(undefined, null)).toBe(60);
    expect(maxFramerateFor(0, 360)).toBe(30);
  });
});
