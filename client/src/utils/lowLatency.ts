/**
 * lowLatency.ts
 * Peças puras do modo "baixa latência (experimental)" do espectador: WebCodecs (VideoDecoder) + canvas
 * WebGL, no lugar do <video>. Ficam aqui, sem DOM, para serem testadas em Node; o worker as usa.
 */

export const LOW_LATENCY_STORAGE_KEY = 'kiara:lowLatency';

/**
 * VP9 perfil 0, nível 5.0, 8 bits. O nível alto evita que uma tela 1080p/1440p/4K "exceda" o nível
 * declarado; o decoder não costuma impor, mas não custa nada declarar folgado.
 */
export const VP9_DECODER_CODEC = 'vp09.00.50.08';

/** Se a fila do decoder passar disso, o espectador está atrasado: descarta e espera um keyframe */
export const MAX_DECODE_QUEUE = 8;

/** Sem sendKeyFrameRequest no transformer, só dá para esperar. Passou disso sem keyframe, volta ao <video> */
export const KEYFRAME_WAIT_MS = 5000;

/** Quantas medidas entram na média móvel de chegada→desenho */
export const LATENCY_WINDOW = 120;

/** Só o VP9 é decodificado aqui (combina com a E2EE); H.264/H.265 pedem description e Annex B */
export function isVp9Mime(mimeType: string | undefined | null): boolean {
  return typeof mimeType === 'string' && /^video\/vp9$/i.test(mimeType);
}

/** Recorte do que o navegador precisa oferecer (injetável nos testes) */
export interface LowLatencyEnv {
  RTCRtpScriptTransform?: unknown;
  Worker?: unknown;
  VideoDecoder?: unknown;
  OffscreenCanvas?: unknown;
  /** `HTMLCanvasElement.prototype`, para checar transferControlToOffscreen */
  canvasProto?: { transferControlToOffscreen?: unknown } | null;
}

/** O navegador consegue decodificar com WebCodecs e desenhar num OffscreenCanvas dentro de um worker? */
export function isLowLatencySupported(env?: LowLatencyEnv): boolean {
  const e: LowLatencyEnv = env ?? {
    RTCRtpScriptTransform: typeof RTCRtpScriptTransform !== 'undefined' ? RTCRtpScriptTransform : undefined,
    Worker: typeof Worker !== 'undefined' ? Worker : undefined,
    VideoDecoder: typeof VideoDecoder !== 'undefined' ? VideoDecoder : undefined,
    OffscreenCanvas: typeof OffscreenCanvas !== 'undefined' ? OffscreenCanvas : undefined,
    canvasProto: typeof HTMLCanvasElement !== 'undefined' ? HTMLCanvasElement.prototype : null,
  };
  return (
    e.RTCRtpScriptTransform !== undefined &&
    e.Worker !== undefined &&
    e.VideoDecoder !== undefined &&
    e.OffscreenCanvas !== undefined &&
    typeof e.canvasProto?.transferControlToOffscreen === 'function'
  );
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Lê a escolha salva ('1' ligado). Padrão: desligado, por ser experimental */
export function readStoredLowLatency(storage?: StorageLike): boolean {
  try {
    return (storage ?? localStorage).getItem(LOW_LATENCY_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Salva a escolha; falha em silêncio se o armazenamento estiver indisponível */
export function storeLowLatency(value: boolean, storage?: StorageLike): void {
  try {
    (storage ?? localStorage).setItem(LOW_LATENCY_STORAGE_KEY, value ? '1' : '0');
  } catch {
    // armazenamento indisponível: a escolha vale só para esta sessão
  }
}

/**
 * Porteiro de keyframe. O decoder só pode começar (e recomeçar, depois de um reset) num keyframe;
 * quadros delta antes dele são descartados.
 */
export class KeyframeGate {
  private waiting = true;

  /** true se o quadro deve ir ao decoder */
  accept(type: 'key' | 'delta' | 'empty' | string): boolean {
    if (type === 'key') this.waiting = false;
    return !this.waiting;
  }

  /** Depois de um erro ou de uma fila estourada: volta a esperar um keyframe */
  reset(): void {
    this.waiting = true;
  }

  get isWaiting(): boolean {
    return this.waiting;
  }
}

/** Média móvel simples sobre as últimas `size` medidas */
export class RollingAverage {
  private readonly values: number[] = [];

  constructor(private readonly size: number = LATENCY_WINDOW) {}

  push(value: number): void {
    this.values.push(value);
    if (this.values.length > this.size) this.values.shift();
  }

  get average(): number {
    if (this.values.length === 0) return 0;
    let sum = 0;
    for (const v of this.values) sum += v;
    return sum / this.values.length;
  }

  get count(): number {
    return this.values.length;
  }
}

/** Mensagens do worker para a página */
export type LowLatencyWorkerMessage =
  | { type: 'fallback'; reason: string }
  | { type: 'stats'; rendered: number; dropped: number; avgMs: number; width: number; height: number };

/** Texto de por que o modo voltou ao <video> (para o aviso ao usuário) */
export function fallbackReasonText(reason: string): string {
  if (reason.startsWith('codec:')) return 'o apresentador não está enviando VP9';
  if (reason === 'sem-keyframe') return 'o vídeo não chegou com um quadro-chave a tempo';
  if (reason === 'webgl') return 'o WebGL não está disponível';
  if (reason === 'config') return 'o navegador não decodifica VP9 por WebCodecs';
  return 'o decodificador falhou';
}
