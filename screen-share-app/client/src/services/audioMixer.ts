/**
 * audioMixer.ts
 *
 * Mixador Web Audio com UMA faixa de saída estável. Fontes entram e saem do
 * grafo à vontade; a faixa (e portanto a conexão WebRTC) não muda nunca.
 *
 *   push(chunk PCM) ──► [AudioWorkletNode: ring + jitter buffer] ─► GainNode ─┐
 *   faixa do getDisplayMedia ─► [MediaStreamAudioSourceNode] ───► GainNode ─┼─► MediaStreamAudioDestinationNode ─► track
 *   ...                                                                      ┘
 *
 * - Fontes são identificadas por chave string (ex.: PID ou 'web:system-audio').
 * - Fontes PCM usam o AudioWorklet de public/app-audio-worklet.js (uma instância
 *   por fonte: ring buffer próprio, pré-buffer ~80 ms, limite de atraso ~200 ms).
 * - Nada é conectado a `ctx.destination`: sem eco local, o áudio só segue para
 *   a transmissão.
 */

import type { NativeAudioChunk } from '@shared/index';

const SAMPLE_RATE = 48000;
/** Deve ser igual ao nome registrado em registerProcessor() em public/app-audio-worklet.js */
const PROCESSOR_NAME = 'app-audio-source-processor';
/**
 * O processor é um arquivo estático de mesma origem, o que funciona no `vite dev`
 * e sob o protocolo `app://` do Electron mesmo com CSP `script-src 'self'`
 * (um Blob URL seria bloqueado).
 */
const WORKLET_URL = `${import.meta.env.BASE_URL}app-audio-worklet.js`;

interface SourceEntry {
  /** Nó de origem: worklet (PCM) ou MediaStreamAudioSourceNode (faixa) */
  node: AudioNode;
  /** Presente só em fontes PCM */
  worklet?: AudioWorkletNode;
  gain: GainNode;
  volume: number;
  muted: boolean;
}

export class AudioMixer {
  private readonly ctx: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly outTrack: MediaStreamTrack;
  private readonly sources = new Map<string, SourceEntry>();
  private destroyed = false;

  private constructor(ctx: AudioContext, destination: MediaStreamAudioDestinationNode) {
    this.ctx = ctx;
    this.destination = destination;
    this.outTrack = destination.stream.getAudioTracks()[0];
  }

  /** Cria o contexto, registra o worklet e prepara o destino da transmissão. */
  static async create(): Promise<AudioMixer> {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });

    try {
      await ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (err) {
      await ctx.close().catch(() => undefined);
      throw new Error(
        'Não foi possível iniciar o processamento de áudio' +
          (err instanceof Error && err.message ? ` (${err.message}).` : '.'),
      );
    }

    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 2;

    // Sem gesto do usuário o contexto pode nascer suspenso. Não aguardamos:
    // a promessa só resolve quando o contexto realmente rodar.
    void ctx.resume().catch(() => undefined);

    return new AudioMixer(ctx, destination);
  }

  /** Faixa de saída mixada: a mesma instância durante toda a vida do mixer. */
  get track(): MediaStreamTrack {
    return this.outTrack;
  }

  hasSource(key: string): boolean {
    return this.sources.has(key);
  }

  /** Fonte PCM (processo nativo): worklet + GainNode ligados ao destino. */
  addPcmSource(key: string): void {
    if (this.destroyed || this.sources.has(key)) return;

    const worklet = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.connectSource(key, { node: worklet, worklet });
  }

  /** Fonte baseada em faixa (ex.: getDisplayMedia). A posse da faixa continua com quem a criou. */
  addTrackSource(key: string, track: MediaStreamTrack): void {
    if (this.destroyed || this.sources.has(key)) return;

    const node = this.ctx.createMediaStreamSource(new MediaStream([track]));
    this.connectSource(key, { node });
  }

  /** Desconecta e libera os nós da fonte; nunca chama `track.stop()`. */
  removeSource(key: string): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    this.sources.delete(key);

    if (entry.worklet) {
      entry.worklet.port.onmessage = null;
      entry.worklet.port.close();
    }
    entry.node.disconnect();
    entry.gain.disconnect();
  }

  /** Envia um bloco PCM à fonte; blocos de chaves ausentes (ex.: removidas) são ignorados. */
  push(key: string, chunk: NativeAudioChunk): void {
    if (this.destroyed) return;
    const worklet = this.sources.get(key)?.worklet;
    if (!worklet) return;

    // `frames` pode divergir do tamanho real do array (2 canais)
    const frames = Math.min(chunk.frames, Math.floor(chunk.pcm.length / 2));
    if (frames <= 0) return;

    // Cópia própria: o Float32Array recebido pode ser visão de um buffer maior/reutilizado.
    const copy = new Float32Array(frames * 2);
    copy.set(chunk.pcm.subarray(0, frames * 2));
    worklet.port.postMessage({ pcm: copy, frames }, [copy.buffer]);
  }

  /** Volume de 0.0 a 1.0 (aplicado ao vivo). */
  setVolume(key: string, volume: number): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    entry.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
    this.applyGain(entry);
  }

  /** Muta/desmuta (aplicado ao vivo), preservando o volume configurado. */
  setMuted(key: string, muted: boolean): void {
    const entry = this.sources.get(key);
    if (!entry) return;
    entry.muted = muted;
    this.applyGain(entry);
  }

  /** Libera tudo, inclusive a faixa de saída. Idempotente. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const key of Array.from(this.sources.keys())) {
      this.removeSource(key);
    }
    this.destination.disconnect();
    this.outTrack.stop();

    if (this.ctx.state !== 'closed') {
      await this.ctx.close().catch(() => undefined);
    }
  }

  private connectSource(
    key: string,
    parts: Pick<SourceEntry, 'node' | 'worklet'>,
  ): void {
    const gain = this.ctx.createGain();
    parts.node.connect(gain);
    gain.connect(this.destination);
    this.sources.set(key, { ...parts, gain, volume: 1, muted: false });
  }

  /** Aplica o ganho efetivo com uma pequena rampa para evitar estalos. */
  private applyGain(entry: SourceEntry): void {
    const target = entry.muted ? 0 : entry.volume;
    entry.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
  }
}
