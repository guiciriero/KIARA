import { describe, it, expect } from 'vitest';
import { optimizeSdpForGaming, tuneOpusAudioSdp, tuneVideoBitrateSdp, mirrorVideoBitrateHints } from './sdpTuning';

describe('sdpTuning', () => {
  const sampleSdp = [
    'v=0',
    'o=- 123456 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=10',
    'm=video 9 UDP/TLS/RTP/SAVPF 96',
    'c=IN IP4 0.0.0.0',
    'a=rtpmap:96 H264/90000',
    'a=fmtp:96 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=64002a',
    '',
  ].join('\r\n');

  it('injeta parâmetros estéreo e alta fidelidade no Opus', () => {
    const tuned = tuneOpusAudioSdp(sampleSdp, 192);
    expect(tuned).toContain('stereo=1');
    expect(tuned).toContain('sprop-stereo=1');
    expect(tuned).toContain('maxaveragebitrate=192000');
    expect(tuned).toContain('cbr=1');
    expect(tuned).toContain('useinbandfec=1');
  });

  it('não aplica parâmetros Opus em SDPs sem a=rtpmap Opus', () => {
    const noOpusSdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 96',
      'a=rtpmap:96 PCMU/8000',
      'a=fmtp:96 something',
      '',
    ].join('\r\n');
    const tuned = tuneOpusAudioSdp(noOpusSdp, 192);
    expect(tuned).toBe(noOpusSdp); // SDP intocado
    expect(tuned).not.toContain('stereo=1');
  });

  it('detecta corretamente Opus em payload type não-padrão (ex.: 112 em vez de 111)', () => {
    const altPtSdp = [
      'v=0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 112',
      'a=rtpmap:112 opus/48000/2',
      'a=fmtp:112 minptime=10',
      '',
    ].join('\r\n');
    const tuned = tuneOpusAudioSdp(altPtSdp, 192);
    expect(tuned).toContain('stereo=1');
    expect(tuned).toContain('maxaveragebitrate=192000');
  });

  it('não duplica parâmetros ao aplicar tuneOpusAudioSdp duas vezes', () => {
    const once = tuneOpusAudioSdp(sampleSdp, 192);
    const twice = tuneOpusAudioSdp(once, 192);
    // O resultado de aplicar duas vezes deve ser igual ao de aplicar uma vez
    expect(twice).toBe(once);
  });

  it('injeta limites de taxa de bits e CBR no SDP de vídeo', () => {
    const tuned = tuneVideoBitrateSdp(sampleSdp, {
      targetBitrateKbps: 8000,
      minBitrateKbps: 4000,
      maxBitrateKbps: 12000,
    });
    expect(tuned).toContain('b=TIAS:8000000');
    expect(tuned).toContain('b=AS:8000');
    expect(tuned).toContain('x-google-min-bitrate=4000');
    expect(tuned).toContain('x-google-max-bitrate=12000');
    expect(tuned).toContain('x-google-start-bitrate=8000');
  });

  it('não aplica x-google-* na seção de áudio', () => {
    const tuned = tuneVideoBitrateSdp(sampleSdp, { targetBitrateKbps: 8000 });
    // A linha fmtp do áudio (payload 111) não deve ter x-google-*
    const audioFmtpLine = tuned.split('\r\n').find((l) => l.startsWith('a=fmtp:111'));
    expect(audioFmtpLine).toBeDefined();
    expect(audioFmtpLine).not.toContain('x-google-min-bitrate');
  });

  it('não duplica x-google-* ao aplicar tuneVideoBitrateSdp duas vezes', () => {
    const once = tuneVideoBitrateSdp(sampleSdp, { targetBitrateKbps: 8000 });
    const twice = tuneVideoBitrateSdp(once, { targetBitrateKbps: 8000 });
    const countMin = (twice.match(/x-google-min-bitrate/g) ?? []).length;
    expect(countMin).toBe(1); // deve aparecer apenas uma vez
  });

  it('executa otimização combinada completa sem quebrar SDP', () => {
    const result = optimizeSdpForGaming(sampleSdp, {
      targetBitrateKbps: 6000,
    });
    expect(result).toContain('stereo=1');
    expect(result).toContain('b=TIAS:6000000');
  });

  it('trata SDPs vazios ou inválidos com resiliência', () => {
    expect(optimizeSdpForGaming('')).toBe('');
    // @ts-expect-error testando entrada nula
    expect(optimizeSdpForGaming(null)).toBeNull();
  });

  describe('mirrorVideoBitrateHints', () => {
    const offer = tuneVideoBitrateSdp(sampleSdp, {
      targetBitrateKbps: 15000,
      minBitrateKbps: 5625,
      maxBitrateKbps: 22500,
    });
    const answer = sampleSdp; // answer "crua" do espectador

    it('copia min/max/start da offer para o fmtp de vídeo da answer', () => {
      const out = mirrorVideoBitrateHints(offer, answer);
      const fmtp = out.split('\r\n').find((l) => l.startsWith('a=fmtp:96'))!;
      expect(fmtp).toContain('x-google-min-bitrate=5625');
      expect(fmtp).toContain('x-google-max-bitrate=22500');
      expect(fmtp).toContain('x-google-start-bitrate=15000');
    });

    it('não toca na seção de áudio', () => {
      const out = mirrorVideoBitrateHints(offer, answer);
      const audioFmtp = out.split('\r\n').find((l) => l.startsWith('a=fmtp:111'))!;
      expect(audioFmtp).toBe('a=fmtp:111 minptime=10');
    });

    it('é idempotente e não duplica', () => {
      const once = mirrorVideoBitrateHints(offer, answer);
      const twice = mirrorVideoBitrateHints(offer, once);
      expect((twice.match(/x-google-min-bitrate/g) ?? []).length).toBe(1);
    });

    it('devolve a answer intacta quando a offer não tem dicas', () => {
      expect(mirrorVideoBitrateHints(sampleSdp, answer)).toBe(answer);
      expect(mirrorVideoBitrateHints('', answer)).toBe(answer);
    });
  });});

