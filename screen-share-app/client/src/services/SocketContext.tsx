/**
 * SocketContext.tsx
 *
 * Mantém a conexão Socket.IO em um único lugar e a disponibiliza
 * para todos os componentes via Context API do React.
 *
 * Correção: o socket agora é armazenado em useState (não useRef),
 * garantindo que o Provider repasse a referência atualizada aos
 * consumidores assim que a conexão for estabelecida.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import { io, Socket } from 'socket.io-client';

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connected: false,
});

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? (import.meta.env.PROD ? window.location.origin : 'http://127.0.0.1:3001');

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Usamos useState para que mudanças no socket disparem re-render e atualizem consumidores
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const s = io(SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      timeout: 8000,
    });

    s.on('connect', () => {
      setConnected(true);
    });

    s.on('disconnect', () => {
      setConnected(false);
    });

    s.on('connect_error', (err) => {
      // Mantém o log técnico no console (não exibido ao usuário)
      console.warn('[ScreenShare] Não foi possível conectar ao servidor:', err.message);
    });

    setSocket(s);

    return () => {
      s.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
};

/** Hook para consumir o socket em qualquer componente da árvore */
export const useSocket = (): SocketContextValue => useContext(SocketContext);
