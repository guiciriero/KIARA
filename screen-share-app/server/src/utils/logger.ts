/**
 * Logger centralizado usando Winston.
 * Formata mensagens com timestamp e nível de severidade.
 * Nunca registra dados sensíveis (tokens, senhas, etc.).
 */

import winston from 'winston';

const { combine, timestamp, colorize, printf, errors } = winston.format;

/** Formato legível para desenvolvimento */
const devFormat = combine(
  colorize(),
  timestamp({ format: 'HH:mm:ss' }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack }) => {
    const base = `[${timestamp}] ${level}: ${message}`;
    return stack ? `${base}\n${stack}` : base;
  }),
);

/** Formato JSON estruturado para produção */
const prodFormat = combine(
  timestamp(),
  errors({ stack: true }),
  winston.format.json(),
);

const isProduction = process.env.NODE_ENV === 'production';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: isProduction ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    // Em produção, grava também em arquivo
    ...(isProduction
      ? [
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' }),
        ]
      : []),
  ],
});
