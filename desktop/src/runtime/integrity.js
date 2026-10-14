'use strict';

/**
 * runtime/integrity.js — verificação de integridade (SHA-256) de binários embutidos.
 *
 * Módulo PURO (só fs/crypto): não depende do Electron e é testado com Vitest
 * (desktop/src/integrity.test.ts).
 *
 * Limite honesto da proteção: o hash fica em build-info.json, na mesma pasta de resources
 * do app. Isso detecta corrupção e a troca isolada do cloudflared.exe, mas NÃO impede um
 * atacante que já tenha permissão de escrita em toda a pasta de instalação de trocar os
 * dois arquivos. A defesa completa exige assinatura de código (o build atual não assina).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

/**
 * Normaliza um SHA-256 em hexadecimal (aceita prefixo "sha256:" e maiúsculas).
 * @param {unknown} value
 * @returns {string|null} 64 caracteres hex minúsculos ou null se inválido.
 */
function normalizeSha256(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase().replace(/^sha256:/, '');
  return SHA256_HEX_RE.test(v) ? v : null;
}

/**
 * SHA-256 de um arquivo, lido em stream (não carrega o binário inteiro na memória).
 * @param {string} file
 * @returns {Promise<string>} hex minúsculo
 */
function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Lê o SHA-256 esperado do cloudflared em <resourcesPath>/build-info.json
 * (campo `cloudflaredSha256`, gravado por scripts/write-build-info.mjs).
 * @param {string} [resourcesPath]
 * @returns {string|null} null se o arquivo/campo não existir ou for inválido.
 */
function readExpectedCloudflaredSha(resourcesPath) {
  if (!resourcesPath) return null;
  try {
    const info = JSON.parse(fs.readFileSync(path.join(resourcesPath, 'build-info.json'), 'utf8'));
    return normalizeSha256(info && info.cloudflaredSha256);
  } catch {
    return null;
  }
}

/**
 * Confere o hash de um binário contra o esperado.
 *
 * Retorno:
 *   { status: 'ok' }                      — hash confere;
 *   { status: 'skipped', message }        — sem hash esperado (dev/sem metadado): só avisa;
 *   { status: 'mismatch', message }       — hash diverge: o caller NÃO deve executar o binário.
 *
 * @param {string} file
 * @param {string|null|undefined} expectedSha256
 * @returns {Promise<{status: 'ok'|'skipped'|'mismatch', message?: string, actual?: string}>}
 */
async function checkBinaryIntegrity(file, expectedSha256) {
  const expected = normalizeSha256(expectedSha256);
  if (!expected) {
    return {
      status: 'skipped',
      message: 'Sem SHA-256 de referência para o cloudflared (modo dev ou build sem metadado); ' +
        'verificação de integridade ignorada.',
    };
  }
  const actual = await sha256File(file);
  if (actual !== expected) {
    return {
      status: 'mismatch',
      actual,
      message: 'Integridade do cloudflared não confere (SHA-256 diferente do registrado no build). ' +
        'O túnel não será iniciado. Reinstale o KIARA a partir de uma fonte confiável.',
    };
  }
  return { status: 'ok', actual };
}

module.exports = {
  normalizeSha256,
  sha256File,
  readExpectedCloudflaredSha,
  checkBinaryIntegrity,
};
