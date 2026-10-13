/**
 * broadcastAudio.ts
 *
 * Áudio da transmissão atrás de UMA faixa de saída estável (a do AudioMixer).
 * Trocar, adicionar ou remover fontes só altera o grafo de áudio: a faixa
 * enviada ao WebRTC nunca muda, então não há replaceTrack, renegociação nem lacuna.
 *
 * - Desktop (`host` definido): uma fonte PCM por PID; o processo principal reinicia
 *   a captura nativa sempre que o conjunto de PIDs muda.
 * - Web (`host` indefinido): a faixa do getDisplayMedia entra no grafo como fonte
 *   'web:system-audio'; ligar/desligar não para a faixa original.
 */

import type { ScreenShareHostApi } from '@shared/index';
import { AudioMixer } from './audioMixer';
import { MediaError, toMediaError } from './mediaError';

export interface AudioSelectionItem {
  id: string;
  pid: number;
  volume: number;
  muted: boolean;
}

export const WEB_SYSTEM_AUDIO_ID = 'web:system-audio';

const NO_SYSTEM_AUDIO_MESSAGE =
  'O navegador não compartilhou o áudio do sistema. Reinicie a transmissão e marque "Compartilhar áudio" no seletor.';

interface Waiter {
  resolve: () => void;
  reject: (err: unknown) => void;
}

export class BroadcastAudio {
  /** Constante por toda a vida; emite silêncio quando nada está selecionado. */
  readonly track: MediaStreamTrack;

  private readonly mixer: AudioMixer;
  private readonly host?: ScreenShareHostApi;

  /** Desktop: fontes PCM roteadas agora, por PID */
  private routed = new Map<number, AudioSelectionItem>();
  private capturing = false;
  /** Web: faixas do getDisplayMedia (pertencem a quem as criou) */
  private systemTracks: MediaStreamTrack[] = [];

  private latest: AudioSelectionItem[] = [];
  private waiters: Waiter[] = [];
  private loop: Promise<void> | null = null;
  private destroyPromise: Promise<void> | null = null;

  private constructor(mixer: AudioMixer, host?: ScreenShareHostApi) {
    this.mixer = mixer;
    this.host = host;
    this.track = mixer.track;
  }

  static async create(host?: ScreenShareHostApi): Promise<BroadcastAudio> {
    try {
      return new BroadcastAudio(await AudioMixer.create(), host);
    } catch (err) {
      throw toMediaError(err, 'audio-unavailable');
    }
  }

  /** Ids (de `AudioSelectionItem`) das fontes realmente roteadas agora. */
  get activeIds(): string[] {
    if (this.host) return Array.from(this.routed.values(), (item) => item.id);
    return this.mixer.hasSource(WEB_SYSTEM_AUDIO_ID) ? [WEB_SYSTEM_AUDIO_ID] : [];
  }

  /** Modo web: registra as faixas de áudio do getDisplayMedia. Chamar antes do primeiro `sync`. */
  attachSystemAudio(tracks: MediaStreamTrack[]): void {
    this.systemTracks = tracks.filter((t) => t.kind === 'audio');
    // Uma faixa nova invalida a rota anterior; o próximo `sync` religa.
    this.mixer.removeSource(WEB_SYSTEM_AUDIO_ID);
  }

