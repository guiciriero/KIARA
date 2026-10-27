import { describe, it, expect, vi } from 'vitest';
import {
  DATA_SAVER_STORAGE_KEY,
  getNetworkConnection,
  isConstrainedConnection,
  parseStoredDataSaver,
  readStoredDataSaver,
  resolveDataSaver,
  storeDataSaver,
  subscribeConnectionChange,
} from './dataSaver';

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe('dataSaver', () => {
  it('sem a API de conexão, o padrão é desligado', () => {
    expect(getNetworkConnection({})).toBeNull();
    expect(isConstrainedConnection(null)).toBe(false);
    expect(isConstrainedConnection(undefined)).toBe(false);
    expect(resolveDataSaver(null, null)).toBe(false);
  });

  it('liga por padrão com saveData ou rede lenta (slow-2g, 2g, 3g)', () => {
    expect(isConstrainedConnection({ saveData: true, effectiveType: '4g' })).toBe(true);
    expect(isConstrainedConnection({ effectiveType: 'slow-2g' })).toBe(true);
    expect(isConstrainedConnection({ effectiveType: '2g' })).toBe(true);
    expect(isConstrainedConnection({ effectiveType: '3g' })).toBe(true);
  });

  it('mantém desligado em 4g sem saveData', () => {
    expect(isConstrainedConnection({ effectiveType: '4g' })).toBe(false);
    expect(isConstrainedConnection({ saveData: false, effectiveType: '4g' })).toBe(false);
    expect(isConstrainedConnection({})).toBe(false);
  });

  it('interpreta o valor salvo', () => {
    expect(parseStoredDataSaver('1')).toBe(true);
    expect(parseStoredDataSaver('0')).toBe(false);
    expect(parseStoredDataSaver('talvez')).toBeNull();
    expect(parseStoredDataSaver(null)).toBeNull();
  });

  it('a escolha salva vence o padrão da conexão', () => {
    expect(resolveDataSaver(false, { saveData: true })).toBe(false);
    expect(resolveDataSaver(true, { effectiveType: '4g' })).toBe(true);
    expect(resolveDataSaver(null, { effectiveType: '2g' })).toBe(true);
  });

  it('persiste e lê a escolha no armazenamento', () => {
    const storage = fakeStorage();
    expect(readStoredDataSaver(storage)).toBeNull();
    storeDataSaver(true, storage);
    expect(storage.data[DATA_SAVER_STORAGE_KEY]).toBe('1');
    expect(readStoredDataSaver(storage)).toBe(true);
    storeDataSaver(false, storage);
    expect(readStoredDataSaver(storage)).toBe(false);
  });

  it('tolera armazenamento que lança erro', () => {
    const quebrado = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(readStoredDataSaver(quebrado)).toBeNull();
    expect(() => storeDataSaver(true, quebrado)).not.toThrow();
  });

  it('assina e cancela o evento change; sem API vira no-op', () => {
    const add = vi.fn();
    const remove = vi.fn();
    const listener = () => {};
    const off = subscribeConnectionChange({ addEventListener: add, removeEventListener: remove }, listener);
    expect(add).toHaveBeenCalledWith('change', listener);
    off();
    expect(remove).toHaveBeenCalledWith('change', listener);

    expect(() => subscribeConnectionChange(null, listener)()).not.toThrow();
    expect(() => subscribeConnectionChange({}, listener)()).not.toThrow();
  });
});
