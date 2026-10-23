/**
 * sdpTuning.ts
 *
 * Utilitários de otimização de SDP (Session Description Protocol) para jogos
 * de alta movimentação (FPS) e áudio de alta fidelidade no KIARA.
 *
 * Aplica:
 * - Bitrate Constante (CBR) e limites mínimos de banda para impedir que o
 *   estimador de congestionamento (GCC) derrube o framerate em cenas dinâmicas.
 * - Opus de alta fidelidade: Estéreo 48 kHz, 192 kbps, CBR e FEC ativado.
 * - Priorização de percurso direto de quadros.
 */

export interface SdpTuningOptions {
  targetBitrateKbps?: number;
  minBitrateKbps?: number;
  maxBitrateKbps?: number;
  audioBitrateKbps?: number;
}

const DEFAULT_OPTIONS: Required<SdpTuningOptions> = {
  targetBitrateKbps: 6000,
  minBitrateKbps: 3000,
  maxBitrateKbps: 12000,
  audioBitrateKbps: 192,
};

/**
 * Ajusta parâmetros do codec de áudio Opus no SDP para garantir reprodução
 * em estéreo de alta resolução (48 kHz) com taxa constante e correção de erros.
 */
export function tuneOpusAudioSdp(sdp: string, audioBitrateKbps = 192): string {
  const maxAverageBitrate = audioBitrateKbps * 1000;
  const opusFmtpRegex = /(a=fmtp:\d+ )((?:(?!stereo=).)*)(?:\r?\n|$)/gi;

  return sdp.replace(opusFmtpRegex, (match, prefix, rest) => {
    // Só aplica na linha do Opus
    if (!match.includes('opus') && !match.toLowerCase().includes('minptime') && !match.toLowerCase().includes('useinbandfec') && !rest.includes('111')) {
      // Se não tem marcadores de Opus, confere se é payload Opus (geralmente 111)
      if (!prefix.includes('111')) return match;
    }

    const cleanRest = rest.trim();
    const separator = cleanRest.length > 0 && !cleanRest.endsWith(';') ? ';' : '';
    const params = [
      'stereo=1',
      'sprop-stereo=1',
      `maxaveragebitrate=${maxAverageBitrate}`,
      'cbr=1',
      'useinbandfec=1',
    ];

    // Mantém CRLF
    return `${prefix}${cleanRest}${separator}${params.join(';')}\r\n`;
  });
}

/**
 * Injeta parâmetros de taxa de bits e limites do Google Congestion Control no SDP de vídeo.
 * Evita que movimentos rápidos na tela sejam interpretados erroneamente como queda de rede.
 */
export function tuneVideoBitrateSdp(
  sdp: string,
  options: SdpTuningOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const targetTiasBps = opts.targetBitrateKbps * 1000;

  let result = sdp;

  // 1. Remove limites legados b=AS / b=TIAS na seção de vídeo
  result = result.replace(/b=AS:\d+\r?\n/g, '');
  result = result.replace(/b=TIAS:\d+\r?\n/g, '');

  // 2. Injeta b=TIAS e b=AS logo após a linha m=video
  result = result.replace(
    /(m=video \d+ [A-Z0-9/]+ [0-9 ]+)\r?\n/g,
    `$1\r\nb=TIAS:${targetTiasBps}\r\nb=AS:${opts.targetBitrateKbps}\r\n`
  );

  // 3. Adiciona parâmetros x-google-* para os codecs de vídeo principais
  const videoFmtpRegex = /(a=fmtp:\d+ [^\r\n]+)\r?\n/g;
  result = result.replace(videoFmtpRegex, (match, fmtpLine) => {
    // Evita duplicar se já houver
    if (fmtpLine.includes('x-google-min-bitrate')) return match;

    const additions = [
      `x-google-min-bitrate=${opts.minBitrateKbps}`,
      `x-google-max-bitrate=${opts.maxBitrateKbps}`,
      `x-google-start-bitrate=${opts.targetBitrateKbps}`,
    ].join(';');

    const sep = fmtpLine.endsWith(';') ? '' : ';';
    return `${fmtpLine}${sep}${additions}\r\n`;
  });

  return result;
}

/**
 * Otimização completa do SDP (Áudio + Vídeo) para jogos de FPS e baixa latência.
 */
export function optimizeSdpForGaming(
  sdp: string,
  options: SdpTuningOptions = {},
): string {
  if (!sdp || typeof sdp !== 'string') return sdp;

  const audioTuned = tuneOpusAudioSdp(sdp, options.audioBitrateKbps);
  return tuneVideoBitrateSdp(audioTuned, options);
}