  /**
   * Aplica a seleção. Chamadas são serializadas e coalescidas: só a última seleção
   * é aplicada, e as chamadas intermediárias resolvem sem erro.
   */
  sync(selection: AudioSelectionItem[]): Promise<void> {
    if (this.destroyPromise) return Promise.resolve();

    this.latest = selection;
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.loop ??= this.drain();
    });
  }

  async destroy(): Promise<void> {
    this.destroyPromise ??= this.teardown();
    return this.destroyPromise;
  }

  private async teardown(): Promise<void> {
    await this.loop?.catch(() => undefined);
    this.settle(this.waiters.splice(0));

    if (this.host && this.capturing) {
      this.capturing = false;
      await this.host.audio.stop().catch(() => undefined);
    }
    this.routed.clear();
    await this.mixer.destroy();
  }

  private async drain(): Promise<void> {
    // Cede um microtask para chamadas síncronas em sequência caírem no mesmo lote.
    await Promise.resolve();

    try {
      while (this.waiters.length > 0) {
        const batch = this.waiters.splice(0);
        const last = batch.pop();
        this.settle(batch);
        if (!last) break;

        if (this.destroyPromise) {
          last.resolve();
          continue;
        }
        try {
          await (this.host ? this.syncDesktop(this.host, this.latest) : this.syncWeb(this.latest));
          last.resolve();
        } catch (err) {
          last.reject(toMediaError(err, 'audio-unavailable'));
        }
      }
    } finally {
      // Síncrono ao sair do laço: um sync() disparado logo após resolver inicia novo ciclo.
      this.loop = null;
    }
  }

  private settle(waiters: Waiter[]): void {
    for (const w of waiters) w.resolve();
  }

  // ── Desktop ────────────────────────────────────────────────────────────────

  private async syncDesktop(host: ScreenShareHostApi, selection: AudioSelectionItem[]): Promise<void> {
    const want = new Map<number, AudioSelectionItem>();
    for (const item of selection) want.set(item.pid, item);

    const prev = new Map(this.routed);
    const changed = want.size !== prev.size || Array.from(want.keys()).some((pid) => !prev.has(pid));

    try {
      this.applyDesktopGraph(want);
      if (changed) await this.restartCapture(host);
    } catch (err) {
      // Melhor esforço: volta ao último estado bom, grafo e captura nativa.
      try {
        this.applyDesktopGraph(prev);
        if (changed) await this.restartCapture(host);
      } catch {
        // o erro original é o que importa
      }
      throw err;
    }
  }

  /** Leva o grafo ao alvo; `routed` é atualizado passo a passo para refletir o estado real. */
  private applyDesktopGraph(target: Map<number, AudioSelectionItem>): void {
    // Remove ANTES de reiniciar a captura: chunks tardios desses PIDs são ignorados.
    for (const pid of Array.from(this.routed.keys())) {
      if (target.has(pid)) continue;
      this.mixer.removeSource(String(pid));
      this.routed.delete(pid);
    }
    for (const [pid, item] of target) {
      const key = String(pid);
      if (!this.mixer.hasSource(key)) this.mixer.addPcmSource(key);
      this.mixer.setVolume(key, item.volume);
      this.mixer.setMuted(key, item.muted);
      this.routed.set(pid, item);
    }
  }

  private async restartCapture(host: ScreenShareHostApi): Promise<void> {
    const pids = Array.from(this.routed.keys());
    if (pids.length === 0) {
      await host.audio.stop();
      this.capturing = false;
      return;
    }
    this.capturing = true;
    await host.audio.start(pids, (chunk) => this.mixer.push(String(chunk.pid), chunk));
  }

  // ── Web ────────────────────────────────────────────────────────────────────

  private async syncWeb(selection: AudioSelectionItem[]): Promise<void> {
    const item = selection.find((i) => i.id === WEB_SYSTEM_AUDIO_ID);
    const key = WEB_SYSTEM_AUDIO_ID;

    if (!item) {
      this.mixer.removeSource(key);
      return;
    }

    if (!this.mixer.hasSource(key)) {
      const track = this.systemTracks.find((t) => t.readyState === 'live');
      if (!track) throw new MediaError('audio-unavailable', NO_SYSTEM_AUDIO_MESSAGE);
      try {
        this.mixer.addTrackSource(key, track);
      } catch (err) {
        this.mixer.removeSource(key);
        throw err;
      }
    }
    this.mixer.setVolume(key, item.volume);
    this.mixer.setMuted(key, item.muted);
  }
}
