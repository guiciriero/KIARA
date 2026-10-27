import { describe, it, expect } from 'vitest';
import {
  KeyframeGate,
  RollingAverage,
  LOW_LATENCY_STORAGE_KEY,
  fallbackReasonText,
  isLowLatencySupported,
  isVp9Mime,
  readStoredLowLatency,
  storeLowLatency,
} from './lowLatency';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

describe('isVp9Mime', () => {
  it('aceita só VP9, sem diferenciar maiúsculas', () => {
    expect(isVp9Mime('video/VP9')).toBe(true);
    expect(isVp9Mime('video/vp9')).toBe(true);
    expect(isVp9Mime('video/VP8')).toBe(false);
    expect(isVp9Mime('video/H264')).toBe(false);
    expect(isVp9Mime('video/AV1')).toBe(false);
    expect(isVp9Mime(undefined)).toBe(false);
  });
});

describe('isLowLatencySupported', () => {
  const full = {
    RTCRtpScriptTransform: class {},
    Worker: class {},
    VideoDecoder: class {},
    OffscreenCanvas: class {},
    canvasProto: { transferControlToOffscreen: () => undefined },
  };

  it('exige todas as peças', () => {
    expect(isLowLatencySupported(full)).toBe(true);
    for (const key of Object.keys(full) as (keyof typeof full)[]) {
      expect(isLowLatencySupported({ ...full, [key]: undefined })).toBe(false);
    }
    expect(isLowLatencySupported({ ...full, canvasProto: {} })).toBe(false);
    expect(isLowLatencySupported({ ...full, canvasProto: null })).toBe(false);
  });

  it('no Node (sem nenhuma dessas APIs) não há suporte', () => {
    expect(isLowLatencySupported()).toBe(false);
  });
});

describe('preferência salva', () => {
  it('padrão é desligado; só "1" liga', () => {
    expect(readStoredLowLatency(memoryStorage())).toBe(false);
    expect(readStoredLowLatency(memoryStorage({ [LOW_LATENCY_STORAGE_KEY]: '0' }))).toBe(false);
    expect(readStoredLowLatency(memoryStorage({ [LOW_LATENCY_STORAGE_KEY]: 'sim' }))).toBe(false);
    expect(readStoredLowLatency(memoryStorage({ [LOW_LATENCY_STORAGE_KEY]: '1' }))).toBe(true);
  });

  it('grava e relê', () => {
    const storage = memoryStorage();
    storeLowLatency(true, storage);
    expect(readStoredLowLatency(storage)).toBe(true);
    storeLowLatency(false, storage);
    expect(readStoredLowLatency(storage)).toBe(false);
  });

  it('armazenamento que lança não derruba', () => {
    const broken = {
      getItem: () => {
        throw new Error('negado');
      },
      setItem: () => {
        throw new Error('negado');
      },
    };
    expect(readStoredLowLatency(broken)).toBe(false);
    expect(() => storeLowLatency(true, broken)).not.toThrow();
  });
});

describe('KeyframeGate', () => {
  it('descarta delta até o primeiro keyframe e depois aceita tudo', () => {
    const gate = new KeyframeGate();
    expect(gate.isWaiting).toBe(true);
    expect(gate.accept('delta')).toBe(false);
    expect(gate.accept('delta')).toBe(false);
    expect(gate.accept('key')).toBe(true);
    expect(gate.isWaiting).toBe(false);
    expect(gate.accept('delta')).toBe(true);
  });

  it('reset volta a esperar um keyframe', () => {
    const gate = new KeyframeGate();
    gate.accept('key');
    gate.reset();
    expect(gate.accept('delta')).toBe(false);
    expect(gate.accept('key')).toBe(true);
  });
});

describe('RollingAverage', () => {
  it('média vazia é 0', () => {
    expect(new RollingAverage().average).toBe(0);
  });

  it('mantém só as últimas N medidas', () => {
    const avg = new RollingAverage(3);
    [10, 20, 30, 40].forEach((v) => avg.push(v));
    expect(avg.count).toBe(3);
    expect(avg.average).toBe(30);
  });
});

describe('fallbackReasonText', () => {
  it('traduz os motivos conhecidos e cobre o desconhecido', () => {
    expect(fallbackReasonText('codec:video/H264')).toMatch(/VP9/);
    expect(fallbackReasonText('sem-keyframe')).toMatch(/quadro-chave/);
    expect(fallbackReasonText('webgl')).toMatch(/WebGL/);
    expect(fallbackReasonText('config')).toMatch(/WebCodecs/);
    expect(fallbackReasonText('decoder:boom')).toMatch(/falhou/);
  });
});
