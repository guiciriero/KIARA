/**
 * lowLatencyRenderer.ts
 * Lado da página do modo "baixa latência (experimental)": cria o canvas, transfere o controle ao
 * worker (OffscreenCanvas) e liga o receiver de vídeo ao RTCRtpScriptTransform dele.
 * A decodificação e o desenho ficam em workers/lowLatency.worker.ts.
 */

import type { LowLatencyWorkerMessage } from '../utils/lowLatency';

/** O que o WebRTCViewer precisa de um destino de vídeo alternativo */
export interface LowLatencyVideoSink {
  attachVideoReceiver(receiver: RTCRtpReceiver): void;
  /** Quadros já desenhados no canvas (o watchdog do viewer usa isto no lugar de framesDecoded) */
  readonly framesRendered: number;
}

export interface LowLatencyState {
  /** true enquanto o canvas é quem mostra o vídeo; false depois de um fallback ao <video> */
  active: boolean;
  fallbackReason: string | null;
  rendered: number;
  dropped: number;
  /** Média chegada ao worker → desenho (NÃO inclui rede nem jitter buffer) */
  avgMs: number;
  width: number;
  height: number;
}

export const INITIAL_LOW_LATENCY_STATE: LowLatencyState = {
  active: true,
  fallbackReason: null,
  rendered: 0,
  dropped: 0,
  avgMs: 0,
  width: 0,
  height: 0,
};

export class LowLatencyRenderer implements LowLatencyVideoSink {
  /** Canvas que a página monta; o controle dele pertence ao worker */
  readonly canvas: HTMLCanvasElement;
  private worker: Worker | null;
  private state: LowLatencyState = { ...INITIAL_LOW_LATENCY_STATE };

  constructor(
    private readonly onChange: (state: LowLatencyState) => void,
    /** Sala E2EE: o worker decifra antes de decodificar */
    private readonly key?: CryptoKey,
  ) {
    this.canvas = document.createElement('canvas');
    this.worker = new Worker(new URL('../workers/lowLatency.worker.ts', import.meta.url), {
      type: 'module',
      name: 'kiara-lowlatency',
    });
    this.worker.onmessage = (event: MessageEvent<LowLatencyWorkerMessage>) => this.handle(event.data);
    const offscreen = this.canvas.transferControlToOffscreen();
    this.worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen]);
  }

  get framesRendered(): number {
    return this.state.rendered;
  }

  get current(): LowLatencyState {
    return this.state;
  }

  attachVideoReceiver(receiver: RTCRtpReceiver): void {
    if (!this.worker || receiver.transform) return;
    receiver.transform = new RTCRtpScriptTransform(this.worker, { key: this.key });
  }

  private handle(message: LowLatencyWorkerMessage): void {
    if (message.type === 'fallback') {
      this.state = { ...this.state, active: false, fallbackReason: message.reason };
    } else {
      this.state = {
        ...this.state,
        rendered: message.rendered,
        dropped: message.dropped,
        avgMs: message.avgMs,
        width: message.width,
        height: message.height,
      };
    }
    this.onChange(this.state);
  }

  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
  }
}
