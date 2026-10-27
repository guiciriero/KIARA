'use strict';

/**
 * Validação de argumentos dos canais IPC (módulo PURO). Testado em ipcValidation.test.ts.
 */

const MAX_PIDS = 16;
const MAX_ID_LENGTH = 256;

function validatePids(pids) {
  if (!Array.isArray(pids) || pids.length < 1 || pids.length > MAX_PIDS) {
    throw new Error(`Lista de PIDs inválida (1 a ${MAX_PIDS} itens).`);
  }
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid < 1 || pid > 4294967295) {
      throw new Error('PID inválido.');
    }
  }
  return pids.slice();
}

function validateSourceId(id) {
  if (typeof id !== 'string' || id.length < 1 || id.length > MAX_ID_LENGTH || !/^[\w:.\-]+$/.test(id)) {
    throw new Error('ID de fonte inválido.');
  }
  return id;
}

module.exports = { MAX_PIDS, MAX_ID_LENGTH, validatePids, validateSourceId };
