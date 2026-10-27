/**
 * lowLatency.worker.ts
 * Worker do modo "baixa latência (experimental)": recebe os quadros VP9 já codificados pelo
 * RTCRtpScriptTransform, decifra (sala E2EE), decodifica com WebCodecs (VideoDecoder) e desenha num
 * OffscreenCanvas com WebGL. Em modo normal os quadros NÃO voltam ao `writable`, então o <video> não
 * decodifica nada (nenhum trabalho em dobro). Se algo falhar, passa a repassar os quadros e o <video>
 * assume a partir do próximo keyframe.
 *
 * É um arquivo real, carregado por `new Worker(new URL(...), { type: 'module' })` (CSP `worker-src 'self'`).
 */

import { FrameCipher, type EncodedFrameLike } from '../utils/e2eeCrypto';
import {
  KEYFRAME_WAIT_MS,
  KeyframeGate,
  MAX_DECODE_QUEUE,
  RollingAverage,
  VP9_DECODER_CODEC,
  isVp9Mime,
  type LowLatencyWorkerMessage,
} from '../utils/lowLatency';

interface VideoFrameLike extends EncodedFrameLike {
  type: 'key' | 'delta' | 'empty';
  timestamp: number;
  getMetadata(): { mimeType?: string; receiveTime?: number };
}

interface TransformerLike {
  readable: ReadableStream<VideoFrameLike>;
  writable: WritableStream<VideoFrameLike>;
  options: { key?: CryptoKey };
}

/** `DedicatedWorkerGlobalScope` não está nos tipos DOM usados pelo projeto */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent) => void) | null;
  onrtctransform: ((event: { transformer: TransformerLike }) => void) | null;
  postMessage(message: LowLatencyWorkerMessage): void;
};

const MAX_CONSECUTIVE_DECODER_ERRORS = 3;
const STATS_INTERVAL_MS = 500;

let canvas: OffscreenCanvas | null = null;
let gl: WebGLRenderingContext | null = null;
let decoder: VideoDecoder | null = null;
const gate = new KeyframeGate();
const latency = new RollingAverage();
/** Instante em que o quadro chegou (`receiveTime` do pacote, base do worker) por timestamp, para medir chegada → desenho */
const arrivals = new Map<number, number>();

/** true = repassa os quadros ao <video> (fallback, ou codec que não é VP9) */
let passthrough = false;
let fallbackSent = false;
let rendered = 0;
let dropped = 0;
let consecutiveErrors = 0;
let lastStatsAt = 0;
let frameWidth = 0;
let frameHeight = 0;
/** Desde quando o decoder espera um keyframe (0 = não está esperando) */
let waitingSince = 0;

function send(message: LowLatencyWorkerMessage): void {
  scope.postMessage(message);
}

/** Passa a repassar os quadros e avisa a página (uma vez) */
function fallback(reason: string): void {
  passthrough = true;
  closeDecoder();
  if (fallbackSent) return;
  fallbackSent = true;
  send({ type: 'fallback', reason });
}

function postStats(force = false): void {
  const now = performance.now();
  if (!force && now - lastStatsAt < STATS_INTERVAL_MS) return;
  lastStatsAt = now;
  send({ type: 'stats', rendered, dropped, avgMs: latency.average, width: frameWidth, height: frameHeight });
}

// ── WebGL: um quadrilátero com a textura do quadro ───────────────────────────
const VERTEX_SHADER = `
attribute vec2 pos;
varying vec2 uv;
void main() {
  uv = vec2((pos.x + 1.0) * 0.5, 1.0 - (pos.y + 1.0) * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision mediump float;
varying vec2 uv;
uniform sampler2D tex;
void main() { gl_FragColor = texture2D(tex, uv); }`;

function compile(context: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = context.createShader(type);
  if (!shader) throw new Error('createShader');
  context.shaderSource(shader, source);
  context.compileShader(shader);
  if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error('shader');
  return shader;
}

function initGl(target: OffscreenCanvas): WebGLRenderingContext | null {
  try {
    const context = target.getContext('webgl', { alpha: false, antialias: false, desynchronized: true });
    if (!context) return null;
    const program = context.createProgram();
    context.attachShader(program, compile(context, context.VERTEX_SHADER, VERTEX_SHADER));
    context.attachShader(program, compile(context, context.FRAGMENT_SHADER, FRAGMENT_SHADER));
    context.linkProgram(program);
    if (!context.getProgramParameter(program, context.LINK_STATUS)) return null;
    context.useProgram(program);

    const buffer = context.createBuffer();
    context.bindBuffer(context.ARRAY_BUFFER, buffer);
    context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW);
    const loc = context.getAttribLocation(program, 'pos');
    context.enableVertexAttribArray(loc);
    context.vertexAttribPointer(loc, 2, context.FLOAT, false, 0, 0);

    const texture = context.createTexture();
    context.bindTexture(context.TEXTURE_2D, texture);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR);
    context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR);
    return context;
  } catch {
    return null;
  }
}

