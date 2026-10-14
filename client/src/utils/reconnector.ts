/**
 * reconnector.ts
 * Controle de reconexão do espectador: até 5 tentativas com backoff de
 * 3 s, 6 s, 12 s, 24 s e 30 s (teto). Sem dependência de React nem de DOM,
 * para ser testado com timers falsos.
 */

/** Número máximo de tentativas de reconexão do espectador */
export const MAX_VIEWER_RECONNECT_ATTEMPTS = 5;
/** Atraso base do backoff (ms) */
export const VIEWER_RECONNECT_BASE_MS = 3000;
/** Teto do backoff (ms) */
export const VIEWER_RECONNECT_MAX_MS = 30000;

/** Atraso antes da tentativa `attempt` (1-based): 3 s, 6 s, 12 s, 24 s, 30 s… */
export function viewerReconnectDelayMs(attempt: number): number {
  const exp = Math.max(0, attempt - 1);
  return Math.min(VIEWER_RECONNECT_BASE_MS * 2 ** exp, VIEWER_RECONNECT_MAX_MS);
}

export interface ReconnectorOptions {
  /** Reenvia o pedido de entrada na sala (o chamador decide se o socket está conectado) */
  send: () => void;
  /** Chamado quando as tentativas se esgotaram sem sucesso */
  onExhausted: () => void;
}

export interface Reconnector {
  /** O socket caiu: agenda as tentativas (ignorado se já houver uma agendada) */
  onDisconnect(): void;
  /** O socket voltou: cancela o timer e reenvia imediatamente */
  onConnect(): void;
  /** Entrada concluída: zera o contador e cancela timers */
  reset(): void;
  /** Cancela timers sem zerar o contador */
  cancel(): void;
  readonly attempts: number;
}

export function createReconnector({ send, onExhausted }: ReconnectorOptions): Reconnector {
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const arm = () => {
    timer = setTimeout(tick, viewerReconnectDelayMs(attempts + 1));
  };

  function tick(): void {
    timer = null;
    if (attempts >= MAX_VIEWER_RECONNECT_ATTEMPTS) {
      onExhausted();
      return;
    }
    attempts += 1;
    send();
    arm();
  }

  return {
    onDisconnect() {
      if (timer === null) arm();
    },
    onConnect() {
      cancel();
      send();
    },
    reset() {
      cancel();
      attempts = 0;
    },
    cancel,
    get attempts() {
      return attempts;
    },
  };
}
