import { describe, it, expect } from 'vitest';
import { isValidRoomCode, normalizeRoomCode, parseViewerInput } from './viewerLink';

describe('isValidRoomCode', () => {
  it('aceita 6 caracteres do alfabeto em maiúsculas', () => {
    expect(isValidRoomCode('AB3X7K')).toBe(true);
    expect(isValidRoomCode('ZZ2999')).toBe(true);
  });

  it('rejeita minúsculas, tamanho errado e caracteres ambíguos (0, O, 1, I)', () => {
    expect(isValidRoomCode('ab3x7k')).toBe(false);
    expect(isValidRoomCode('AB3X7')).toBe(false);
    expect(isValidRoomCode('AB3X7KK')).toBe(false);
    expect(isValidRoomCode('AB3X70')).toBe(false);
    expect(isValidRoomCode('AB3XOK')).toBe(false);
    expect(isValidRoomCode('AB3X1K')).toBe(false);
    expect(isValidRoomCode('AB3XIK')).toBe(false);
  });

  it('rejeita valores que não são string', () => {
    expect(isValidRoomCode(undefined)).toBe(false);
    expect(isValidRoomCode(123456)).toBe(false);
  });
});

describe('normalizeRoomCode', () => {
  it('põe em maiúsculas e ignora espaços e hífens', () => {
    expect(normalizeRoomCode('ab3 x7k')).toBe('AB3X7K');
    expect(normalizeRoomCode('AB3-X7K')).toBe('AB3X7K');
  });

  it('devolve null para entradas inválidas', () => {
    expect(normalizeRoomCode('AB3X70')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
    expect(normalizeRoomCode(null)).toBeNull();
  });
});

describe('parseViewerInput', () => {
  it('interpreta código', () => {
    expect(parseViewerInput(' ab3-x7k ')).toEqual({ kind: 'code', code: 'AB3X7K' });
  });

  it('interpreta link https /view/CÓDIGO e reconstrói a URL canônica', () => {
    expect(parseViewerInput('https://exemplo.com/view/ab3x7k?x=1#y')).toEqual({
      kind: 'link',
      code: 'AB3X7K',
      url: 'https://exemplo.com/view/AB3X7K',
      origin: 'https://exemplo.com',
    });
  });

  it('rejeita http, credenciais e caminhos inválidos', () => {
    expect(parseViewerInput('http://exemplo.com/view/AB3X7K').kind).toBe('invalid');
    expect(parseViewerInput('https://u:p@exemplo.com/view/AB3X7K').kind).toBe('invalid');
    expect(parseViewerInput('https://exemplo.com/outra/AB3X7K').kind).toBe('invalid');
    expect(parseViewerInput('https://exemplo.com/view/AB3X70').kind).toBe('invalid');
  });
});
