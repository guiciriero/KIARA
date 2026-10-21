/**
 * Recebe, no lado do Host, a tela do co-apresentador.
 *
 * O co-apresentador envia um offer WebRTC direto ao Host (ver useCopresenter). O Host só
 * tinha o WebRTCBroadcaster (que trata answers); aqui reaproveitamos o WebRTCViewer, usando o
 * id do co-apresentador como "origem" aceita. O servidor avisa quem entra e sai da vaga pelos
 * eventos `room:copresenter-joined` / `room:copresenter-left`.
 */

import type { Socket } from 'socket.io-client';
import { WebRTCViewer } from './webrtcService';
import type { CopresenterChangedPayload, IceServerConfig } from '@shared/index';

export interface CopresenterInfo {
  id: string;
  name: string;
}

export interface CopresenterSnapshot {
  /** Quem ocupa a vaga de co-apresentador (null = vaga livre) */
  copresenter: CopresenterInfo | null;
  /** Tela recebida; null enquanto a conexão não entregou vídeo */
  stream: MediaStream | null;
}

export const EMPTY_COPRESENTER_SNAPSHOT: CopresenterSnapshot = { copresenter: null, stream: null };

export class CopresenterReceiver {
  private viewer: WebRTCViewer | null = null;
  private current: CopresenterInfo | null = null;
  private destroyed = false;

  constructor(
    private readonly socket: Socket,
    private readonly iceServers: IceServerConfig[],
    private readonly onChange: (snapshot: CopresenterSnapshot) => void,
  ) {
    socket.on('room:copresenter-joined', this.handleJoined);
    socket.on('room:copresenter-left', this.handleLeft);
  }

  private handleJoined = (data: CopresenterChangedPayload) => {
    if (this.destroyed) return;
    this.dropViewer();

    const info: CopresenterInfo = { id: data.copresenterId, name: data.name };
    this.current = info;

    const viewer = new WebRTCViewer(this.socket, info.id, this.iceServers);
    viewer.onStream((stream) => {
      // Ignora vídeo de uma conexão já substituída ou encerrada
      if (this.destroyed || this.viewer !== viewer) return;
      this.onChange({ copresenter: info, stream });
    });
    this.viewer = viewer;

    this.onChange({ copresenter: info, stream: null });
  };

  private handleLeft = (data: CopresenterChangedPayload) => {
    if (this.destroyed || this.current?.id !== data.copresenterId) return;
    this.dropViewer();
    this.current = null;
    this.onChange(EMPTY_COPRESENTER_SNAPSHOT);
  };

  private dropViewer(): void {
    this.viewer?.destroy();
    this.viewer = null;
  }

  destroy(): void {
    this.destroyed = true;
    this.socket.off('room:copresenter-joined', this.handleJoined);
    this.socket.off('room:copresenter-left', this.handleLeft);
    this.dropViewer();
    this.current = null;
  }
}
