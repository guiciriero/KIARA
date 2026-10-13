/**
 * useViewer.ts
 * Hook para o modo espectador.
 * Gerencia: entrada na sala → WebRTC → recebimento do stream → reconexão automática.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSocket } from '../services/SocketContext';
import { WebRTCViewer } from '../services/webrtcService';
import type { StreamStats, ConnectionState, ViewerQualityPreference, QualityRequestPayload } from '@shared/index';

export interface ViewerState {
  remoteStream: MediaStream | null;
  viewerCount: number;
  connectionState: ConnectionState;
  stats: StreamStats | null;
  error: string | null;
  hostDisconnected: boolean;
  selectedQuality: ViewerQualityPreference;
}

export function useViewer(roomCode: string | undefined) {
  const { socket } = useSocket();
  const viewerRef  = useRef<WebRTCViewer | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [state, setState] = useState<ViewerState>({
    remoteStream: null, viewerCount: 0,
    connectionState: 'disconnected', stats: null,
    error: null, hostDisconnected: false,
    selectedQuality: 'auto',
  });

  // Escuta eventos do servidor
  // Roda quando socket ou roomCode mudar — socket pode chegar async após montagem
  useEffect(() => {
    if (!socket || !roomCode) return;

    setState((s) => ({ ...s, connectionState: 'connecting', error: null }));

    // Solicita entrada na sala assim que o socket estiver pronto
    socket.emit('room:join', { code: roomCode });

    socket.on('room:joined', (data: { roomId: string; hostId: string; viewerCount: number }) => {
      setState((s) => ({
        ...s, viewerCount: data.viewerCount, connectionState: 'connecting',
      }));

      // Inicializa o WebRTC viewer aguardando offer do apresentador
      const viewer = new WebRTCViewer(socket, data.hostId);
      viewer.onStream((stream) => {
        setState((s) => ({ ...s, remoteStream: stream, connectionState: 'connected' }));
      });
      viewerRef.current = viewer;
    });

    socket.on('room:error', (data: { message: string }) => {
      setState((s) => ({ ...s, error: data.message, connectionState: 'failed' }));
    });

    socket.on('room:host-disconnected', () => {
      setState((s) => ({ ...s, hostDisconnected: true, connectionState: 'disconnected' }));
      viewerRef.current?.destroy();
    });

    // Estatísticas vindas do apresentador via servidor
    socket.on('stream:stats', (stats: StreamStats) => {
      setState((s) => ({ ...s, stats }));
    });

    // Reconexão automática em caso de desconexão do socket
    socket.on('disconnect', () => {
      setState((s) => ({ ...s, connectionState: 'reconnecting' }));
      // Tenta reconectar após 3 segundos
      reconnectTimerRef.current = setTimeout(() => {
        if (roomCode) socket.emit('room:join', { code: roomCode });
      }, 3000);
    });

    return () => {
      socket.off('room:joined');
      socket.off('room:error');
      socket.off('room:host-disconnected');
      socket.off('stream:stats');
      socket.off('disconnect');
      viewerRef.current?.destroy();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [socket, roomCode]);

  /** Define a preferência de resolução individual do espectador */
  const setQuality = useCallback(
    (pref: ViewerQualityPreference) => {
      setState((s) => ({ ...s, selectedQuality: pref }));

      let targetHeight: number | null = null;
      let maxBitrateKbps: number | null = null;

      switch (pref) {
        case '1080p':
          targetHeight = 1080;
          maxBitrateKbps = 8000;
          break;
        case '720p':
          targetHeight = 720;
          maxBitrateKbps = 4000;
          break;
        case '480p':
          targetHeight = 480;
          maxBitrateKbps = 1800;
          break;
        case '360p':
          targetHeight = 360;
          maxBitrateKbps = 1000;
          break;
        case 'auto':
        default:
          targetHeight = null;
          maxBitrateKbps = null;
          break;
      }

      const payload: QualityRequestPayload = {
        targetHeight,
        maxBitrateKbps,
        preference: pref,
      };

      socket?.emit('stream:quality-request', payload);
    },
    [socket]
  );

  /** Sai da sala voluntariamente */
  const leaveRoom = useCallback(() => {
    socket?.emit('room:leave');
    viewerRef.current?.destroy();
    viewerRef.current = null;
    setState({
      remoteStream: null, viewerCount: 0,
      connectionState: 'disconnected', stats: null,
      error: null, hostDisconnected: false,
      selectedQuality: 'auto',
    });
  }, [socket]);

  return { state, leaveRoom, setQuality };
}
