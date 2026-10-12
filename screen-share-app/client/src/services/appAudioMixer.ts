/**
 * appAudioMixer.ts
 *
 * Mixa, no renderer, o áudio PCM de N aplicativos (um fluxo por PID) em uma
 * única MediaStreamTrack, usando Web Audio.
 *
 * Desenho:
 *
 *   push(chunk PID A) ──► [AudioWorkletNode A: ring buffer + jitter buffer] ─► GainNode A ─┐
 *   push(chunk PID B) ──► [AudioWorkletNode B: ring buffer + jitter buffer] ─► GainNode B ─┼─► MediaStreamAudioDestinationNode ─► track
 *   ...                                                                                      ┘
 *
 * - Um único módulo AudioWorklet (public/app-audio-worklet.js) é registrado; cada PID ganha sua
 *   própria instância do nó, logo seu próprio ring buffer e seu próprio GainNode
 *   (volume/mute individuais).
 * - Nada é conectado a `AudioContext.destination`: o áudio NÃO toca no alto-falante
 *   local, apenas segue para a transmissão.
 * - Os blocos chegam do processo nativo com jitter. O processor mantém um
 *   pré-buffer (~80 ms) antes de começar a tocar, descarta o excesso quando o
 *   atraso passa de ~200 ms (limita a latência) e preenche com silêncio em
 *   caso de underrun (re-armando o pré-buffer).
 */

import type { NativeAudioChunk } from '@shared/index';

const SAMPLE_RATE = 48000;
/** Deve ser igual ao nome registrado em registerProcessor() em public/app-audio-worklet.js */
const PROCESSOR_NAME = 'app-audio-source-processor';
/**
 * O processor é um arquivo estático de mesma origem (public/app-audio-worklet.js),
 * o que funciona no `vite dev` e sob o protocolo `app://` do Electron mesmo com
 * CSP `script-src 'self'` (que bloquearia um Blob URL).
 */
const WORKLET_URL = `${import.meta.env.BASE_URL}app-audio-worklet.js`;

/** Nós de áudio e estado de uma fonte (PID) */
interface SourceEntry {
  worklet: AudioWorkletNode;
  gain: GainNode;
  volume: number;
  muted: boolean;
}

export class AppAudioMixer {
  private readonly ctx: AudioContext;
  private readonly destination: MediaStreamAudioDestinationNode;
  private readonly sources = new Map<number, SourceEntry>();
  private destroyed = false;

  private constructor(ctx: AudioContext, destination: MediaStreamAudioDestinationNode) {
    this.ctx = ctx;
    this.destination = destination;
  }

  /** Cria o contexto, registra o worklet e prepara o destino da transmissão. */
  static async create(): Promise<AppAudioMixer> {
    const ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });

    try {
      await ctx.audioWorklet.addModule(WORKLET_URL);
    } catch (err) {
      await ctx.close().catch(() => undefined);
      throw new Error(
        'Não foi possível iniciar o processamento de áudio dos aplicativos' +
          (err instanceof Error && err.message ? ` (${err.message}).` : '.'),
      );
    }

    const destination = ctx.createMediaStreamDestination();
    destination.channelCount = 2;

    // Contextos criados sem gesto do usuário podem iniciar suspensos.
    // Não aguardamos: a promessa só resolve quando o contexto realmente rodar.
    void ctx.resume().catch(() => undefined);

    return new AppAudioMixer(ctx, destination);
  }

  /** Faixa de áudio mixada, pronta para entrar no MediaStream da transmissão. */
  get track(): MediaStreamTrack {
    return this.destination.stream.getAudioTracks()[0];
  }

  /** Registra uma fonte (PID): cria worklet + GainNode e liga ao destino. */
  addSource(pid: number): void {
    if (this.destroyed || this.sources.has(pid)) return;

    const worklet = new AudioWorkletNode(this.ctx, PROCESSOR_NAME, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    const gain = this.ctx.createGain();

    worklet.connect(gain);
    gain.connect(this.destination);

    this.sources.set(pid, { worklet, gain, volume: 1, muted: false });
  }

  /** Remove uma fonte e desconecta/libera seus nós. */
  removeSource(pid: number): void {
    const entry = this.sources.get(pid);
    if (!entry) return;
    this.sources.delete(pid);

    entry.worklet.port.onmessage = null;
    entry.worklet.port.close();
    entry.worklet.disconnect();
    entry.gain.disconnect();
  }

  /**
   * Envia um bloco PCM para o ring buffer do PID correspondente.
   * Blocos de PIDs não registrados são ignorados.
   */
  push(chunk: NativeAudioChunk): void {
    if (this.destroyed) return;
    const entry = this.sources.get(chunk.pid);
    if (!entry) return;

    // Garante consistência entre `frames` e o tamanho real do array (2 canais)
    const frames = Math.min(chunk.frames, Math.floor(chunk.pcm.length / 2));
    if (frames <= 0) return;

    // Cópia própria: o Float32Array recebido pode ser uma visão sobre um buffer
    // maior/reutilizado. Transferimos a cópia (sem segunda cópia no postMessage).
    const copy = new Float32Array(frames * 2);
    copy.set(chunk.pcm.subarray(0, frames * 2));
    entry.worklet.port.postMessage({ pcm: copy, frames }, [copy.buffer]);
  }

  /** Volume de 0.0 a 1.0 (aplicado ao vivo). */
  setVolume(pid: number, volume: number): void {
    const entry = this.sources.get(pid);
    if (!entry) return;
    entry.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 0));
    this.applyGain(entry);
  }

  /** Muta/desmuta (aplicado ao vivo), preservando o volume configurado. */
  setMuted(pid: number, muted: boolean): void {
    const entry = this.sources.get(pid);
    if (!entry) return;
    entry.muted = muted;
    this.applyGain(entry);
  }

  /** Libera todos os recursos. Seguro chamar mais de uma vez. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;

    for (const pid of Array.from(this.sources.keys())) {
      this.removeSource(pid);
    }
    this.destination.disconnect();
    this.destination.stream.getTracks().forEach((t) => t.stop());

    if (this.ctx.state !== 'closed') {
      await this.ctx.close().catch(() => undefined);
    }
  }

  /** Aplica o ganho efetivo com uma pequena rampa para evitar estalos. */
  private applyGain(entry: SourceEntry): void {
    const target = entry.muted ? 0 : entry.volume;
    entry.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
  }
}
