/**
 * Ponto de entrada do servidor de sinalização WebRTC.
 * Cria o app (app.ts), inicia o listen, trata sinais e encerramento gracioso.
 */

import 'dotenv/config';
import { createApp } from './app';
import { logger } from './utils/logger';
import { getAllowedOrigins, getPublicUrl } from './utils/publicUrl';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
// Padrão seguro: só loopback. Em hospedagem (ex.: Render) o proxy da plataforma
// precisa alcançar o processo, então defina HOST=0.0.0.0 explicitamente.
const HOST = process.env.HOST?.trim() || '127.0.0.1';
const SHUTDOWN_TIMEOUT_MS = 10_000;

const { httpServer, close, clientDist } = createApp({ port: PORT });

// Falha ao abrir a porta (EADDRINUSE, EACCES...) é o único caso que derruba o processo
httpServer.once('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`A porta ${PORT} já está em uso. Defina outra porta com PORT=<número>.`);
  } else if (err.code === 'EACCES') {
    logger.error(`Sem permissão para abrir ${HOST}:${PORT}.`);
  } else {
    logger.error(`Não foi possível iniciar o servidor em ${HOST}:${PORT} (${err.code ?? err.message}).`);
  }
  process.exit(1);
});

httpServer.listen(PORT, HOST, () => {
  logger.info(`Servidor de sinalização iniciado em http://${HOST}:${PORT}`);
  const publicUrl = getPublicUrl();
  if (publicUrl) logger.info(`PUBLIC_URL: ${publicUrl}`);
  logger.info(`Origens permitidas: ${getAllowedOrigins(PORT).join(', ')}`);
  logger.info(
    clientDist
      ? `Servindo o site estático de ${clientDist}`
      : 'client/dist não encontrado; site não será servido',
  );
});

// ─── Encerramento gracioso (idempotente) ─────────────────────────────────────
let shuttingDown = false;
function shutdown(reason: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Recebido ${reason}. Encerrando servidor...`);
  // Garantia: se algo travar, sai após o timeout
  setTimeout(() => {
    logger.warn('Timeout no encerramento; forçando saída.');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();
  close().then(
    () => {
      logger.info('Servidor encerrado.');
      process.exit(0);
    },
    () => process.exit(1),
  );
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// Quando iniciado como processo filho com canal IPC (app desktop), encerra junto com o pai
process.on('disconnect', () => shutdown('desconexão do processo pai'));

// Erros de handlers não derrubam o servidor: registra (sem dados sensíveis) e segue
process.on('uncaughtException', (err) => {
  logger.error(`Exceção não capturada: ${err instanceof Error ? (err.stack ?? err.message) : 'desconhecida'}`);
});

process.on('unhandledRejection', (reason) => {
  logger.error(
    `Promise rejeitada sem tratamento: ${reason instanceof Error ? (reason.stack ?? reason.message) : 'motivo desconhecido'}`,
  );
});
