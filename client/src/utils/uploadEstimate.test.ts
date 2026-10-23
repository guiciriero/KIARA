import { describe, it, expect } from 'vitest';
import {
  estimateUploadMbps,
  recommendedUploadMbps,
  uploadAdvice,
  UPLOAD_MARGIN_FACTOR,
} from './uploadEstimate';

describe('UPLOAD_MARGIN_FACTOR', () => {
  it('é 1,5 (50% de margem sobre o bitrate)', () => {
    expect(UPLOAD_MARGIN_FACTOR).toBe(1.5);
  });
});

describe('estimateUploadMbps', () => {
  it('multiplica bitrate por espectadores e converte para Mbps', () => {
    expect(estimateUploadMbps(8000, 1)).toBe(8);
    expect(estimateUploadMbps(8000, 3)).toBe(24);
  });

  it('arredonda a 0,1 Mbps', () => {
    expect(estimateUploadMbps(1234, 3)).toBe(3.7);
    expect(estimateUploadMbps(1000, 0)).toBe(0);
  });

  it('trata entradas inválidas como zero', () => {
    expect(estimateUploadMbps(-5, 3)).toBe(0);
    expect(estimateUploadMbps(NaN, 3)).toBe(0);
    expect(estimateUploadMbps(5000, NaN)).toBe(0);
  });
});

describe('recommendedUploadMbps', () => {
  it('aplica margem de 1,5× sobre o estimado', () => {
    // 8 Mbps × 1,5 = 12 Mbps
    expect(recommendedUploadMbps(8000, 1)).toBe(12);
    // 12 Mbps × 1,5 = 18 Mbps
    expect(recommendedUploadMbps(12000, 1)).toBe(18);
  });

  it('escala com o número de espectadores', () => {
    // 8 Mbps × 2 espectadores × 1,5 = 24 Mbps
    expect(recommendedUploadMbps(8000, 2)).toBe(24);
  });

  it('arredonda a 0,1 Mbps', () => {
    // 1234 kbps × 3 espectadores = 3,702 Mbps → estimado 3,7; recomendado 3,7 × 1,5 = 5,55 → 5,6
    expect(recommendedUploadMbps(1234, 3)).toBe(5.6);
  });

  it('retorna 0 para entradas inválidas', () => {
    expect(recommendedUploadMbps(0, 1)).toBe(0);
    expect(recommendedUploadMbps(NaN, 1)).toBe(0);
  });
});

describe('uploadAdvice', () => {
  it('classifica pelos limites 20 e 50 Mbps', () => {
    expect(uploadAdvice(0)).toBe('ok');
    expect(uploadAdvice(8)).toBe('ok');   // 8 Mbps estimado → ok
    expect(uploadAdvice(20)).toBe('ok');
    expect(uploadAdvice(20.1)).toBe('warning');
    expect(uploadAdvice(50)).toBe('warning');
    expect(uploadAdvice(50.1)).toBe('danger');
  });
});
