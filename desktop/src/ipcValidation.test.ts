import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validatePids, validateSourceId, MAX_PIDS, MAX_ID_LENGTH } = require('./ipcValidation.js');

describe('ipcValidation', () => {
  describe('validatePids', () => {
    it('aceita lista de PIDs inteiros válidos', () => {
      const pids = [1234, 5678];
      const result = validatePids(pids);
      expect(result).toEqual([1234, 5678]);
      expect(result).not.toBe(pids); // cópia defensiva
    });

    it('rejeita não-array ou array vazio', () => {
      expect(() => validatePids(null as never)).toThrow(/Lista de PIDs inválida/);
      expect(() => validatePids([] as never)).toThrow(/Lista de PIDs inválida/);
      expect(() => validatePids('1234' as never)).toThrow(/Lista de PIDs inválida/);
    });

    it('rejeita lista com mais de MAX_PIDS itens', () => {
      const tooMany = Array.from({ length: MAX_PIDS + 1 }, (_, i) => i + 1);
      expect(() => validatePids(tooMany)).toThrow(/Lista de PIDs inválida/);
    });

    it('rejeita PIDs não inteiros, zero, negativos ou fora do intervalo u32', () => {
      expect(() => validatePids([0])).toThrow(/PID inválido/);
      expect(() => validatePids([-10])).toThrow(/PID inválido/);
      expect(() => validatePids([1.5])).toThrow(/PID inválido/);
      expect(() => validatePids([NaN])).toThrow(/PID inválido/);
      expect(() => validatePids([4294967296])).toThrow(/PID inválido/);
      expect(() => validatePids(['1234' as never])).toThrow(/PID inválido/);
    });
  });

  describe('validateSourceId', () => {
    it('aceita IDs válidos de tela/janela', () => {
      expect(validateSourceId('screen:0:0')).toBe('screen:0:0');
      expect(validateSourceId('window:12345:0')).toBe('window:12345:0');
      expect(validateSourceId('source-1.2_test')).toBe('source-1.2_test');
    });

    it('rejeita não-string ou string vazia', () => {
      expect(() => validateSourceId(null as never)).toThrow(/ID de fonte inválido/);
      expect(() => validateSourceId('' as never)).toThrow(/ID de fonte inválido/);
      expect(() => validateSourceId(123 as never)).toThrow(/ID de fonte inválido/);
    });

    it('rejeita ID que excede MAX_ID_LENGTH', () => {
      const longId = 'a'.repeat(MAX_ID_LENGTH + 1);
      expect(() => validateSourceId(longId)).toThrow(/ID de fonte inválido/);
    });

    it('rejeita caracteres não permitidos (espaços, barras, etc.)', () => {
      expect(() => validateSourceId('screen 0')).toThrow(/ID de fonte inválido/);
      expect(() => validateSourceId('screen/0')).toThrow(/ID de fonte inválido/);
      expect(() => validateSourceId('screen<0>')).toThrow(/ID de fonte inválido/);
    });
  });
});
