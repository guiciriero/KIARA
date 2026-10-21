/**
 * harness.ts — roda DENTRO da página, no Chrome real.
 *
 * Usa o código de produção (BroadcastAudio, WebRTCBroadcaster, WebRTCViewer) com:
 *  - sinalização falsa em memória (hostSocket <-> viewerSocket);
 *  - host nativo falso gerando PCM (seno 440 Hz = pid 1, seno 1000 Hz = pid 2);
 *  - vídeo de canvas.captureStream(60).
 * O espectador mede o áudio recebido via AnalyserNode (FFT) e o vídeo via getStats()/pixels.
 *
 * Tipagem propositalmente frouxa: este arquivo não entra no tsc/lint do projeto.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { BroadcastAudio } from '../src/services/broadcastAudio';
import type { AudioSelectionItem } from '../src/services/broadcastAudio';
import { MediaError } from '../src/services/mediaError';
import { WebRTCBroadcaster, WebRTCViewer } from '../src/services/webrtcService';

// ─── Constantes de calibração (valores medidos em Chrome 155; ver README) ─────

const SAMPLE_RATE = 48000;
const FREQ_A = 440;
const FREQ_B = 1000;
const FREQ_TOLERANCE_HZ = 30;
const FFT_SIZE = 4096;
const WINDOW_MS = 300;
/** Nível (dBFS do analisador) acima do qual um tom conta como "presente" */
const TONE_PRESENT_DB = -35;
/** Nível abaixo do qual um tom conta como "ausente" */
const TONE_ABSENT_DB = -60;
/** RMS médio mínimo para "há som" (seno de amplitude 0,5 ⇒ RMS ≈ 0,35) */
const RMS_PRESENT = 0.05;
/** RMS máximo da janela para "silêncio" */
const RMS_SILENCE = 0.003;
const SETTLE_TIMEOUT_MS = 6000;

const ITEM_A: AudioSelectionItem = { id: 'app-A', pid: 1, volume: 1, muted: false };
const ITEM_B: AudioSelectionItem = { id: 'app-B', pid: 2, volume: 1, muted: false };

const VIDEO_CONFIG = {
  width: 960,
  height: 540,
  frameRate: 60,
  codec: 'H264',
  bitrate: 5000,
  quality: 'high',
} as const;

// ─── Utilitários ─────────────────────────────────────────────────────────────

declare global {
  interface Window {
    __e2eLog: (line: string) => void;
    __runAll: () => Promise<ScenarioResult[]>;
  }
}

const log = (line: string) => window.__e2eLog(line);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const db = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const fmtDb = (x: number) => (Number.isFinite(x) ? `${x.toFixed(1)} dB` : '-∞ dB');

