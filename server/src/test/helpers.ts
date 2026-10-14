/**
 * Helpers de teste para sinalização e gerenciamento de salas KIARA.
 * Cria servidor Socket.IO em porta efêmera em 127.0.0.1 e clientes de teste.
 */

import http from 'http';
import { AddressInfo } from 'net';
import { Server as SocketIOServer } from 'socket.io';
import { io as ioc, Socket as ClientSocket } from 'socket.io-client';
import { RoomManager } from '../rooms/roomManager';
import { setupSignaling } from '../signaling/signalingHandler';

export interface TestServer {
  httpServer: http.Server;
  io: SocketIOServer;
  roomManager: RoomManager;
  port: number;
  url: string;
  dispose: () => void;
  close: () => Promise<void>;
  createClient: () => Promise<ClientSocket>;
}

/** Cria um servidor de sinalização isolado em porta efêmera */
export async function createTestServer(): Promise<TestServer> {
  const httpServer = http.createServer();
  const io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
    transports: ['websocket'],
  });

  const roomManager = new RoomManager();
  const dispose = setupSignaling(io, roomManager);

  await new Promise<void>((resolve) => {
    httpServer.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = httpServer.address() as AddressInfo;
  const port = addr.port;
  const url = `http://127.0.0.1:${port}`;

  const openClients = new Set<ClientSocket>();

  const createClient = (): Promise<ClientSocket> => {
    return new Promise((resolve, reject) => {
      const client = ioc(url, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: false,
      });

      openClients.add(client);

      client.on('connect', () => resolve(client));
      client.on('connect_error', (err) => reject(err));
    });
  };

  const close = async (): Promise<void> => {
    dispose();
    for (const client of openClients) {
      if (client.connected) {
        client.disconnect();
      }
    }
    openClients.clear();
    roomManager.clear();

    await new Promise<void>((resolve) => {
      io.close(() => {
        httpServer.close(() => resolve());
      });
    });
  };

  return {
    httpServer,
    io,
    roomManager,
    port,
    url,
    dispose,
    close,
    createClient,
  };
}

/** Espera por um evento específico no socket do cliente */
export function waitForEvent<T = any>(
  socket: ClientSocket,
  event: string,
  timeoutMs: number = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout de ${timeoutMs}ms aguardando pelo evento '${event}'`));
    }, timeoutMs);

    const handler = (data: T) => {
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };

    socket.on(event, handler);
  });
}

/** Pausa execução por ms */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
