import { beforeEach, describe, expect, it } from 'vitest';
import {
  PERMANENT_CODE_KEY,
  buildPermanentLink,
  getOrCreatePermanentRoomCode,
  savePermanentRoomCode,
} from './permanentRoom';
import { isValidRoomCode } from './viewerLink';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => Array.from(data.keys())[i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, String(v)); },
  };
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true });
});

describe('permanentRoom', () => {
  it('gera e persiste um código válido na primeira chamada', () => {
    const code = getOrCreatePermanentRoomCode();
    expect(isValidRoomCode(code)).toBe(true);
    expect(localStorage.getItem(PERMANENT_CODE_KEY)).toBe(code);
  });

  it('reutiliza sempre o mesmo código', () => {
    expect(getOrCreatePermanentRoomCode()).toBe(getOrCreatePermanentRoomCode());
  });

  it('normaliza o código salvo em minúsculas', () => {
    localStorage.setItem(PERMANENT_CODE_KEY, 'abc234');
    expect(getOrCreatePermanentRoomCode()).toBe('ABC234');
  });

  it('descarta valor inválido e gera outro', () => {
    localStorage.setItem(PERMANENT_CODE_KEY, 'inválido');
    const code = getOrCreatePermanentRoomCode();
    expect(isValidRoomCode(code)).toBe(true);
    expect(localStorage.getItem(PERMANENT_CODE_KEY)).toBe(code);
  });

  it('savePermanentRoomCode atualiza o código guardado', () => {
    savePermanentRoomCode('abc234');
    expect(getOrCreatePermanentRoomCode()).toBe('ABC234');
  });

  it('monta o link sem barra duplicada', () => {
    expect(buildPermanentLink('https://x.com/', 'ABC234')).toBe('https://x.com/view/ABC234');
  });
});