async function waitFor<T>(
  probe: () => T | Promise<T>,
  pred: (v: T) => boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<{ ok: boolean; value: T; elapsedMs: number }> {
  const t0 = performance.now();
  let value = await probe();
  while (!pred(value)) {
    if (performance.now() - t0 > timeoutMs) return { ok: false, value, elapsedMs: performance.now() - t0 };
    await sleep(intervalMs);
    value = await probe();
  }
  return { ok: true, value, elapsedMs: performance.now() - t0 };
}

// ─── Sinalização falsa (imita o subconjunto usado de socket.io-client) ────────

type Handler = (payload: any) => void;

class FakeSocket {
  private handlers = new Map<string, Set<Handler>>();
  onEmit?: (event: string, payload: any) => void;

  on(event: string, fn: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
  }

  once(event: string, fn: Handler): this {
    const wrapper: Handler = (p) => {
      this.off(event, wrapper);
      fn(p);
    };
    return this.on(event, wrapper);
  }

  off(event: string, fn?: Handler): this {
    if (!fn) this.handlers.delete(event);
    else this.handlers.get(event)?.delete(fn);
    return this;
  }

  emit(event: string, payload?: any): this {
    this.onEmit?.(event, payload);
    return this;
  }

  /** Entrega um evento "vindo do servidor" aos ouvintes locais. */
  fire(event: string, payload: any): void {
    for (const fn of Array.from(this.handlers.get(event) ?? [])) fn(payload);
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

function createSignaling() {
  const hostSocket = new FakeSocket();
  const viewerSocket = new FakeSocket();
  const offers: { sdp: string; at: number }[] = [];

  const route = (from: 'host' | 'viewer', to: FakeSocket, targetExpected: string) => (event: string, payload: any) => {
    if (!event.startsWith('webrtc:')) return;
    if (payload?.targetId !== targetExpected) {
      log(`    [sinalização] descartado ${event} com targetId inesperado: ${payload?.targetId}`);
      return;
    }
    if (from === 'host' && event === 'webrtc:offer') offers.push({ sdp: payload.offer.sdp, at: performance.now() });
    const { targetId: _ignored, ...rest } = payload;
    // Assíncrono, como numa rede real (evita reentrância)
    setTimeout(() => to.fire(event, { senderId: from, ...rest }), 0);
  };
  hostSocket.onEmit = route('host', viewerSocket, 'viewer');
  viewerSocket.onEmit = route('viewer', hostSocket, 'host');

  return { hostSocket, viewerSocket, offers };
}

// ─── Monitor de atraso da thread principal (diagnóstico) ─────────────────────
// O PCM falso nasce num setInterval da thread principal; se ela travar, o worklet
// sofre underrun e o espectador ouve uma lacuna que NÃO é culpa da troca de vídeo.

const stalls: { t: number; gapMs: number }[] = [];
{
  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    if (now - last > 40) stalls.push({ t: now, gapMs: now - last });
    last = now;
  }, 10);
}

// ─── Host nativo falso (PCM sintético) ───────────────────────────────────────

function createFakeHost() {
  const state = {
    startCalls: 0,
    stopCalls: 0,
    failNextStart: false,
    activePids: [] as number[],
    startArgs: [] as number[][],
  };
  let timer: ReturnType<typeof setInterval> | null = null;
  const halt = () => {
    if (timer) clearInterval(timer);
    timer = null;
    state.activePids = [];
  };
  const freqOf = (pid: number) => (pid === 1 ? FREQ_A : FREQ_B);

  const api = {
    platform: 'macos',
    audio: {
      async listSources() {
        return [];
      },
      async start(pids: number[], onChunk: (chunk: any) => void) {
        state.startCalls += 1;
        state.startArgs.push([...pids]);
        if (state.failNextStart) {
          state.failNextStart = false;
          throw new Error('Falha simulada ao iniciar a captura nativa');
        }
        halt(); // start repetido substitui o anterior (como o preload real)
        state.activePids = [...pids];

        const FRAMES = 480; // 10 ms
        const t0 = performance.now();
        let produced = 0;
        timer = setInterval(() => {
          // Relógio de parede: se o timer atrasar, recupera emitindo blocos extras
          const due = Math.floor(((performance.now() - t0) * SAMPLE_RATE) / 1000);
          while (due - produced >= FRAMES) {
            for (const pid of pids) {
              const pcm = new Float32Array(FRAMES * 2);
              const w = (2 * Math.PI * freqOf(pid)) / SAMPLE_RATE;
              for (let i = 0; i < FRAMES; i++) {
                const s = 0.5 * Math.sin(w * (produced + i));
                pcm[i * 2] = s;
                pcm[i * 2 + 1] = s;
              }
              onChunk({ pid, pcm, frames: FRAMES, sampleRate: SAMPLE_RATE, channels: 2 });
            }
            produced += FRAMES;
          }
        }, 10);
      },
      async stop() {
        state.stopCalls += 1;
        halt();
      },
    },
  };
  return { api: api as any, state };
}

// ─── Vídeo: canvas animado ────────────────────────────────────────────────────

function createCanvasSource(background: string) {
  const W = VIDEO_CONFIG.width;
  const H = VIDEO_CONFIG.height;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  let x = 0;
  let raf = 0;
  const draw = () => {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, W, H);
    x = (x + 9) % (W - 140);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x, 200, 140, 140); // longe do canto onde amostramos a cor
    raf = requestAnimationFrame(draw);
  };
  draw();
  const stream = canvas.captureStream(60);
  return {
    track: stream.getVideoTracks()[0],
    stop() {
      cancelAnimationFrame(raf);
      stream.getTracks().forEach((t) => t.stop());
    },
  };
}

// ─── Medidor de áudio no espectador ──────────────────────────────────────────

interface Measure {
  n: number;
  rmsMean: number;
  rmsMax: number;
  peakHz: number;
  peakDb: number;
  dbA: number;
  dbB: number;
}

class Meter {
  readonly ctx: AudioContext;
  private analyser: AnalyserNode;
  private timeBuf = new Float32Array(FFT_SIZE);
  private specDb = new Float32Array(FFT_SIZE / 2);
  private samples: { t: number; rms: number; lin: Float32Array }[] = [];
  private timer: ReturnType<typeof setInterval>;
  private binHz: number;

  constructor(stream: MediaStream) {
    this.ctx = new AudioContext();
    void this.ctx.resume();
    this.binHz = this.ctx.sampleRate / FFT_SIZE;
    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    this.analyser.smoothingTimeConstant = 0;
    this.analyser.minDecibels = -140;
    src.connect(this.analyser);
    // Ganho 0 até o destino: garante que o grafo seja "puxado" sem sair som
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    this.analyser.connect(mute);
    mute.connect(this.ctx.destination);
    this.timer = setInterval(() => this.tick(), 40);
  }

  private tick(): void {
    this.analyser.getFloatTimeDomainData(this.timeBuf);
    let sum = 0;
    for (let i = 0; i < this.timeBuf.length; i++) sum += this.timeBuf[i] * this.timeBuf[i];
    const rms = Math.sqrt(sum / this.timeBuf.length);
    this.analyser.getFloatFrequencyData(this.specDb);
    const lin = new Float32Array(this.specDb.length);
    for (let k = 0; k < lin.length; k++) lin[k] = Math.pow(10, this.specDb[k] / 20);
    const t = performance.now();
    this.samples.push({ t, rms, lin });
    while (this.samples.length > 0 && t - this.samples[0].t > 15000) this.samples.shift();
  }