function draw(frame: VideoFrame): void {
  if (!canvas || !gl) return;
  if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
    canvas.width = frame.displayWidth;
    canvas.height = frame.displayHeight;
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  frameWidth = frame.displayWidth;
  frameHeight = frame.displayHeight;
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ── Decoder ──────────────────────────────────────────────────────────────────
function onOutput(frame: VideoFrame): void {
  try {
    draw(frame);
    const arrived = arrivals.get(frame.timestamp);
    if (arrived !== undefined) {
      latency.push(performance.now() - arrived);
      arrivals.delete(frame.timestamp);
    }
    rendered += 1;
    consecutiveErrors = 0;
    postStats(rendered === 1);
  } finally {
    frame.close();
  }
}

function closeDecoder(): void {
  const current = decoder;
  decoder = null;
  arrivals.clear();
  if (current && current.state !== 'closed') {
    try {
      current.close();
    } catch {
      // já fechado
    }
  }
}

function openDecoder(): boolean {
  const next = new VideoDecoder({
    output: onOutput,
    error: (err) => {
      // Decoder fechado pelo erro: recria e espera um novo keyframe. Erros em série = desiste.
      consecutiveErrors += 1;
      decoder = null;
      arrivals.clear();
      gate.reset();
      waitingSince = performance.now();
      if (consecutiveErrors >= MAX_CONSECUTIVE_DECODER_ERRORS) fallback(`decoder:${String(err)}`);
    },
  });
  try {
    next.configure({ codec: VP9_DECODER_CODEC, optimizeForLatency: true });
  } catch {
    next.close();
    return false;
  }
  decoder = next;
  return true;
}

/** Fila estourada: o espectador está atrasado. Recomeça no próximo keyframe em vez de acumular atraso */
function resetDecoder(): void {
  closeDecoder();
  gate.reset();
  waitingSince = performance.now();
}

function decodeFrame(frame: VideoFrameLike): void {
  if (waitingSince === 0) waitingSince = performance.now();
  if (!gate.accept(frame.type)) {
    dropped += 1;
    // Sem sendKeyFrameRequest no transformer só dá para esperar; passou do limite, o <video> assume
    if (performance.now() - waitingSince > KEYFRAME_WAIT_MS) fallback('sem-keyframe');
    return;
  }
  waitingSince = 0;
  if (!decoder) {
    if (!openDecoder()) {
      fallback('config');
      return;
    }
  }
  if (decoder && decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
    dropped += 1;
    resetDecoder();
    return;
  }
  arrivals.set(frame.timestamp, frame.getMetadata().receiveTime ?? performance.now());
  decoder?.decode(new EncodedVideoChunk({ type: frame.type === 'key' ? 'key' : 'delta', timestamp: frame.timestamp, data: frame.data }));
}

// ── Mensagens e transformação ────────────────────────────────────────────────
scope.onmessage = (event) => {
  const data = event.data as { type?: string; canvas?: OffscreenCanvas };
  if (data.type !== 'init' || !data.canvas) return;
  canvas = data.canvas;
  gl = initGl(canvas);
  if (!gl) fallback('webgl');
};

scope.onrtctransform = (event) => {
  const { readable, writable, options } = event.transformer;
  const cipher = options.key ? new FrameCipher(options.key) : null;
  let checkedCodec = false;

  void readable
    .pipeThrough(
      new TransformStream<VideoFrameLike, VideoFrameLike>({
        async transform(frame, controller) {
          // Sala E2EE: quadro que não autentica é descartado, nunca repassado nem desenhado
          if (cipher) {
            try {
              frame.data = await cipher.decrypt(frame.data);
            } catch (err) {
              console.warn('[KIARA:lowlatency] Quadro descartado (decrypt):', err);
              return;
            }
          }

          if (!checkedCodec) {
            checkedCodec = true;
            const mime = frame.getMetadata().mimeType;
            if (!isVp9Mime(mime)) fallback(`codec:${mime ?? 'desconhecido'}`);
          }

          if (passthrough) {
            controller.enqueue(frame);
            return;
          }
          decodeFrame(frame);
          postStats();
        },
      }),
    )
    .pipeTo(writable);
};
