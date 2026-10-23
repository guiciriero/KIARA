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
  targetBitrateKbps: 8000,
  minBitrateKbps: 3000,
  maxBitrateKbps: 16000,
  audioBitrateKbps: 192,
};

/**
 * Extrai os payload types associados ao codec Opus a partir das linhas a=rtpmap.
 * É mais confiável do que assumir que Opus sempre usa o payload type 111.
 *
 * Exemplo: "a=rtpmap:111 opus/48000/2" → "111"
 */
function extractOpusPayloadTypes(sdp: string): Set<string> {
  const result = new Set<string>();
  const rtpmapRegex = /a=rtpmap:(\d+) opus\/\d+/gi;
  let m: RegExpExecArray | null;
  while ((m = rtpmapRegex.exec(sdp)) !== null) {
    result.add(m[1]);
  }
  return result;
}

/**
 * Ajusta parâmetros do codec de áudio Opus no SDP para garantir reprodução
 * em estéreo de alta resolução (48 kHz) com taxa constante e correção de erros.
 *
 * A detecção do payload type Opus é feita via a=rtpmap, evitando dependência
 * de valores hardcoded (p. ex. 111 nem sempre é Opus em todos os navegadores).
 */
export function tuneOpusAudioSdp(sdp: string, audioBitrateKbps = 192): string {
  const maxAverageBitrate = audioBitrateKbps * 1000;
  const opusPayloadTypes = extractOpusPayloadTypes(sdp);

  // Se não encontrou nenhum payload Opus, devolve o SDP intocado
  if (opusPayloadTypes.size === 0) return sdp;

  const fmtpRegex = /(a=fmtp:(\d+) )([^\r\n]*)(\r?\n)/g;

  return sdp.replace(fmtpRegex, (match, prefix, pt, rest, lineEnd) => {
    // Aplica somente nas linhas fmtp do Opus
    if (!opusPayloadTypes.has(pt)) return match;

    // Remove parâmetros que serão sobrescritos para evitar duplicatas
    const paramsToRemove = /\b(stereo|sprop-stereo|maxaveragebitrate|cbr|useinbandfec)=[^;]*/gi;
    const cleanRest = rest.replace(paramsToRemove, '').replace(/;;+/g, ';').replace(/^;|;$/g, '');

    const params = [
      'stereo=1',
      'sprop-stereo=1',
      `maxaveragebitrate=${maxAverageBitrate}`,
      'cbr=1',
      'useinbandfec=1',
    ];

    const base = cleanRest.length > 0 ? `${cleanRest};` : '';
    return `${prefix}${base}${params.join(';')}${lineEnd}`;
  });
}

/**
 * Injeta parâmetros de taxa de bits e limites do Google Congestion Control no SDP de vídeo.
 * Evita que movimentos rápidos na tela sejam interpretados erroneamente como queda de rede.
 *
 * Restringe a modificação das linhas a=fmtp à seção de vídeo do SDP para não
 * afetar inadvertidamente codecs de áudio que também possuem a=fmtp.
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

  // 3. Adiciona parâmetros x-google-* somente na seção de vídeo.
  //    Para identificar a seção de vídeo, splitamos o SDP em seções m= e
  //    aplicamos a transformação apenas naquela que começa com "m=video".
  const sections = result.split(/(?=m=)/);
  result = sections.map((section) => {
    if (!section.startsWith('m=video')) return section;

    return section.replace(/(a=fmtp:\d+ [^\r\n]+)(\r?\n)/g, (match, fmtpLine, lineEnd) => {
      // Evita duplicar se já houver
      if (fmtpLine.includes('x-google-min-bitrate')) return match;

      // Não aplica em linhas de áudio que possam ter ficado na seção (não esperado, mas seguro)
      if (fmtpLine.toLowerCase().includes('minptime') || fmtpLine.toLowerCase().includes('opus')) {
        return match;
      }

      const additions = [
        `x-google-min-bitrate=${opts.minBitrateKbps}`,
        `x-google-max-bitrate=${opts.maxBitrateKbps}`,
        `x-google-start-bitrate=${opts.targetBitrateKbps}`,
      ].join(';');

      const sep = fmtpLine.endsWith(';') ? '' : ';';
      return `${fmtpLine}${sep}${additions}${lineEnd}`;
    });
  }).join('');

  return result;
}

/**
 * Espelha na ANSWER as dicas x-google-{max,start}-bitrate presentes na OFFER (seção de vídeo).
 * O x-google-min-bitrate NÃO é espelhado de propósito: ele vira piso do encoder e, em link
 * mais fraco que o piso, provoca fila/perda em vez de adaptação.
 *
 * O Chrome lê essas dicas da descrição REMOTA do emissor: o broadcaster (offerer) só as honra se
 * vierem na answer do espectador. Sem este espelhamento, o GCC parte de ~300 kbps e leva dezenas
 * de segundos para chegar ao bitrate alvo (medido: ~6 Mbps no 1º segundo, 20 s até 15 Mbps).
 * Devolve a answer intacta se a offer não trouxer dicas.
 */
export function mirrorVideoBitrateHints(offerSdp: string, answerSdp: string): string {
  if (!offerSdp || !answerSdp) return answerSdp;
  const offerVideo = offerSdp.split(/(?=m=)/).find((s) => s.startsWith('m=video'));
  if (!offerVideo) return answerSdp;
  const hints: string[] = [];
  for (const key of ['x-google-max-bitrate', 'x-google-start-bitrate']) {
    const m = new RegExp(`${key}=(\\d+)`).exec(offerVideo);
    if (m) hints.push(`${key}=${m[1]}`);
  }
  if (hints.length === 0) return answerSdp;

  return answerSdp
    .split(/(?=m=)/)
    .map((section) => {
      if (!section.startsWith('m=video')) return section;
      return section.replace(/(a=fmtp:\d+ [^\r\n]+)(\r?\n)/g, (match, fmtpLine: string, lineEnd: string) => {
        // Só codecs de vídeo reais (não rtx: apt=) e sem duplicar
        if (fmtpLine.includes('x-google-start-bitrate') || /\bapt=\d+/.test(fmtpLine)) return match;
        const sep = fmtpLine.endsWith(';') ? '' : ';';
        return `${fmtpLine}${sep}${hints.join(';')}${lineEnd}`;
      });
    })
    .join('');
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