  private band(lin: Float32Array, f: number): number {
    const lo = Math.max(1, Math.ceil((f - FREQ_TOLERANCE_HZ) / this.binHz));
    const hi = Math.floor((f + FREQ_TOLERANCE_HZ) / this.binHz);
    let m = 0;
    for (let k = lo; k <= hi; k++) m = Math.max(m, lin[k]);
    return m;
  }

  /** Média das capturas dos últimos `ms` milissegundos. */
  measure(ms = WINDOW_MS): Measure | null {
    const now = performance.now();
    const win = this.samples.filter((s) => now - s.t <= ms);
    if (win.length < 3) return null;
    const avg = new Float32Array(this.specDb.length);
    let rmsSum = 0;
    let rmsMax = 0;
    for (const s of win) {
      for (let k = 0; k < avg.length; k++) avg[k] += s.lin[k] / win.length;
      rmsSum += s.rms;
      rmsMax = Math.max(rmsMax, s.rms);
    }
    let pk = 3;
    for (let k = 3; k < avg.length; k++) if (avg[k] > avg[pk]) pk = k;
    return {
      n: win.length,
      rmsMean: rmsSum / win.length,
      rmsMax,
      peakHz: pk * this.binHz,
      peakDb: db(avg[pk]),
      dbA: db(this.band(avg, FREQ_A)),
      dbB: db(this.band(avg, FREQ_B)),
    };
  }

  /** Amostras com RMS abaixo de `thr` desde `sinceMs`, com tempo relativo a `sinceMs`. */
  dipsSince(sinceMs: number, thr: number): { dtMs: number; rms: number }[] {
    return this.samples.filter((s) => s.t >= sinceMs && s.rms < thr).map((s) => ({ dtMs: Math.round(s.t - sinceMs), rms: +s.rms.toFixed(3) }));
  }

  /** Menor RMS instantâneo desde `sinceMs` (timestamp de performance.now()). */
  minRmsSince(sinceMs: number): number {
    const win = this.samples.filter((s) => s.t >= sinceMs);
    return win.length ? Math.min(...win.map((s) => s.rms)) : NaN;
  }

  close(): void {
    clearInterval(this.timer);
    void this.ctx.close().catch(() => undefined);
  }
}

const fmtM = (m: Measure | null) =>
  m
    ? `pico=${m.peakHz.toFixed(0)} Hz (${fmtDb(m.peakDb)}), rms=${m.rmsMean.toFixed(3)}, ` +
      `nível440=${fmtDb(m.dbA)}, nível1000=${fmtDb(m.dbB)}`
    : 'sem amostras';

// ─── Infra de cenários ───────────────────────────────────────────────────────

export interface ScenarioResult {
  num: number;
  title: string;
  status: 'PASS' | 'FAIL' | 'NÃO VALIDADO';
  failures: string[];
  elapsedMs: number;
}

class Scenario {
  failures: string[] = [];
  note: string | null = null;
  check(ok: boolean, desc: string, detail = ''): boolean {
    log(`    ${ok ? '✓' : '✗'} ${desc}${detail ? ` — ${detail}` : ''}`);
    if (!ok) this.failures.push(`${desc}${detail ? ` — ${detail}` : ''}`);
    return ok;
  }
  info(line: string): void {
    log(`    · ${line}`);
  }
}

// ─── Execução ────────────────────────────────────────────────────────────────

