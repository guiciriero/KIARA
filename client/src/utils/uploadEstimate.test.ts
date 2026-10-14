import { describe, it, expect } from 'vitest';
import { estimateUploadMbps, uploadAdvice } from './uploadEstimate';

describe('estimateUploadMbps', () => {
  it('multiplica bitrate por espectadores e converte para Mbps', () => {
    expect(estimateUploadMbps(5000, 4)).toBe(20);
    expect(estimateUploadMbps(8000, 1)).toBe(8);
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

describe('uploadAdvice', () => {
  it('classifica pelos limites 20 e 50 Mbps', () => {
    expect(uploadAdvice(0)).toBe('ok');
    expect(uploadAdvice(20)).toBe('ok');
    expect(uploadAdvice(20.1)).toBe('warning');
    expect(uploadAdvice(50)).toBe('warning');
    expect(uploadAdvice(50.1)).toBe('danger');
  });
});
