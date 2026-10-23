/**
 * Montagem do servidor KIARA (Express + Socket.IO) sem iniciar o listen.
 * O bootstrap (listen, sinais, logs de inicialização) fica em index.ts;
 * os testes de integração usam createApp() diretamente em porta efêmera.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import type { AddressInfo } from 'net';
import { createServer, type Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { setupSignaling } from './signaling/signalingHandler';
import { RoomManager } from './rooms/roomManager';
import { logger } from './utils/logger';
import { getPublicUrl, isOriginAllowed } from './utils/publicUrl';
import { getLatestWindowsInstallerUrl, getReleasesPageUrl } from './utils/latestRelease';

export interface RateLimitOptions {
  windowMs: number;
  limit: number;
}

export interface AppOptions {
  /** Porta usada na allowlist de origens locais (padrão: PORT ou 3001; após o listen vale a porta real) */
  port?: number;
  /** Pasta do site estático. undefined → CLIENT_DIST_DIR/padrão; null → não serve o site */
  clientDistDir?: string | null;
  /** Limites de requisições HTTP por IP */
  rateLimit?: { general?: RateLimitOptions; download?: RateLimitOptions };
  /** Máximo de conexões Socket.IO simultâneas (padrão MAX_CONNECTIONS ou 500) */
  maxConnections?: number;
  /** Máximo de conexões Socket.IO simultâneas por IP (padrão MAX_CONNECTIONS_PER_IP ou 20) */
  maxConnectionsPerIp?: number;
  /** Tamanho máximo de uma mensagem Socket.IO em bytes (padrão 64 KB) */
  maxHttpBufferSize?: number;
  /** Saltos de proxy confiáveis (padrão: TRUST_PROXY, só em produção) */
  trustProxy?: number;
  /** Força modo produção (padrão: NODE_ENV === 'production') */
  production?: boolean;
}

export interface AppInstance {
  app: express.Express;
  httpServer: HttpServer;
  io: SocketIOServer;
  roomManager: RoomManager;
  /** Para a sinalização, desconecta clientes e fecha o servidor. Idempotente. */
  close(): Promise<void>;
  /** Pasta do site estático servido (undefined se não houver) */
  clientDist: string | undefined;
}

export const MAX_SOCKET_MESSAGE_BYTES = 64 * 1024;

