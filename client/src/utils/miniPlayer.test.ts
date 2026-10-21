import { describe, it, expect } from 'vitest';
import {
  clampMiniWidth,
  parseStoredMiniWidth,
  MINI_DEFAULT_WIDTH,
  MINI_MAX_WIDTH,
  MINI_MIN_WIDTH,
} from './miniPlayer';

describe('clampMiniWidth', () => {
  it('mantém valores dentro do limite (arredondando)', () => {
    expect(clampMiniWidth(300)).toBe(300);
    expect(clampMiniWidth(300.6)).toBe(301);
  });

  it('limita ao mínimo e ao máximo', () => {
    expect(clampMiniWidth(10)).toBe(MINI_MIN_WIDTH);
    expect(clampMiniWidth(9999)).toBe(MINI_MAX_WIDTH);
  });

  it('valor inválido volta ao padrão', () => {
    expect(clampMiniWidth(NaN)).toBe(MINI_DEFAULT_WIDTH);
    expect(clampMiniWidth(Infinity)).toBe(MINI_DEFAULT_WIDTH);
  });
});

describe('parseStoredMiniWidth', () => {
  it('sem valor salvo usa o padrão', () => {
    expect(parseStoredMiniWidth(null)).toBe(MINI_DEFAULT_WIDTH);
    expect(parseStoredMiniWidth('')).toBe(MINI_DEFAULT_WIDTH);
    expect(parseStoredMiniWidth('   ')).toBe(MINI_DEFAULT_WIDTH);
  });

  it('lê o valor salvo e respeita os limites', () => {
    expect(parseStoredMiniWidth('320')).toBe(320);
    expect(parseStoredMiniWidth('5000')).toBe(MINI_MAX_WIDTH);
  });

  it('texto corrompido usa o padrão', () => {
    expect(parseStoredMiniWidth('abc')).toBe(MINI_DEFAULT_WIDTH);
  });
});
