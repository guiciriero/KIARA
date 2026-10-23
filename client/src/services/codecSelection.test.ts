import { describe, it, expect } from 'vitest';
import {
  detectHwCodecs,
  resolveVideoCodec,
  type CodecDetectionEnv,
  type CodecCapabilityLike,
  type MediaInfoResult,
} from './codecSelection';

const HW: MediaInfoResult = { supported: true, smooth: true, powerEfficient: true };
const SW: MediaInfoResult = { supported: true, smooth: true, powerEfficient: false };

const CODECS: CodecCapabilityLike[] = [
  { mimeType: 'video/VP8' },
  { mimeType: 'video/rtx' },
  { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=0;profile-level-id=42001f' },
  { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=1;profile-level-id=64001f' },
  { mimeType: 'video/H265', sdpFmtpLine: 'level-id=180;profile-id=1;tier-flag=0;tx-mode=SRST' },
  { mimeType: 'video/AV1', sdpFmtpLine: 'level-idx=5;profile=0;tier=0' },
];

function envWith(
  info: (contentType: string) => MediaInfoResult | Promise<MediaInfoResult>,
  seen: string[] = [],
): CodecDetectionEnv {
  return {
    getCodecs: () => CODECS,
    mediaInfo: async (_dir, cfg) => {
      seen.push(cfg.contentType);
      return info(cfg.contentType);
    },
  };
}

describe('detectHwCodecs', () => {
  it('retorna undefined sem a API (desconhecido, não "nenhum")', async () => {
    expect(await detectHwCodecs('decode', null)).toBeUndefined();
  });

  it('lista só codecs com supported && smooth && powerEfficient', async () => {
    const env = envWith((ct) => (/h265|h264/i.test(ct) ? HW : SW));
    expect(await detectHwCodecs('decode', env)).toEqual(['H265', 'H264']);
  });

  it('retorna [] quando mediu e nada é por hardware', async () => {
    expect(await detectHwCodecs('encode', envWith(() => SW))).toEqual([]);
  });

  it('H.264: avalia só packetization-mode=1', async () => {
    const seen: string[] = [];
    await detectHwCodecs('decode', envWith(() => HW, seen));
    const h264 = seen.filter((s) => /h264/i.test(s));
    expect(h264).toHaveLength(1);
    expect(h264[0]).toContain('packetization-mode=1');
  });

  it('não considera smooth=false nem supported=false como hardware', async () => {
    const env = envWith((ct) =>
      /h265/i.test(ct) ? { supported: true, smooth: false, powerEfficient: true } : { supported: false, smooth: true, powerEfficient: true },
    );
    expect(await detectHwCodecs('decode', env)).toEqual([]);
  });

  it('erro numa consulta vira "não é hardware" para aquele codec', async () => {
    const env: CodecDetectionEnv = {
      getCodecs: () => CODECS,
      mediaInfo: async (_d, cfg) => {
        if (/h265/i.test(cfg.contentType)) throw new Error('boom');
        return HW;
      },
    };
    expect(await detectHwCodecs('decode', env)).toEqual(['H264', 'AV1']);
  });

  it('timeout devolve undefined', async () => {
    const env = envWith(() => new Promise<MediaInfoResult>(() => {}));
    expect(await detectHwCodecs('decode', env, 20)).toBeUndefined();
  });
});

describe('resolveVideoCodec', () => {
  it('escolha manual é sempre respeitada', () => {
    expect(resolveVideoCodec('H264', { hwEncode: ['H265'], viewerHwDecode: ['H265'] }).codec).toBe('H264');
    expect(resolveVideoCodec('VP9', {}).codec).toBe('VP9');
    expect(resolveVideoCodec('H265', {}).codec).toBe('H265');
  });

  it('auto: H265 quando encode e decode por hardware', () => {
    expect(resolveVideoCodec('auto', { hwEncode: ['H265', 'H264'], viewerHwDecode: ['H265'] }).codec).toBe('H265');
  });

  it('auto: H264 se o espectador não decodifica HEVC por hardware', () => {
    const c = resolveVideoCodec('auto', { hwEncode: ['H265'], viewerHwDecode: ['H264'] });
    expect(c.codec).toBe('H264');
    expect(c.reason).toMatch(/espectador sem decode/);
  });

  it('auto: H264 se o espectador não informou (desconhecido)', () => {
    const c = resolveVideoCodec('auto', { hwEncode: ['H265'] });
    expect(c.codec).toBe('H264');
    expect(c.reason).toMatch(/não informou/);
  });

  it('auto: H264 se o apresentador não codifica HEVC por hardware', () => {
    expect(resolveVideoCodec('auto', { hwEncode: [], viewerHwDecode: ['H265'] }).codec).toBe('H264');
    expect(resolveVideoCodec('auto', { viewerHwDecode: ['H265'] }).codec).toBe('H264');
  });
});