/** Lê inteiro positivo de uma variável de ambiente; inválido → padrão */
function envPositiveInt(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

/** TRUST_PROXY numérico (>= 0) ou undefined */
function envTrustProxy(): number | undefined {
  const raw = process.env.TRUST_PROXY?.trim();
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  return Number.parseInt(raw, 10);
}

/** Resolve a pasta do site: CLIENT_DIST_DIR (app desktop empacotado) ou ../../client/dist */
function resolveClientDist(opt: string | null | undefined): string | undefined {
  if (opt === null) return undefined;
  const dir = opt
    ? path.resolve(opt)
    : process.env.CLIENT_DIST_DIR
      ? path.resolve(process.env.CLIENT_DIST_DIR)
      : path.resolve(__dirname, '../../client/dist');
  return fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html')) ? dir : undefined;
}

/** Resposta JSON genérica dos limitadores de taxa */
const tooManyRequests = (_req: express.Request, res: express.Response): void => {
  res.status(429).json({ error: 'too-many-requests' });
};

export function createApp(opts: AppOptions = {}): AppInstance {
  const isProduction = opts.production ?? process.env.NODE_ENV === 'production';
  const configuredPort = opts.port ?? envPositiveInt('PORT', 3001);
  const maxConnections = opts.maxConnections ?? envPositiveInt('MAX_CONNECTIONS', 500);
  const maxConnectionsPerIp = opts.maxConnectionsPerIp ?? envPositiveInt('MAX_CONNECTIONS_PER_IP', 20);
  const trustProxy = opts.trustProxy ?? (isProduction ? envTrustProxy() : undefined);
  const clientDist = resolveClientDist(opts.clientDistDir);

  // Porta efetiva para a allowlist: a real após o listen (importa com porta efêmera)
  const currentPort = (): number => {
    const addr = httpServer.address();
    return addr && typeof addr === 'object' ? (addr as AddressInfo).port : configuredPort;
  };

  /** Função de origem compartilhada entre cors() do Express e Socket.IO */
  const originCheck = (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ): void => {
    callback(null, isOriginAllowed(origin, currentPort()));
  };

  // ─── Express ───────────────────────────────────────────────────────────────
  const app = express();
  app.disable('x-powered-by');
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);

  // HSTS e upgrade-insecure-requests só fazem sentido quando o site é servido por HTTPS
  // (o app desktop roda em produção, mas em http://127.0.0.1).
  const publicUrl = getPublicUrl();
  const secureContext = isProduction && !!publicUrl && publicUrl.startsWith('https://');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          // O index.html carrega a folha de fontes do Google Fonts
          'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          'font-src': ["'self'", 'https://fonts.gstatic.com'],
          'img-src': ["'self'", 'data:', 'blob:'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          'media-src': ["'self'", 'blob:'],
          'worker-src': ["'self'"],
          'manifest-src': ["'self'"],
          'object-src': ["'none'"],
          'frame-ancestors': ["'none'"],
          'base-uri': ["'none'"],
          // Nenhum formulário envia dados para fora (os <form> do app são tratados em JS)
          'form-action': ["'self'"],
          ...(secureContext ? { 'upgrade-insecure-requests': [] } : {}),
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
      strictTransportSecurity: secureContext ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    }),
  );

  // SEGURANÇA: Permissions-Policy restringe recursos do navegador. Captura de tela, tela cheia,
  // wake lock e autoplay ficam só na própria origem; o resto é negado.
  app.use((_req, res, next) => {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), display-capture=(self), fullscreen=(self), screen-wake-lock=(self), autoplay=(self)',
    );
    next();
  });

  // SEGURANÇA: o app não usa cookies nem HTTP auth; `credentials: true` seria permissivo à toa.
  app.use(cors({ origin: originCheck }));

  // Limite geral por IP; /health fica isento (health checks do Docker/Render)
  const general = opts.rateLimit?.general ?? { windowMs: 15 * 60 * 1000, limit: 300 };
  const download = opts.rateLimit?.download ?? { windowMs: 15 * 60 * 1000, limit: 30 };
  app.use(
    rateLimit({
      ...general,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path === '/health',
      handler: tooManyRequests,
    }),
  );

  // Nenhuma rota recebe corpo JSON, então não há body parser.

  // Endpoint de saúde — usado por health checks do Docker / load balancer
  // SEGURANÇA: não expõe uptime (fingerprinting/reconhecimento do servidor)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Download do instalador do Windows: redireciona para o .exe da última release
  // (se o GitHub estiver indisponível, cai na página de releases).
  app.get(
    '/download/windows',
    rateLimit({ ...download, standardHeaders: 'draft-7', legacyHeaders: false, handler: tooManyRequests }),
    async (_req, res) => {
      const url = await getLatestWindowsInstallerUrl();
      res.setHeader('Cache-Control', 'no-store');
      res.redirect(302, url ?? getReleasesPageUrl());
    },
  );

  if (clientDist) {
    const clientIndex = path.join(clientDist, 'index.html');
    app.use(express.static(clientDist, { index: 'index.html', dotfiles: 'ignore', redirect: false }));

    // Fallback SPA: qualquer GET fora de /socket.io, /health e /download devolve o index.html
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/socket.io') || req.path.startsWith('/health') || req.path.startsWith('/download/')) {
        next();
        return;
      }
      res.sendFile(clientIndex);
    });
  }

  // Erros inesperados: resposta genérica, detalhes só no log
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error(`Erro em requisição HTTP: ${err instanceof Error ? err.message : 'desconhecido'}`);
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.status(500).json({ error: 'internal-error' });
  });

  // ─── Servidor HTTP + Socket.IO ─────────────────────────────────────────────
  const httpServer = createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: originCheck,
      methods: ['GET', 'POST'],
    },
    // Recusa o handshake (polling e websocket) de origens fora da allowlist
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, isOriginAllowed(typeof origin === 'string' ? origin : undefined, currentPort()));
    },
    // A sinalização só troca JSON pequeno (SDP/ICE); nada de mídia ou base64 grande
    maxHttpBufferSize: opts.maxHttpBufferSize ?? MAX_SOCKET_MESSAGE_BYTES,
    transports: ['websocket', 'polling'],
    perMessageDeflate: false,
    pingTimeout: 4_000,
    pingInterval: 5_000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000,
      skipMiddlewares: true,
    },
  });

  // ─── Limite de conexões (global e por IP) ──────────────────────────────────
  let totalConnections = 0;
  const perIp = new Map<string, number>();

  /** IP do cliente: salto de X-Forwarded-For indicado por TRUST_PROXY quando há proxy configurado */
  const clientIp = (headers: Record<string, string | string[] | undefined>, address: string): string => {
    if (trustProxy && trustProxy > 0) {
      const xff = headers['x-forwarded-for'];
      const raw = Array.isArray(xff) ? xff.join(',') : xff;
      if (raw) {
        const hops = raw.split(',').map((s) => s.trim()).filter(Boolean);
        const ip = hops[hops.length - trustProxy] ?? hops[0];
        if (ip) return ip;
      }
    }
    return address;
  };

  io.use((socket, next) => {
    const ip = clientIp(socket.handshake.headers, socket.handshake.address);
    // Disponibiliza o IP real (com TRUST_PROXY) à sinalização, para limitar tentativas por IP
    socket.data.ip = ip;
    const current = perIp.get(ip) ?? 0;
    if (totalConnections >= maxConnections || current >= maxConnectionsPerIp) {
      next(new Error('server-busy'));
      return;
    }
    totalConnections += 1;
    perIp.set(ip, current + 1);

    // O fechamento do transporte sempre dispara, inclusive se o handshake não concluir
    let released = false;
    socket.conn.once('close', () => {
      if (released) return;
      released = true;
      totalConnections = Math.max(0, totalConnections - 1);
      const left = (perIp.get(ip) ?? 1) - 1;
      if (left <= 0) perIp.delete(ip);
      else perIp.set(ip, left);
    });
    next();
  });

  // ─── Gerenciador de Salas + sinalização WebRTC ─────────────────────────────
  const roomManager = new RoomManager();
  const disposeSignaling = setupSignaling(io, roomManager);

  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      try {
        disposeSignaling();
      } catch {
        // dispose não deve impedir o encerramento
      }
      // io.close() desconecta os sockets e fecha o httpServer
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
        httpServer.closeAllConnections();
      });
    })();
    return closing;
  };

  return { app, httpServer, io, roomManager, close, clientDist };
}