async function runAll(): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = [];
  const cleanups: (() => void | Promise<void>)[] = [];

  // Ambiente
  const { hostSocket, viewerSocket, offers } = createSignaling();
  const sentinelHits: Record<string, number> = {};
  const sentinelEvents: [FakeSocket, string][] = [
    [hostSocket, 'room:viewer-joined'],
    [hostSocket, 'webrtc:answer'],
    [hostSocket, 'webrtc:ice-candidate'],
    [viewerSocket, 'webrtc:offer'],
    [viewerSocket, 'webrtc:ice-candidate'],
  ];
  sentinelEvents.forEach(([sock, ev], i) => {
    const key = `${i}:${ev}`;
    sentinelHits[key] = 0;
    sock.on(ev, () => {
      sentinelHits[key] += 1;
    });
  });

  const fake = createFakeHost();
  const videoEl = document.getElementById('remote') as HTMLVideoElement;
  const canvasA = createCanvasSource('#c82828'); // vermelho
  cleanups.push(() => canvasA.stop());
  let canvasB: ReturnType<typeof createCanvasSource> | null = null;

  const audio = await BroadcastAudio.create(fake.api);
  const audioTrack0 = audio.track;
  await audio.sync([ITEM_A]); // como o hook: áudio pronto antes da transmissão

  const videoTrackA = canvasA.track;
  const combined = new MediaStream([videoTrackA, audio.track]);
  const broadcaster = new WebRTCBroadcaster(hostSocket as any, { ...VIDEO_CONFIG }, { iceServers: [], privacyMode: false, maxViewers: 0 });
  broadcaster.setLocalStream(combined);
  const viewer = new WebRTCViewer(viewerSocket as any, 'host', []);

  let remoteStream: MediaStream | null = null;
  viewer.onStream((s) => {
    remoteStream = s;
  });
  hostSocket.fire('room:viewer-joined', { viewerId: 'viewer', viewerCount: 1 });

  const hostPc = (): RTCPeerConnection => (broadcaster as any).peers.get('viewer')?.pc;
  const viewerPc = (): RTCPeerConnection => (viewer as any).pc;

  let meter: Meter | null = null;
  cleanups.push(() => meter?.close());

  const framesDecoded = async (): Promise<number> => {
    const report = await viewerPc().getStats();
    let n = 0;
    report.forEach((s: any) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') n = s.framesDecoded ?? 0;
    });
    return n;
  };
  const expectFramesGrowing = async (s: Scenario, label: string) => {
    const before = await framesDecoded();
    const r = await waitFor(framesDecoded, (n) => n >= before + 15, 5000, 200);
    s.check(r.ok, `framesDecoded cresce ${label}`, `${before} → ${r.value} em ${r.elapsedMs.toFixed(0)} ms`);
  };

  /** Espera o estado de áudio pedido (janela de ~300 ms). */
  const expectAudio = async (
    s: Scenario,
    desc: string,
    spec: { has?: number[]; not?: number[]; silent?: boolean },
    timeoutMs = SETTLE_TIMEOUT_MS,
  ): Promise<boolean> => {
    const has = spec.has ?? [];
    const not = spec.not ?? [];
    const lvl = (m: Measure, f: number) => (f === FREQ_A ? m.dbA : m.dbB);
    const pred = (m: Measure | null): boolean => {
      if (!m) return false;
      if (spec.silent) return m.rmsMax < RMS_SILENCE;
      if (m.rmsMean < RMS_PRESENT) return false;
      if (!has.every((f) => lvl(m, f) > TONE_PRESENT_DB)) return false;
      if (!not.every((f) => lvl(m, f) < TONE_ABSENT_DB)) return false;
      if (has.length === 1 && Math.abs(m.peakHz - has[0]) >= FREQ_TOLERANCE_HZ) return false;
      return true;
    };
    const r = await waitFor(() => meter!.measure(), pred, timeoutMs, 100);
    return s.check(r.ok, desc, `${fmtM(r.value)}; estabilizou em ${r.elapsedMs.toFixed(0)} ms`);
  };

  const pixelRemote = (): { r: number; g: number; b: number } | null => {
    if (!videoEl.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 54;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(videoEl, 0, 0, c.width, c.height);
    const d = g.getImageData(1, 1, 4, 4).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      gg += d[i + 1];
      b += d[i + 2];
    }
    const n = d.length / 4;
    return { r: Math.round(r / n), g: Math.round(gg / n), b: Math.round(b / n) };
  };

  const scenario = async (num: number, title: string, fn: (s: Scenario) => Promise<void>) => {
    log(`\n▶ Cenário ${num}: ${title}`);
    const s = new Scenario();
    const t0 = performance.now();
    try {
      await fn(s);
    } catch (err: any) {
      s.check(false, 'exceção inesperada', `${err?.name ?? 'Error'}: ${err?.message ?? err}`);
    }
    const status: ScenarioResult['status'] = s.failures.length ? 'FAIL' : s.note ? 'NÃO VALIDADO' : 'PASS';
    results.push({ num, title, status, failures: s.failures, elapsedMs: performance.now() - t0 });
    log(`  ⇒ ${status}${s.note ? ` (${s.note})` : ''}`);
  };

  const sdpUfrag = (sdp: string) => /a=ice-ufrag:(\S+)/.exec(sdp)?.[1] ?? '';

  try {
    // ── 1. Conexão ──────────────────────────────────────────────────────────
    await scenario(1, 'Conexão WebRTC ponta a ponta', async (s) => {
      const got = await waitFor(
        () => remoteStream,
        (st) => !!st && st.getVideoTracks().length >= 1 && st.getAudioTracks().length >= 1,
        10000,
      );
      if (!s.check(got.ok, 'espectador recebeu stream remoto', `${got.elapsedMs.toFixed(0)} ms`)) return;
      const st = remoteStream!;
      s.check(
        st.getVideoTracks().length === 1 && st.getAudioTracks().length === 1,
        'stream remoto tem 1 faixa de vídeo e 1 de áudio',
        `vídeo=${st.getVideoTracks().length}, áudio=${st.getAudioTracks().length}`,
      );
      const conn = await waitFor(
        () => [hostPc().connectionState, viewerPc().connectionState],
        (v) => v[0] === 'connected' && v[1] === 'connected',
        10000,
      );
      s.check(conn.ok, 'connectionState = connected (host e espectador)', `host=${conn.value[0]}, espectador=${conn.value[1]}`);
      s.check(offers.length === 1, 'exatamente 1 oferta emitida até aqui', `ofertas=${offers.length}`);

      videoEl.srcObject = st;
      void videoEl.play().catch(() => undefined);
      meter = new Meter(st);
      await expectFramesGrowing(s, 'no vídeo recebido');
    });
    if (!meter) throw new Error('Cenário 1 falhou: sem conexão, os demais cenários não podem rodar.');

    // ── 2. App A ────────────────────────────────────────────────────────────
    await scenario(2, 'Iniciar com App A (pid 1) → ~440 Hz', async (s) => {
      await expectAudio(s, 'espectador ouve 440 Hz (e não 1000 Hz)', { has: [FREQ_A], not: [FREQ_B] });
      s.check(JSON.stringify(audio.activeIds) === JSON.stringify([ITEM_A.id]), 'activeIds = [app-A]', JSON.stringify(audio.activeIds));
    });

    // ── 3. A → B em runtime ─────────────────────────────────────────────────
    const remoteAudioTrack0 = remoteStream!.getAudioTracks()[0];
    await scenario(3, 'Trocar A → B em runtime, sem renegociar', async (s) => {
      const offersBefore = offers.length;
      const remoteIdBefore = remoteAudioTrack0.id;
      const idBefore = audio.track.id;
      await audio.sync([ITEM_B]);
      await expectAudio(s, 'espectador ouve 1000 Hz e NÃO ouve mais 440 Hz', { has: [FREQ_B], not: [FREQ_A] });
      s.check(audio.track === audioTrack0 && audio.track.id === idBefore, 'audio.track é a mesma instância (mesmo id)', `id=${audio.track.id}`);
      s.check(audio.track.readyState === 'live', 'audio.track continua live', audio.track.readyState);
      const remoteNow = remoteStream!.getAudioTracks()[0];
      s.check(
        remoteNow === remoteAudioTrack0 && remoteNow.id === remoteIdBefore && remoteNow.readyState === 'live',
        'faixa de áudio remota é a mesma (id inalterado, live)',
        `id=${remoteNow.id}`,
      );
      const sender = hostPc().getSenders().find((x) => x.track?.kind === 'audio');
      s.check(sender?.track === audio.track, 'sender de áudio do host ainda envia a mesma faixa do mixer');
      s.check(offers.length === offersBefore && offers.length === 1, 'contagem de ofertas permaneceu 1', `ofertas=${offers.length}`);
      s.check(JSON.stringify(audio.activeIds) === JSON.stringify([ITEM_B.id]), 'activeIds = [app-B]', JSON.stringify(audio.activeIds));
    });

    // ── 4. B → A ────────────────────────────────────────────────────────────
    await scenario(4, 'Reverter B → A', async (s) => {
      await audio.sync([ITEM_A]);
      await expectAudio(s, 'volta a ~440 Hz (sem 1000 Hz)', { has: [FREQ_A], not: [FREQ_B] });
      s.check(offers.length === 1, 'ofertas = 1', `ofertas=${offers.length}`);
    });

    // ── 5. A + B ────────────────────────────────────────────────────────────
    await scenario(5, 'A + B juntos', async (s) => {
      await audio.sync([ITEM_A, ITEM_B]);
      await expectAudio(s, 'espectro tem os picos de 440 Hz e 1000 Hz', { has: [FREQ_A, FREQ_B] });
      s.check(offers.length === 1, 'ofertas = 1', `ofertas=${offers.length}`);
    });

    // ── 6. Mute / unmute ────────────────────────────────────────────────────
    await scenario(6, 'Mute e unmute de A sem reiniciar a captura', async (s) => {
      await audio.sync([ITEM_A]);
      await expectAudio(s, 'só A: 440 Hz', { has: [FREQ_A], not: [FREQ_B] });
      const starts = fake.state.startCalls;
      const stops = fake.state.stopCalls;
      await audio.sync([{ ...ITEM_A, muted: true }]);
      await expectAudio(s, 'A mutado → silêncio', { silent: true });
      await audio.sync([ITEM_A]);
      await expectAudio(s, 'A desmutado → 440 Hz volta', { has: [FREQ_A], not: [FREQ_B] });
      s.check(
        fake.state.startCalls === starts && fake.state.stopCalls === stops,
        'mute/unmute NÃO chamou host.audio.start/stop',
        `start ${starts}→${fake.state.startCalls}, stop ${stops}→${fake.state.stopCalls}`,
      );
    });

    // ── 7. Desativar tudo ───────────────────────────────────────────────────
    await scenario(7, 'Desativar tudo e reativar', async (s) => {
      const stops = fake.state.stopCalls;
      const starts = fake.state.startCalls;
      await audio.sync([]);
      await expectAudio(s, 'sync([]) → silêncio', { silent: true });
      s.check(fake.state.stopCalls === stops + 1, 'host.audio.stop foi chamado', `stop ${stops}→${fake.state.stopCalls}`);
      s.check(fake.state.activePids.length === 0, 'host falso sem captura ativa');
      s.check(audio.activeIds.length === 0, 'activeIds = []', JSON.stringify(audio.activeIds));
      await audio.sync([ITEM_A]);
      await expectAudio(s, 'reativar A → 440 Hz volta', { has: [FREQ_A], not: [FREQ_B] });
      s.check(fake.state.startCalls === starts + 1, 'host.audio.start chamado de novo (1×)', `start ${starts}→${fake.state.startCalls}`);
      s.check(offers.length === 1, 'ofertas = 1', `ofertas=${offers.length}`);
    });

    // ── 8. replaceVideoTrack ────────────────────────────────────────────────
    await scenario(8, 'replaceVideoTrack (vermelho → azul) com áudio contínuo', async (s) => {
      // Cor inicial
      const red = await waitFor(pixelRemote, (p) => !!p && p.r > p.b + 60, 5000);
      s.check(red.ok, 'vídeo remoto inicialmente vermelho', JSON.stringify(red.value));
      await expectAudio(s, 'áudio A tocando antes da troca', { has: [FREQ_A], not: [FREQ_B] });

      canvasB = createCanvasSource('#2828c8'); // azul
      cleanups.push(() => canvasB?.stop());
      const oldTrack = videoTrackA;
      const offersBefore = offers.length;
      const framesBefore = await framesDecoded();
      const t0 = performance.now();
      await broadcaster.replaceVideoTrack(canvasB.track);

      const blue = await waitFor(pixelRemote, (p) => !!p && p.b > p.r + 60, 6000);
      s.check(blue.ok, 'cor do vídeo remoto mudou para azul', `${JSON.stringify(blue.value)} em ${(performance.now() - t0).toFixed(0)} ms`);
      await sleep(600);
      const minRms = meter!.minRmsSince(t0);
      s.check(minRms > 0.15, 'áudio ininterrupto durante a troca (RMS mínimo instantâneo)', `rms mín=${minRms.toFixed(3)} (nominal ≈0.35, silêncio<${RMS_SILENCE})`);
      const dips = meter!.dipsSince(t0, 0.25);
      const stallsIn = stalls.filter((x) => x.t >= t0 - 200).map((x) => ({ dtMs: Math.round(x.t - t0), gapMs: Math.round(x.gapMs) }));
      s.info(`diagnóstico: amostras com RMS<0.25 desde a troca: ${JSON.stringify(dips)}; travas da thread principal (>40 ms): ${JSON.stringify(stallsIn)}`);
      await expectAudio(s, 'áudio A segue em 440 Hz depois da troca', { has: [FREQ_A], not: [FREQ_B] });
      s.check(offers.length === offersBefore, 'sem nova oferta', `ofertas=${offers.length}`);
      s.check(oldTrack.readyState === 'ended', 'faixa de vídeo antiga ended', oldTrack.readyState);
      const sender = hostPc().getSenders().find((x) => x.track?.kind === 'video');
      s.check(sender?.track === canvasB.track, 'sender de vídeo envia a nova faixa');
      const after = await waitFor(framesDecoded, (n) => n >= framesBefore + 30, 6000, 200);
      s.check(after.ok, 'framesDecoded continua crescendo após a troca', `${framesBefore} → ${after.value}`);
    });

    // ── 9. Estatísticas reais ───────────────────────────────────────────────
    await scenario(9, 'Estatísticas reais (onStats + getStats + RTCRtpSender.getParameters)', async (s) => {
      const received: any[] = [];
      const t0 = performance.now();
      broadcaster.onStats((st) => received.push({ ...st, _t: performance.now() - t0 }));
      const ok = await waitFor(
        () => received.find((x) => x.fps > 0 && x.videoBitrate > 0),
        (x) => !!x,
        8000,
        200,
      );
      const st = ok.value as any;
      s.check(ok.ok, 'onStats entregou StreamStats com fps>0 e videoBitrate>0 em ≤ 8 s',
        ok.ok ? `após ${st._t.toFixed(0)} ms (${received.length} amostra(s))` : `amostras=${JSON.stringify(received)}`);
      if (st) {
        const { _t, ...clean } = st;
        void _t;
        s.info(`StreamStats: ${JSON.stringify(clean)}`);
        const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
        s.check(st.fps > 0, 'fps > 0', String(st.fps));
        s.check(st.videoBitrate > 0, 'videoBitrate > 0 (kbps)', String(st.videoBitrate));
        s.check(num(st.latencyMs), 'latencyMs numérico', String(st.latencyMs));
        s.check(num(st.lossPercent), 'lossPercent numérico', String(st.lossPercent));
        s.check(num(st.jitterMs), 'jitterMs numérico', String(st.jitterMs));
        s.check(['none', 'cpu', 'bandwidth', 'other'].includes(st.qualityLimitation), 'qualityLimitation válido', st.qualityLimitation);
        s.check(num(st.audioBitrate), 'audioBitrate numérico', String(st.audioBitrate));
      }

      // Leitura direta do pc do host
      const pc = hostPc();
      const report = await pc.getStats();
      let outbound: any = null;
      report.forEach((x: any) => {
        if (x.type === 'outbound-rtp' && x.kind === 'video') outbound = x;
      });
      s.check(!!outbound && outbound.framesPerSecond > 0, 'outbound-rtp(video).framesPerSecond > 0', String(outbound?.framesPerSecond));
      s.info(
        `outbound-rtp(video): fps=${outbound?.framesPerSecond}, qualityLimitationReason=${outbound?.qualityLimitationReason}, ` +
          `encoder=${outbound?.encoderImplementation}, ${outbound?.frameWidth}x${outbound?.frameHeight}`,
      );
      const sender = pc.getSenders().find((x) => x.track?.kind === 'video')!;
      const params: any = sender.getParameters();
      const enc = params.encodings?.[0] ?? {};
      s.info(
        `sender.getParameters(): degradationPreference=${params.degradationPreference}, ` +
          `maxBitrate=${enc.maxBitrate}, maxFramerate=${enc.maxFramerate}, priority=${enc.priority}, networkPriority=${enc.networkPriority}`,
      );
      // No CI (Linux/Windows), quality 'high' → 'maintain-framerate'.
      // No macOS, quality 'high' → 'balanced' (VideoToolbox). O harness aceita ambos.
      const validDegradation = params.degradationPreference === 'maintain-framerate' || params.degradationPreference === 'balanced';
      s.check(validDegradation, 'degradationPreference = maintain-framerate ou balanced', String(params.degradationPreference));
      s.check(enc.maxFramerate === 60, 'maxFramerate = 60', String(enc.maxFramerate));
      s.check(enc.maxBitrate === 5_000_000, 'maxBitrate = 5 000 000 bps', String(enc.maxBitrate));
    });

    // ── 10. Falha controlada ────────────────────────────────────────────────
    await scenario(10, 'Falha controlada em host.audio.start', async (s) => {
      await expectAudio(s, 'pré-condição: A tocando', { has: [FREQ_A], not: [FREQ_B] });
      const starts = fake.state.startCalls;
      fake.state.failNextStart = true;
      let thrown: unknown = null;
      try {
        await audio.sync([ITEM_A, ITEM_B]);
      } catch (err) {
        thrown = err;
      }
      s.check(thrown instanceof MediaError, 'sync lançou MediaError', thrown ? `${(thrown as any).name}/${(thrown as any).code}: ${(thrown as any).message}` : 'não lançou');
      s.check(JSON.stringify(audio.activeIds) === JSON.stringify([ITEM_A.id]), 'activeIds reflete o estado anterior ([app-A])', JSON.stringify(audio.activeIds));
      s.info(`host.audio.start chamado ${fake.state.startCalls - starts}× (tentativa + restauração) ; argumentos: ${JSON.stringify(fake.state.startArgs.slice(-2))}`);
      s.check(JSON.stringify(fake.state.activePids) === JSON.stringify([1]), 'captura nativa final = [pid 1]', JSON.stringify(fake.state.activePids));
      await expectAudio(s, 'áudio anterior continua audível (440 Hz, sem 1000 Hz)', { has: [FREQ_A], not: [FREQ_B] });
      s.check(offers.length === 1, 'ofertas = 1', `ofertas=${offers.length}`);
    });

    // ── 12. ICE restart (executa antes do destroy) ──────────────────────────
    await scenario(12, 'ICE restart (falha simulada via iceConnectionState=failed)', async (s) => {
      const pc = hostPc();
      const peerData = (broadcaster as any).peers.get('viewer');
      const offersBefore = offers.length;
      const ufragBefore = sdpUfrag(offers[offers.length - 1].sdp);
      // Como no Chrome real: ICE falha ⇒ iceConnectionState E connectionState viram 'failed'
      Object.defineProperty(pc, 'iceConnectionState', { configurable: true, get: () => 'failed' });
      Object.defineProperty(pc, 'connectionState', { configurable: true, get: () => 'failed' });
      pc.dispatchEvent(new Event('iceconnectionstatechange'));
      const got = await waitFor(() => offers.length, (n) => n === offersBefore + 1, 5000, 50);
      s.check(got.ok, 'saiu uma NOVA oferta após o estado failed', `ofertas ${offersBefore}→${got.value}`);
      s.check(peerData.iceRestartAttempts >= 1, 'iceRestartAttempts incrementou', String(peerData.iceRestartAttempts));
      if (got.ok) {
        const ufragNew = sdpUfrag(offers[offers.length - 1].sdp);
        s.info(`ice-ufrag da oferta: ${ufragBefore} → ${ufragNew} (${ufragNew !== ufragBefore ? 'mudou' : 'NÃO mudou — em Chrome isolado muda; só informativo'})`);
      }
      // Remove a falha simulada: o estado real (connected) volta a valer
      delete (pc as any).iceConnectionState;
      delete (pc as any).connectionState;
      const settled = await waitFor(
        () => [pc.signalingState, viewerPc().signalingState, pc.connectionState, viewerPc().connectionState],
        (v) => v[0] === 'stable' && v[1] === 'stable' && v[2] === 'connected' && v[3] === 'connected',
        8000,
      );
      s.check(settled.ok, 'renegociação concluída e conexão connected', JSON.stringify(settled.value));
      pc.dispatchEvent(new Event('connectionstatechange'));
      s.check(peerData.iceRestartAttempts === 0, 'handler "connected" zerou iceRestartAttempts', String(peerData.iceRestartAttempts));
      const tracksSame = remoteStream!.getAudioTracks()[0] === remoteAudioTrack0 && remoteAudioTrack0.readyState === 'live';
      s.check(tracksSame, 'faixa de áudio remota é a mesma e está live');
      await expectAudio(s, 'áudio A (440 Hz) continua depois do restart', { has: [FREQ_A], not: [FREQ_B] });
      await expectFramesGrowing(s, 'depois do restart');

      // Observação: no Chrome real uma falha dispara AMBOS os eventos; veja quantas ofertas saem.
      const offersBeforeDouble = offers.length;
      Object.defineProperty(pc, 'iceConnectionState', { configurable: true, get: () => 'failed' });
      Object.defineProperty(pc, 'connectionState', { configurable: true, get: () => 'failed' });
      pc.dispatchEvent(new Event('iceconnectionstatechange'));
      pc.dispatchEvent(new Event('connectionstatechange'));
      await sleep(1500);
      delete (pc as any).iceConnectionState;
      delete (pc as any).connectionState;
      s.info(`OBSERVAÇÃO: falha com iceconnectionstatechange + connectionstatechange (ambos, como no Chrome real) gerou ${offers.length - offersBeforeDouble} oferta(s) de ICE restart`);
      await waitFor(() => [pc.signalingState, viewerPc().signalingState, pc.connectionState], (v) => v[0] === 'stable' && v[1] === 'stable' && v[2] === 'connected', 8000);
      pc.dispatchEvent(new Event('connectionstatechange'));
      s.note = 'falha ICE simulada por defineProperty no pc; o caminho de restart é o real, mas não houve queda de rede real';
    });

    // ── 11. destroy ─────────────────────────────────────────────────────────
    await scenario(11, 'destroy: faixas ended, AudioContext fechado, listeners alheios preservados', async (s) => {
      const mixerCtx: AudioContext = (audio as any).mixer.ctx;
      const stops = fake.state.stopCalls;
      s.check(sentinelEvents.every(([sock, ev]) => sock.listenerCount(ev) >= 2), 'pré-condição: sentinelas + handlers do app registrados');

      broadcaster.destroy();
      viewer.destroy();
      await audio.destroy();

      s.check(audio.track.readyState === 'ended', 'faixa de saída do mixer ended', audio.track.readyState);
      s.check(mixerCtx.state === 'closed', 'AudioContext do mixer fechado', mixerCtx.state);
      s.check(fake.state.stopCalls === stops + 1 && fake.state.activePids.length === 0, 'host.audio.stop chamado no destroy', `stop ${stops}→${fake.state.stopCalls}`);
      s.check(hostPc() === undefined, 'broadcaster sem peers');
      s.check(viewerPc() === null, 'viewer sem pc');
      const closed = await waitFor(() => (combined.getAudioTracks()[0] as MediaStreamTrack).readyState, (v) => v === 'ended', 1000);
      s.check(closed.ok, 'audio.track dentro do MediaStream combinado também ended');

      for (const [sock, ev] of sentinelEvents) {
        s.check(sock.listenerCount(ev) === 1, `listener alheio sobrevive em "${ev}"`, `listeners=${sock.listenerCount(ev)}`);
      }
      // Os sentinelas continuam sendo chamados de verdade
      hostSocket.fire('room:viewer-joined', { viewerId: 'x', viewerCount: 2 });
      const hitKey = Object.keys(sentinelHits).find((k) => k.endsWith('room:viewer-joined'))!;
      s.check(sentinelHits[hitKey] >= 2, 'sentinela de room:viewer-joined ainda dispara', `disparos=${sentinelHits[hitKey]}`);
      // Pós-destroy: novo viewer-joined não deve criar peer (handler removido)
      await sleep(100);
      s.check((broadcaster as any).peers.size === 0, 'viewer-joined após destroy não cria peer');
      // sync pós-destroy resolve sem efeito
      await audio.sync([ITEM_A]);
      s.check(fake.state.activePids.length === 0, 'sync após destroy não reinicia captura');
    });
  } finally {
    for (const c of cleanups.reverse()) {
      try {
        await c();
      } catch {
        // limpeza best-effort
      }
    }
  }

  return results.sort((a, b) => a.num - b.num);
}

window.__runAll = runAll;
