import { useEffect, useState } from 'react';
import { useSocket } from '../services/SocketContext';

/** Tempo sem conectar antes de avisar que o servidor está "acordando" */
export const WAKE_DELAY_MS = 3000;
/** Intervalo entre as consultas a /health */
export const HEALTH_POLL_MS = 5000;

export interface ServerWakeState {
  /** true enquanto o aviso "Acordando o servidor…" deve aparecer */
  waking: boolean;
  /** Segundos desde que o aviso apareceu */
  seconds: number;
}

export const SERVER_WAKE_IDLE: ServerWakeState = { waking: false, seconds: 0 };

export interface ServerWakeMonitorOptions {
  onChange: (state: ServerWakeState) => void;
  /** Chamado quando /health responde ok (o monitor para de consultar) */
  onHealthy?: () => void;
  /** Consulta /health (mesma origem). Deve resolver true se a resposta foi ok. */
  checkHealth?: (signal: AbortSignal) => Promise<boolean>;
  delayMs?: number;
  pollMs?: number;
}

async function defaultCheckHealth(signal: AbortSignal): Promise<boolean> {
  const res = await fetch('/health', { cache: 'no-store', signal });
  return res.ok;
}

/**
 * Inicia a contagem: se nada cancelar em `delayMs`, sinaliza `waking`, conta segundos e
 * consulta /health a cada `pollMs` até responder ok. Devolve a função que cancela tudo.
 */
export function startServerWakeMonitor(options: ServerWakeMonitorOptions): () => void {
  const {
    onChange,
    onHealthy,
    checkHealth = defaultCheckHealth,
    delayMs = WAKE_DELAY_MS,
    pollMs = HEALTH_POLL_MS,
  } = options;

  let stopped = false;
  let seconds = 0;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let controller: AbortController | null = null;

  const stopPolling = () => {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  };

  const poll = () => {
    if (stopped || controller) return; // uma consulta por vez
    const ctrl = new AbortController();
    controller = ctrl;
    checkHealth(ctrl.signal)
      .then((ok) => {
        controller = null;
        if (stopped || !ok) return;
        stopPolling();
        onHealthy?.();
      })
      .catch(() => {
        // servidor ainda dormindo (ou rede fora): tenta de novo no próximo ciclo
        controller = null;
      });
  };

  const delayTimer = setTimeout(() => {
    if (stopped) return;
    onChange({ waking: true, seconds });
    tickTimer = setInterval(() => {
      seconds += 1;
      onChange({ waking: true, seconds });
    }, 1000);
    poll();
    pollTimer = setInterval(poll, pollMs);
  }, delayMs);

  return () => {
    stopped = true;
    clearTimeout(delayTimer);
    if (tickTimer) clearInterval(tickTimer);
    stopPolling();
    controller?.abort();
    controller = null;
  };
}

/**
 * Detecta servidor em cold start (ex.: plano gratuito que dorme): se o socket não conectar em ~3 s,
 * expõe `waking` + contador e acorda o servidor consultando /health até responder.
 * Para ao conectar ou ao desmontar.
 */
export function useServerWake(): ServerWakeState {
  const { connected } = useSocket();
  const [state, setState] = useState<ServerWakeState>(SERVER_WAKE_IDLE);

  useEffect(() => {
    if (connected) return;
    const stop = startServerWakeMonitor({ onChange: setState });
    return () => {
      stop();
      setState(SERVER_WAKE_IDLE);
    };
  }, [connected]);

  return connected ? SERVER_WAKE_IDLE : state;
}
