/**
 * Captura de vídeo nativa (desktop/Windows): textura de GPU do addon -> VideoFrame -> MediaStreamTrackGenerator.
 *
 * Sem copiar pixels pela CPU. O Chromium continua codificando (NVENC/AMF/QSV); só a captura troca.
 * Qualquer falha antes do primeiro frame vira erro e o chamador cai no getDisplayMedia.
 */

import type { NativeCaptureTexture, ScreenShareHostApi } from '@shared/index';

export const NATIVE_CAPTURE_STORAGE_KEY = 'kiara:nativeCapture';
/** Sem frame novo por este tempo (tela parada), repete o último para o encoder/GCC não pararem. */
export const IDLE_REPEAT_MS = 250;
export const FIRST_FRAME_TIMEOUT_MS = 3000;
/** Reinícios CONSECUTIVOS tolerados; o contador zera quando a captura volta a ficar estável. */
const MAX_RESTARTS = 5;
const RESTART_DELAY_MS = 500;
/** Com frames chegando por este tempo após um reinício, a captura é considerada recuperada. */
const STABLE_AFTER_MS = 5000;
// `start-failed`: o Windows ainda não liberou o DXGI logo após alt-tab/troca de modo de vídeo; tenta de novo.
// `unsupported-format`: na transição de tela cheia/alt-tab o DXGI pode entregar, por instantes, outro formato (HDR/10 bits).
const RESTARTABLE_REASONS = new Set([
  'access-lost',
  'resolution-changed',
  'acquire-failed',
  'start-failed',
  'unsupported-format',
]);

// Motivo pelo qual a captura nativa encerrou a faixa (diagnóstico mostrado ao usuário).
const endReasons = new WeakMap<MediaStreamTrack, string>();
export function getCaptureEndReason(track: MediaStreamTrack): string | undefined {
  return endReasons.get(track);
}

interface TrackGenerator extends MediaStreamTrack {
  writable: WritableStream<VideoFrame>;
}

export interface NativeCaptureDeps {
  createGenerator?: () => TrackGenerator;
}

// Tamanho real da captura por faixa: o webrtcService usa para calcular scaleResolutionDownBy (ex.: 1440p -> 1080p).
const captureSizes = new WeakMap<MediaStreamTrack, { width: number; height: number }>();
export function getCaptureSize(track: MediaStreamTrack): { width: number; height: number } | undefined {
  return captureSizes.get(track);
}

