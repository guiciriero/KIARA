/**
 * Logger centralizado usando Winston.
 * Formata mensagens com timestamp e nível de severidade.
 * Nunca registra dados sensíveis: campos com nomes de senha/token/segredo/credencial
 * são mascarados antes de qualquer saída.
 */

import fs from 'fs';
import path from 'path';
import winston from 'winston';

const { combine, timestamp, colorize, printf, errors } = winston.format;

const SENSITIVE_KEY = /pass(word|wd)?|secret|token|credential|authorization|api[-_]?key|cookie/i;
const MAX_REDACT_DEPTH = 4;

/** Mascara recursivamente valores de chaves sensíveis em objetos simples */
function redact(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH || value === null || typeof value !== 'object') return value;
  if (value instanceof Error) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

const redactFormat = winston.format((info) => {
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message' || key === 'stack') continue;
    (info as Record<string, unknown>)[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : redact(info[key]);
  }
  return info;
});

/** Formato legível para desenvolvimento */
const devFormat = combine(
  redactFormat(),
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack }) => {
    const base = `[${timestamp}] ${level}: ${message}`;
    return stack ? `${base}\n${stack}` : base;
  }),
);

/** Formato JSON estruturado para produção */
const prodFormat = combine(redactFormat(), timestamp(), errors({ stack: true }), winston.format.json());

const isProduction = process.env.NODE_ENV === 'production';

// LOG_DIR define onde gravar os arquivos de log (o app desktop usa a pasta de dados
// do usuário, pois o diretório de instalação pode ser somente leitura).
const logDir = process.env.LOG_DIR ?? 'logs';

/** Garante que a pasta de logs existe e é gravável; qualquer falha apenas desativa o arquivo */
function ensureWritableLogDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const fileLoggingEnabled = isProduction && ensureWritableLogDir(logDir);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: isProduction ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    // Em produção, grava também em arquivo (somente se a pasta for gravável)
    ...(fileLoggingEnabled
      ? [
          new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
          new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
        ]
      : []),
  ],
});

if (isProduction && !fileLoggingEnabled) {
  logger.warn('Pasta de logs indisponível; registrando apenas no console.');
}
