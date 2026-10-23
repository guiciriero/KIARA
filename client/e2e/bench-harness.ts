/**
 * bench-harness.ts — benchmark de pipeline WebRTC em Chrome real (loopback na mesma página).
 *
 * Usa o código de produção (WebRTCBroadcaster / WebRTCViewer) com sinalização falsa em memória
 * e uma cena sintética de FPS (ruído de alta entropia em movimento + explosões + troca brusca de cena).
 *
 * Mede: FPS entregue/apresentado, bitrate, tempo de encode/decode, jitter buffer, freezes,
 * pacing (intervalo entre frames apresentados via requestVideoFrameCallback) e latência
 * glass-to-glass (ID do frame embutido em blocos no canvas, lido de volta no <video> remoto).
 *
 * Tipagem frouxa de propósito: este arquivo não entra no tsc/lint do projeto.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { WebRTCBroadcaster, WebRTCViewer } from '../src/services/webrtcService';

interface BenchConfig {
  width: number;
  height: number;
  fps: number;
  codec: 'H264' | 'VP9' | 'AV1' | 'H265';
  bitrate: number; // kbps
  durationSec: number;
  warmupSec: number;
  quality: 'game' | 'ultra' | 'high' | 'medium' | 'low';
}

declare global {
  interface Window {
    __runBench: (cfg: BenchConfig) => Promise<any>;
  }
}

type Handler = (payload: any) => void;
class FakeSocket {
  private handlers = new Map<string, Set<Handler>>();
  onEmit?: (event: string, payload: any) => void;
  on(event: string, fn: Handler): this {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return this;
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
  fire(event: string, payload: any): void {
    for (const fn of Array.from(this.handlers.get(event) ?? [])) fn(payload);
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pct = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))];
};
const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

// ─── Cena sintética de FPS ───────────────────────────────────────────────────

const ID_BITS = 16;

function makeScene(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true })!;

  // Textura "tipo jogo": detalhe de média frequência (1/12 da resolução, suavizado) + grão fino leve.
  // Ruído puro por pixel seria irreal (centenas de Mbps); isto aproxima grama/concreto/partículas.
  const noise = document.createElement('canvas');
  noise.width = width * 2;
  noise.height = height;
  const nctx = noise.getContext('2d')!;
  const small = document.createElement('canvas');
  small.width = Math.ceil(noise.width / 12);
  small.height = Math.ceil(noise.height / 12);
  const sctx = small.getContext('2d')!;
  const simg = sctx.createImageData(small.width, small.height);
  for (let i = 0; i < simg.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    simg.data[i] = v;
    simg.data[i + 1] = (v * 0.8) | 0;
    simg.data[i + 2] = (v * 0.5) | 0;
    simg.data[i + 3] = 255;
  }
  sctx.putImageData(simg, 0, 0);
  nctx.imageSmoothingEnabled = true;
  nctx.drawImage(small, 0, 0, noise.width, noise.height);
  const grain = nctx.getImageData(0, 0, noise.width, noise.height);
  for (let i = 0; i < grain.data.length; i += 4) {
    const g = ((Math.random() - 0.5) * 24) | 0;
    grain.data[i] = Math.max(0, Math.min(255, grain.data[i] + g));
    grain.data[i + 1] = Math.max(0, Math.min(255, grain.data[i + 1] + g));
    grain.data[i + 2] = Math.max(0, Math.min(255, grain.data[i + 2] + g));
  }
  nctx.putImageData(grain, 0, 0);

  const blockW = Math.floor(width / ID_BITS);
  const blockH = 40;
  let frame = 0;
  const sentAt = new Map<number, number>();
  let sceneBase = 0;
  const explosions: { x: number; y: number; t: number }[] = [];

  function draw() {
    frame++;
    // "Câmera brusca": a cada ~2 s muda deslocamento e escala (troca rápida de cena)
    if (frame % 120 === 0) sceneBase = (Math.random() * width) | 0;
    const pan = (frame * 37 + sceneBase) % width; // 37 px/frame ≈ 2200 px/s
    ctx.drawImage(noise, pan, 0, width, height, 0, 0, width, height);
    // Explosões: círculos grandes saturados e luminosos
    if (frame % 45 === 0) explosions.push({ x: Math.random() * width, y: Math.random() * height, t: 0 });
    for (let i = explosions.length - 1; i >= 0; i--) {
      const e = explosions[i];
      e.t++;
      const r = e.t * 18;
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
      g.addColorStop(0, 'rgba(255,255,220,0.95)');
      g.addColorStop(0.4, 'rgba(255,140,0,0.7)');
      g.addColorStop(1, 'rgba(120,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (e.t > 30) explosions.splice(i, 1);
    }
    // HUD estático (texto nítido, como em um jogo)
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(20, 20, 360, 70);
    ctx.fillStyle = '#0f0';
    ctx.font = '28px monospace';
    ctx.fillText(`HP 100  AMMO 30/90  #${frame}`, 30, 65);
    // Código do frame: 16 blocos pretos/brancos grandes na base (sobrevive à compressão)
    for (let b = 0; b < ID_BITS; b++) {
      ctx.fillStyle = (frame >> b) & 1 ? '#fff' : '#000';
      ctx.fillRect(b * blockW, height - blockH, blockW, blockH);
    }
    sentAt.set(frame & 0xffff, performance.now());
    return frame;
  }

  function readId(src: CanvasImageSource, w: number, h: number, probe: CanvasRenderingContext2D): number {
    const srcH = height;
    const bh = Math.max(2, Math.round((blockH * h) / srcH));
    probe.drawImage(src, 0, h - bh, w, bh, 0, 0, ID_BITS * 8, 8);
    const d = probe.getImageData(0, 0, ID_BITS * 8, 8).data;
    let id = 0;
    for (let b = 0; b < ID_BITS; b++) {
      const x = b * 8 + 4;
      const y = 4;
      const lum = d[(y * ID_BITS * 8 + x) * 4];
      if (lum > 128) id |= 1 << b;
    }
    return id;
  }

  return { canvas, draw, sentAt, readId, blockH };
}

// ─── Execução ────────────────────────────────────────────────────────────────

async function runBench(cfg: BenchConfig) {
  const hostSocket = new FakeSocket();
  const viewerSocket = new FakeSocket();
  const route = (from: string, to: FakeSocket, expected: string) => (event: string, payload: any) => {
    if (!event.startsWith('webrtc:') || payload?.targetId !== expected) return;
    const { targetId: _t, ...rest } = payload;
    setTimeout(() => to.fire(event, { senderId: from, ...rest }), 0);
  };
  hostSocket.onEmit = route('host', viewerSocket, 'viewer');
  viewerSocket.onEmit = route('viewer', hostSocket, 'host');

  const scene = makeScene(cfg.width, cfg.height);
  scene.draw();
  const stream = scene.canvas.captureStream(cfg.fps);
  const [track] = stream.getVideoTracks();
  track.contentHint = 'motion';

  const broadcaster = new WebRTCBroadcaster(
    hostSocket as any,
    { width: cfg.width, height: cfg.height, frameRate: cfg.fps, codec: cfg.codec, bitrate: cfg.bitrate, quality: cfg.quality } as any,
    { iceServers: [], privacyMode: false, maxViewers: 0 },
  );
  broadcaster.setLocalStream(new MediaStream([track]));
  const viewer = new WebRTCViewer(viewerSocket as any, 'host', []);
  const video = document.getElementById('remote') as HTMLVideoElement;
  video.width = 640;
  video.height = 360;
  viewer.onStream((s) => {
    video.srcObject = s;
    void video.play().catch(() => {});
  });
  hostSocket.fire('room:viewer-joined', { viewerId: 'viewer', viewerCount: 1 });

  // Gerador de frames: rAF (cadência do compositor, igual ao jogo → captura)
  let running = true;
  const drawIntervals: number[] = [];
  const drawCost: number[] = [];
  let lastDraw = 0;
  const loop = () => {
    if (!running) return;
    const now = performance.now();
    if (lastDraw) drawIntervals.push(now - lastDraw);
    lastDraw = now;
    const d0 = performance.now();
    scene.draw();
    drawCost.push(performance.now() - d0);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // Medição de apresentação + latência glass-to-glass via rVFC
  const probe = document.createElement('canvas');
  probe.width = ID_BITS * 8;
  probe.height = 8;
  const pctx = probe.getContext('2d', { willReadFrequently: true })!;
  const presentIntervals: number[] = [];
  const latencies: number[] = [];
  const rvfcProcessing: number[] = [];
  const rvfcReceiveToPresent: number[] = [];
  let lastPresent = 0;
  let presentedFrames = 0;
  let measuring = false;
  const onFrame = (_now: number, meta: any) => {
    if (!running) return;
    if (measuring) {
      presentedFrames++;
      if (lastPresent) presentIntervals.push(meta.presentationTime - lastPresent);
      lastPresent = meta.presentationTime;
      if (meta.processingDuration != null) rvfcProcessing.push(meta.processingDuration * 1000);
      if (meta.receiveTime != null) rvfcReceiveToPresent.push(meta.presentationTime - meta.receiveTime);
      if (cfg.measureLatency !== false && video.videoWidth && presentedFrames % 4 === 0) {
        try {
          const id = scene.readId(video, video.videoWidth, video.videoHeight, pctx);
          const t0 = scene.sentAt.get(id);
          if (t0 !== undefined) {
            const lat = performance.now() - t0;
            if (lat > 0 && lat < 2000) latencies.push(lat);
          }
        } catch {
          /* ignore */
        }
      }
    }
    (video as any).requestVideoFrameCallback(onFrame);
  };
  (video as any).requestVideoFrameCallback(onFrame);

  const jbOverride = (cfg as any).jbTarget;
  const hostPc = (): RTCPeerConnection | undefined => (broadcaster as any).peers.get('viewer')?.pc;
  const viewerPc = (): RTCPeerConnection | undefined => (viewer as any).pc;

  // Aguarda conexão
  const t0 = performance.now();
  while (performance.now() - t0 < 15000) {
    if (hostPc()?.connectionState === 'connected') break;
    await sleep(100);
  }
  if (hostPc()?.connectionState !== 'connected') {
    running = false;
    return { error: 'conexão WebRTC não estabeleceu em 15 s' };
  }

  const snap = async () => {
    const out: any = { t: performance.now(), out: {}, in: {}, pair: {} };
    (await hostPc()!.getStats()).forEach((s: any) => {
      if (s.type === 'outbound-rtp' && s.kind === 'video') out.out = { ...s };
      if (s.type === 'codec') (out.codecs ??= {})[s.id] = s.mimeType;
      if (s.type === 'candidate-pair' && s.nominated) out.pair = { ...s };
    });
    (await viewerPc()!.getStats()).forEach((s: any) => {
      if (s.type === 'inbound-rtp' && s.kind === 'video') out.in = { ...s };
    });
    return out;
  };

  const bweSeries: any[] = [];
  const sampler = setInterval(async () => {
    try {
      const s = await snap();
      const p = hostPc()!.getSenders().find((x) => x.track?.kind === 'video')!.getParameters();
      bweSeries.push({ t: Math.round((s.t - t0) / 1000), availKbps: Math.round((s.pair.availableOutgoingBitrate ?? 0) / 1000), res: s.out.frameWidth + "x" + s.out.frameHeight, fps: s.out.framesPerSecond, maxBitrateKbps: Math.round((p.encodings?.[0]?.maxBitrate ?? 0) / 1000), limit: s.out.qualityLimitationReason });
    } catch { /* */ }
  }, 2000);
  await sleep(cfg.warmupSec * 1000);
  const a = await snap();
  measuring = true;
  const drawStart = drawIntervals.length;
  await sleep(cfg.durationSec * 1000);
  measuring = false;
  const b = await snap();
  running = false;
  clearInterval(sampler);

  const dt = (b.t - a.t) / 1000;
  const o0 = a.out, o1 = b.out, i0 = a.in, i1 = b.in;
  const dEncoded = (o1.framesEncoded ?? 0) - (o0.framesEncoded ?? 0);
  const dSent = (o1.framesSent ?? 0) - (o0.framesSent ?? 0);
  const dDecoded = (i1.framesDecoded ?? 0) - (i0.framesDecoded ?? 0);
  const dDropped = (i1.framesDropped ?? 0) - (i0.framesDropped ?? 0);
  const dBytes = (o1.bytesSent ?? 0) - (o0.bytesSent ?? 0);
  const dEncT = (o1.totalEncodeTime ?? 0) - (o0.totalEncodeTime ?? 0);
  const dDecT = (i1.totalDecodeTime ?? 0) - (i0.totalDecodeTime ?? 0);
  const dJbD = (i1.jitterBufferDelay ?? 0) - (i0.jitterBufferDelay ?? 0);
  const dJbE = (i1.jitterBufferEmittedCount ?? 0) - (i0.jitterBufferEmittedCount ?? 0);
  const dInterSq = (i1.totalSquaredInterFrameDelay ?? 0) - (i0.totalSquaredInterFrameDelay ?? 0);
  const dInter = (i1.totalInterFrameDelay ?? 0) - (i0.totalInterFrameDelay ?? 0);
  const interN = Math.max(1, dDecoded - 1);
  const interMean = dInter / interN;
  const interStd = Math.sqrt(Math.max(0, dInterSq / interN - interMean * interMean));
  const di = drawIntervals.slice(drawStart);

  const r1 = (x: number) => Math.round(x * 10) / 10;
  const r2 = (x: number) => Math.round(x * 100) / 100;

  const result = {
    config: cfg,
    chrome: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0],
    negotiatedCodec: b.codecs?.[o1.codecId],
    decoderImplementation: i1.decoderImplementation,
    powerEfficientEncoder: o1.powerEfficientEncoder,
    powerEfficientDecoder: i1.powerEfficientDecoder,
    encodedResolution: `${o1.frameWidth}x${o1.frameHeight}`,
    scalabilityMode: o1.scalabilityMode,
    source: { drawFps: r1(1000 / mean(di)), drawIntervalP99Ms: r1(pct(di, 0.99)), drawIntervalMaxMs: r1(Math.max(...di)), drawCostMeanMs: r2(mean(drawCost)), drawCostP99Ms: r2(pct(drawCost, 0.99)) },
    sender: {
      encodedFps: r1(dEncoded / dt),
      sentFps: r1(dSent / dt),
      bitrateMbps: r2((dBytes * 8) / dt / 1e6),
      avgEncodeMs: r2((dEncT / Math.max(1, dEncoded)) * 1000),
      qualityLimitationReason: o1.qualityLimitationReason,
      qualityLimitationDurations: o1.qualityLimitationDurations,
      keyFramesEncoded: (o1.keyFramesEncoded ?? 0) - (o0.keyFramesEncoded ?? 0),
      nack: (o1.nackCount ?? 0) - (o0.nackCount ?? 0),
      pli: (o1.pliCount ?? 0) - (o0.pliCount ?? 0),
      retransmittedMbps: r2((((o1.retransmittedBytesSent ?? 0) - (o0.retransmittedBytesSent ?? 0)) * 8) / dt / 1e6),
      avgPacketSendDelayMs: r2(
        (((o1.totalPacketSendDelay ?? 0) - (o0.totalPacketSendDelay ?? 0)) /
          Math.max(1, (o1.packetsSent ?? 0) - (o0.packetsSent ?? 0))) * 1000,
      ),
    },
    receiver: {
      decodedFps: r1(dDecoded / dt),
      presentedFps: r1(presentedFrames / dt),
      framesDropped: dDropped,
      freezeCount: (i1.freezeCount ?? 0) - (i0.freezeCount ?? 0),
      freezeDurationSec: r2((i1.totalFreezesDuration ?? 0) - (i0.totalFreezesDuration ?? 0)),
      pauseCount: (i1.pauseCount ?? 0) - (i0.pauseCount ?? 0),
      avgDecodeMs: r2((dDecT / Math.max(1, dDecoded)) * 1000),
      avgJitterBufferMs: r2((dJbD / Math.max(1, dJbE)) * 1000),
      jitterMs: r1((i1.jitter ?? 0) * 1000),
      packetsLost: (i1.packetsLost ?? 0) - (i0.packetsLost ?? 0),
      interFrameDelayMeanMs: r2(interMean * 1000),
      interFrameDelayStdMs: r2(interStd * 1000),
    },
    presentationPacing: {
      intervalMeanMs: r2(mean(presentIntervals)),
      intervalP95Ms: r2(pct(presentIntervals, 0.95)),
      intervalP99Ms: r2(pct(presentIntervals, 0.99)),
      intervalMaxMs: r2(Math.max(0, ...presentIntervals)),
      over25msPct: r1((presentIntervals.filter((x) => x > 25).length / Math.max(1, presentIntervals.length)) * 100),
      over40msPct: r1((presentIntervals.filter((x) => x > 40).length / Math.max(1, presentIntervals.length)) * 100),
    },
    glassToGlassMs: {
      samples: latencies.length,
      mean: r1(mean(latencies)),
      p50: r1(pct(latencies, 0.5)),
      p95: r1(pct(latencies, 0.95)),
      p99: r1(pct(latencies, 0.99)),
      max: r1(Math.max(0, ...latencies)),
      note: 'loopback na mesma página: inclui encode+pacing+loopback+decode+compositor; NÃO inclui captura de tela do SO nem rede real',
    },
    rvfc: {
      avgProcessingMs: r2(mean(rvfcProcessing)),
      avgReceiveToPresentMs: r2(mean(rvfcReceiveToPresent)),
    },
    bweSeries,
    jbTargetReadback: (viewerPc()?.getReceivers().find((r) => r.track.kind === 'video') as any)?.jitterBufferTarget,
    playoutDelayHintReadback: (viewerPc()?.getReceivers().find((r) => r.track.kind === 'video') as any)?.playoutDelayHint,
    rttMs: r1((b.pair.currentRoundTripTime ?? 0) * 1000),
  };

  broadcaster.destroy();
  viewer.destroy();
  track.stop();
  return result;
}

window.__runBench = runBench;






