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
import type { IceServerConfig } from '@shared/index';

export function useCopresenterStream(
  socket: Socket | null,
  /** true enquanto o Host está transmitindo (a sala existe) */
  active: boolean,
  iceServers: IceServerConfig[],
): CopresenterSnapshot {
  const [snapshot, setSnapshot] = useState<CopresenterSnapshot>(EMPTY_COPRESENTER_SNAPSHOT);

  useEffect(() => {
    if (!socket || !active) return;
    const receiver = new CopresenterReceiver(socket, iceServers, setSnapshot);
    return () => {
      receiver.destroy();
      setSnapshot(EMPTY_COPRESENTER_SNAPSHOT);
    };
  }, [socket, active, iceServers]);

  return snapshot;
}
