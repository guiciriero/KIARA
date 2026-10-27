/**
 * Hook do Host: expõe a tela do co-apresentador enquanto a transmissão está no ar.
 * A lógica de conexão fica em services/copresenterReceiver.ts.
 */

import { useEffect, useState } from 'react';
import type { Socket } from 'socket.io-client';
import {
  CopresenterReceiver,
  EMPTY_COPRESENTER_SNAPSHOT,
  type CopresenterSnapshot,
} from '../services/copresenterReceiver';
import type { E2eeTransform } from '../services/e2ee';
import type { IceServerConfig } from '@shared/index';

export function useCopresenterStream(
  socket: Socket | null,
  /** true enquanto o Host está transmitindo (a sala existe) */
  active: boolean,
  iceServers: IceServerConfig[],
  /** Sala E2EE: sessão do host, para decifrar a tela do co-apresentador */
  e2ee: E2eeTransform | null = null,
): CopresenterSnapshot {
  const [snapshot, setSnapshot] = useState<CopresenterSnapshot>(EMPTY_COPRESENTER_SNAPSHOT);

  useEffect(() => {
    if (!socket || !active) return;
    const receiver = new CopresenterReceiver(socket, iceServers, setSnapshot, e2ee ?? undefined);
    return () => {
      receiver.destroy();
      setSnapshot(EMPTY_COPRESENTER_SNAPSHOT);
    };
  }, [socket, active, iceServers, e2ee]);

  return snapshot;
}
