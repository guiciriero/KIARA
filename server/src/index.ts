/**
 * Ponto de entrada do servidor de sinalização WebRTC.
 * Inicializa o Express, Socket.IO e o gerenciador de salas.
 */

import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { setupSignaling } from './signaling/signalingHandler';
import { RoomManager } from './rooms/roomManager';
import { logger } from './utils/logger';
import { getAllowedOrigins, getPublicUrl, isOriginAllowed } from './utils/publicUrl';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
// Padrão seguro: só loopback. Em hospedagem (ex.: Render) o proxy da plataforma
// precisa alcançar o processo, então defina HOST=0.0.0.0 explicitamente.
const HOST = process.env.HOST?.trim() || '127.0.0.1';

/** Função de origem compartilhada entre cors() do Express e Socket.IO */
const originCheck = (
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void => {
  callback(null, isOriginAllowed(origin, PORT));
};

// Site estático (client/dist) — funciona em src/ (ts-node-dev) e em dist/.
// CLIENT_DIST_DIR sobrescreve o caminho (usado pelo app desktop empacotado,
// onde o servidor roda a partir de um bundle fora da árvore do projeto).
const CLIENT_DIST = process.env.CLIENT_DIST_DIR
  ? path.resolve(process.env.CLIENT_DIST_DIR)
  : path.resolve(__dirname, '../../client/dist');
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html');
const servingClient = fs.existsSync(CLIENT_DIST) && fs.existsSync(CLIENT_INDEX);

// ─── Express ─────────────────────────────────────────────────────────────────
const app = express();
app.disable('x-powered-by');

// Cabeçalhos de segurança básicos
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

app.use(cors({ origin: originCheck, credentials: true }));
app.use(express.json());

// Endpoint de saúde — usado por health checks do Docker / load balancer
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

if (servingClient) {
  app.use(express.static(CLIENT_DIST, { index: 'index.html', dotfiles: 'ignore', redirect: false }));

  // Fallback SPA: qualquer GET fora de /socket.io e /health devolve o index.html
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/socket.io') || req.path.startsWith('/health')) {
      next();
      return;
    }
    res.sendFile(CLIENT_INDEX);
  });
}

// ─── Servidor HTTP + Socket.IO ────────────────────────────────────────────────
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: originCheck,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  // Recusa o handshake (polling e websocket) de origens fora da allowlist
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    callback(null, isOriginAllowed(typeof origin === 'string' ? origin : undefined, PORT));
  },
  // Aumenta o limite de payload para suportar thumbnails em base64
  maxHttpBufferSize: 5 * 1024 * 1024, // 5 MB
  transports: ['websocket', 'polling'],
  pingTimeout: 10_000,
  pingInterval: 5_000,
});

// ─── Gerenciador de Salas ─────────────────────────────────────────────────────
const roomManager = new RoomManager();

// ─── Sinalização WebRTC ───────────────────────────────────────────────────────
setupSignaling(io, roomManager);

// ─── Inicialização ────────────────────────────────────────────────────────────
httpServer.listen(PORT, HOST, () => {
  logger.info(`Servidor de sinalização iniciado em http://${HOST}:${PORT}`);
  const publicUrl = getPublicUrl();
  if (publicUrl) logger.info(`PUBLIC_URL: ${publicUrl}`);
  logger.info(`Origens permitidas: ${getAllowedOrigins(PORT).join(', ')}`);
  logger.info(
    servingClient
      ? `Servindo o site estático de ${CLIENT_DIST}`
      : `client/dist não encontrado (${CLIENT_DIST}); site não será servido`,
  );
});

// Quando iniciado como processo filho com canal IPC (app desktop), encerra junto com o pai
process.on('disconnect', () => process.exit(0));

// Tratamento gracioso de encerramento
process.on('SIGTERM', () => {
  logger.info('Recebido SIGTERM. Encerrando servidor...');
  httpServer.close(() => {
    logger.info('Servidor encerrado.');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Exceção não capturada:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Promise rejeitada sem tratamento:', reason);
  process.exit(1);
});
