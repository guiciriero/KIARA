/**
 * Ponto de entrada do servidor de sinalização WebRTC.
 * Inicializa o Express, Socket.IO e o gerenciador de salas.
 */

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { setupSignaling } from './signaling/signalingHandler';
import { RoomManager } from './rooms/roomManager';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT ?? '3001', 10);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN ?? 'http://localhost:3000';

// ─── Express ─────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json());

// Endpoint de saúde — usado por health checks do Docker / load balancer
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ─── Servidor HTTP + Socket.IO ────────────────────────────────────────────────
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ['GET', 'POST'],
    credentials: true,
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
httpServer.listen(PORT, '127.0.0.1', () => {
  logger.info(`Servidor de sinalização iniciado em http://127.0.0.1:${PORT}`);
  logger.info(`Aceitando conexões de: ${CLIENT_ORIGIN}`);
});

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