/** Interruptor: `localStorage['kiara:nativeCapture'] = '0'` desliga a captura nativa. */
export function isNativeCaptureEnabled(): boolean {
  try {
    return localStorage.getItem(NATIVE_CAPTURE_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

function defaultGenerator(): TrackGenerator | null {
  const Ctor = (globalThis as unknown as { MediaStreamTrackGenerator?: new (init: { kind: 'video' }) => TrackGenerator })
    .MediaStreamTrackGenerator;
  return Ctor ? new Ctor({ kind: 'video' }) : null;
}

export async function canUseNativeCapture(
  host: ScreenShareHostApi | undefined,
  sourceId: string | null | undefined,
  deps: NativeCaptureDeps = {},
): Promise<boolean> {
  if (!host?.nativeCapture || !isNativeCaptureEnabled()) return false;
  if (sourceId && !sourceId.startsWith('screen:')) return false; // janelas: só getDisplayMedia
  if (!deps.createGenerator && !defaultGenerator) return false;
  if (!deps.createGenerator && typeof (globalThis as { MediaStreamTrackGenerator?: unknown }).MediaStreamTrackGenerator !== 'function') {
    return false;
  }
  try {
    return await host.nativeCapture.isAvailable();
  } catch {
    return false;
  }
}

let currentSession: symbol | null = null;

/**
 * Inicia a captura nativa e devolve a faixa de vídeo. Rejeita se não chegar um primeiro frame válido
 * (monitor rotacionado/HDR, addon ausente, GPU sem suporte...), para o chamador usar o fallback.
 */
export async function startNativeVideoTrack(
  host: ScreenShareHostApi,
  options: { fps: number; sourceId?: string | null },
  deps: NativeCaptureDeps = {},
): Promise<MediaStreamTrack> {
  const native = host.nativeCapture;
  if (!native) throw new Error('Captura nativa indisponível.');
  const gen = deps.createGenerator ? deps.createGenerator() : defaultGenerator();
  if (!gen) throw new Error('MediaStreamTrackGenerator indisponível.');

  const writer = gen.writable.getWriter();
  const session = Symbol('native-capture');
  currentSession = session;

  let closed = false;
  let writing = false;
  let last: VideoFrame | null = null;
  let lastWriteAt = Date.now();
  let restarts = 0;
  let stableSince: number | null = null;
  let gotFirst = false;
  let idleTimer: ReturnType<typeof setInterval> | null = null;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let rejectFirst: ((e: Error) => void) | null = null;
  let resolveFirst: (() => void) | null = null;

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    if (idleTimer) clearInterval(idleTimer);
    if (restartTimer) clearTimeout(restartTimer);
    last?.close();
    last = null;
    // Só para o addon se esta ainda é a sessão ativa (trocar de tela inicia a nova antes de parar a antiga).
    if (currentSession === session) {
      currentSession = null;
      void native.stop().catch(() => undefined);
    }
    void writer.close().catch(() => undefined);
  };

  const endTrack = (reason = 'unknown'): void => {
    if (closed) return;
    endReasons.set(gen, reason);
    console.warn(`[KIARA] Captura nativa encerrada (${reason}).`);
    cleanup();
    gen.dispatchEvent(new Event('ended'));
  };

  const emit = async (frame: VideoFrame): Promise<void> => {
    writing = true;
    try {
      await writer.write(frame);
      lastWriteAt = Date.now();
    } catch {
      // faixa parada: o frame é descartado
    } finally {
      writing = false;
      frame.close();
    }
  };

  const onTexture = (texture: NativeCaptureTexture): void => {
    if (closed) {
      texture.release();
      return;
    }
    let frame: VideoFrame;
    try {
      frame = texture.getVideoFrame() as VideoFrame;
    } catch {
      texture.release();
      return;
    }
    texture.release();
    captureSizes.set(gen, { width: frame.displayWidth, height: frame.displayHeight });
    if (restarts > 0) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= STABLE_AFTER_MS) {
        restarts = 0;
        stableSince = null;
      }
    }
    if (!gotFirst) {
      gotFirst = true;
      resolveFirst?.();
    }
    if (writing) {
      frame.close(); // pipeline atrasado: descarta em vez de acumular latência
      return;
    }
    last?.close();
    last = frame.clone();
    void emit(frame);
  };

  const begin = (): Promise<void> =>
    native.start({ fps: options.fps, sourceId: options.sourceId ?? null }, onTexture, onEnded);

  function onEnded(reason: string): void {
    if (closed) return;
    if (!gotFirst) {
      rejectFirst?.(new Error(`Captura nativa encerrou antes do primeiro frame (${reason}).`));
      return;
    }
    if (RESTARTABLE_REASONS.has(reason) && restarts < MAX_RESTARTS) {
      restarts += 1;
      stableSince = null;
      restartTimer = setTimeout(() => {
        if (closed) return;
        begin().catch(() => onEnded('start-failed'));
      }, RESTART_DELAY_MS);
      return;
    }
    endTrack(reason);
  }

  // Tela parada: sem frames novos o encoder ficaria ocioso e o espectador veria congelamento.
  idleTimer = setInterval(() => {
    if (closed || writing || !last || Date.now() - lastWriteAt < IDLE_REPEAT_MS) return;
    void emit(last.clone());
  }, IDLE_REPEAT_MS / 2);

  // `stop()` da faixa (ex.: stopStream) também encerra o addon.
  const originalStop = gen.stop.bind(gen);
  gen.stop = () => {
    cleanup();
    originalStop();
  };

  const firstFrame = new Promise<void>((resolve, reject) => {
    resolveFirst = resolve;
    rejectFirst = reject;
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await begin();
    await Promise.race([
      firstFrame,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Captura nativa não entregou frames.')), FIRST_FRAME_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    cleanup();
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
  return gen;
}
