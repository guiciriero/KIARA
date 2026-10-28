/**
 * statsService.ts
 *
 * Coleta e interpreta métricas de qualidade WebRTC a partir de RTCStatsReport.
 * Extrai RTT do par ICE ativo, perda e jitter de remote-inbound-rtp e bitrate via delta.
 */

import type { StreamStats } from '@shared/index';

interface StateSample {
  bytesSentVideo: number;
  bytesSentAudio: number;
  packetsSentVideo: number;
  packetsLostVideo: number;
  framesSent: number;
  framesEncoded: number;
  fps: number;
  videoBitrate: number;
  audioBitrate: number;
  latencyMs: number;
  jitterMs: number;
  lossPercent: number;
  timestamp: number;
}

const previousSamples = new Map<string, StateSample>();

/** Aviso de relatório vazio emitido no máximo uma vez por sessão (flag de módulo) */
let warnedEmptyReport = false;

/** Só para testes: rearma o aviso único de relatório sem entradas úteis */
export function resetEmptyReportWarning(): void {
  warnedEmptyReport = false;
}

interface RtcStatsEntry {
  id?: string;
  type?: string;
  kind?: string;
  framesPerSecond?: number;
  bytesSent?: number;
  packetsSent?: number;
  packetsLost?: number;
  fractionLost?: number;
  jitter?: number;
  roundTripTime?: number;
  currentRoundTripTime?: number;
  qualityLimitationReason?: string;
  selectedCandidatePairId?: string;
  state?: string;
  nominated?: boolean;
  // Campos de frame
  framesDropped?: number;
  framesSent?: number;
  framesEncoded?: number;
  encodedFrameWidth?: number;
  encodedFrameHeight?: number;
  framesDecoded?: number;
  framesReceived?: number;
  framesLost?: number;
  totalDecodeTime?: number;
  // Amostragem de decode time para P95
  [key: string]: unknown;
}

/** Janela deslizante para calcular P95 de uma série de amostras */
class SlidingPercentile {
  private readonly window: number;
  private samples: number[] = [];

  constructor(windowSize = 60) {
    this.window = windowSize;
  }

  add(value: number): void {
    this.samples.push(value);
    if (this.samples.length > this.window) {
      this.samples.shift();
    }
  }

  p95(): number {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const idx = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, idx)];
  }
}

/** Amostras de decode time por peer para cálculo de P95 */
const decodeTimeSamples = new Map<string, SlidingPercentile>();
/** Número de frames decodificados na amostra anterior (para calcular delta) */
const prevFramesDecoded = new Map<string, { framesDecoded: number; totalDecodeTime: number }>();

/**
 * Analisa um RTCStatsReport e calcula as métricas agregadas da conexão.
 */
export function parseRTCStats(report: RTCStatsReport, peerId = 'default'): StreamStats {
  let fps = 0;
  let bytesSentVideo = 0;
  let bytesSentAudio = 0;
  let packetsSentVideo = 0;
  let packetsLostVideo = 0;
  let fractionLost: number | undefined;
  let jitterMs = 0;
  let remoteRtt: number | undefined;
  let qualityLimitation: StreamStats['qualityLimitation'] = 'none';
  // Campos estendidos
  let encodedWidth: number | undefined;
  let encodedHeight: number | undefined;
  let framesDropped: number | undefined;
  let framesSent: number | undefined;
  let framesEncoded: number | undefined;
  let framesDecoded: number | undefined;
  let framesReceived: number | undefined;
  let framesLost: number | undefined;
  let totalDecodeTime: number | undefined;

  let selectedCandidatePairId: string | undefined;
  const candidatePairs: RtcStatsEntry[] = [];
  const entriesById = new Map<string, RtcStatsEntry>();

  const statsEntries: RtcStatsEntry[] = [];
  if (typeof report.forEach === 'function') {
    report.forEach((stat: unknown) => {
      if (stat && typeof stat === 'object') {
        statsEntries.push(stat as RtcStatsEntry);
      }
    });
  } else if (typeof report.values === 'function') {
    for (const stat of report.values()) {
      if (stat && typeof stat === 'object') {
        statsEntries.push(stat as RtcStatsEntry);
      }
    }
  }

  // Sem outbound-rtp, inbound-rtp, remote-inbound-rtp nem candidate-pair não há o que medir.
  // Não lança (os valores saem zerados), mas avisa uma única vez em vez de silenciar.
  const hasUsefulEntries = statsEntries.some(
    (s) =>
      s.type === 'outbound-rtp' ||
      s.type === 'inbound-rtp' ||
      s.type === 'remote-inbound-rtp' ||
      s.type === 'candidate-pair',
  );
  if (!hasUsefulEntries && !warnedEmptyReport) {
    warnedEmptyReport = true;
    console.warn('[KIARA] Relatório de estatísticas WebRTC sem entradas úteis; métricas indisponíveis.');
  }

  for (const stat of statsEntries) {
    if (stat.id) {
      entriesById.set(stat.id, stat);
    }

    if (stat.type === 'transport' && stat.selectedCandidatePairId) {
      selectedCandidatePairId = stat.selectedCandidatePairId;
    }

    if (stat.type === 'candidate-pair') {
      candidatePairs.push(stat);
    }

    if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
      if (stat.framesPerSecond !== undefined && stat.framesPerSecond > 0) {
        fps = Math.round(stat.framesPerSecond);
      }
      bytesSentVideo = stat.bytesSent ?? 0;
      packetsSentVideo = stat.packetsSent ?? 0;
      const reason = stat.qualityLimitationReason;
      if (reason === 'cpu' || reason === 'bandwidth' || reason === 'other') {
        qualityLimitation = reason;
      } else {
        qualityLimitation = 'none';
      }
      // Campos estendidos do emissor
      if (stat.framesDropped !== undefined) framesDropped = stat.framesDropped;
      if (stat.framesSent !== undefined) framesSent = stat.framesSent;
      if (stat.framesEncoded !== undefined) framesEncoded = stat.framesEncoded;
      if (stat.encodedFrameWidth !== undefined) encodedWidth = stat.encodedFrameWidth;
      if (stat.encodedFrameHeight !== undefined) encodedHeight = stat.encodedFrameHeight;
    }

    if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
      bytesSentAudio = stat.bytesSent ?? 0;
    }

    if (stat.type === 'remote-inbound-rtp' && (stat.kind === 'video' || !stat.kind)) {
      packetsLostVideo = stat.packetsLost ?? 0;
      fractionLost = stat.fractionLost;
      jitterMs = Math.round((stat.jitter ?? 0) * 1000);
      remoteRtt = stat.roundTripTime;
    }

    // Campos do receptor (lado espectador: inbound-rtp de vídeo)
    if (stat.type === 'inbound-rtp' && stat.kind === 'video') {
      if (stat.framesDecoded !== undefined) framesDecoded = stat.framesDecoded;
      if (stat.framesReceived !== undefined) framesReceived = stat.framesReceived;
      if (stat.framesDropped !== undefined) framesLost = stat.framesDropped;
      if (stat.totalDecodeTime !== undefined) totalDecodeTime = stat.totalDecodeTime;
    }
  }

  // Resolução do RTT com prioridade no par ICE selecionado
  let rttSeconds: number | undefined;
  if (selectedCandidatePairId) {
    const selected = entriesById.get(selectedCandidatePairId);
    if (selected) {
      rttSeconds = selected.currentRoundTripTime ?? selected.roundTripTime;
    }
  }

  if (rttSeconds === undefined) {
    const nominatedPair = candidatePairs.find((p) => p.state === 'succeeded' && p.nominated);
    if (nominatedPair) {
      rttSeconds = nominatedPair.currentRoundTripTime ?? nominatedPair.roundTripTime;
    }
  }

  if (rttSeconds === undefined) {
    const succeededPair = candidatePairs.find((p) => p.state === 'succeeded');
    if (succeededPair) {
      rttSeconds = succeededPair.currentRoundTripTime ?? succeededPair.roundTripTime;
    }
  }

  if (rttSeconds === undefined && remoteRtt !== undefined) {
    rttSeconds = remoteRtt;
  }

  let latencyMs = Math.round((rttSeconds ?? 0) * 1000);
  const now = Date.now();
  const prev = previousSamples.get(peerId);

  let videoBitrate = 0;
  let audioBitrate = 0;
  let lossPercent = 0;

  if (prev && now > prev.timestamp) {
    const elapsedSec = (now - prev.timestamp) / 1000;
    const deltaVideoBytes = bytesSentVideo - prev.bytesSentVideo;
    const deltaAudioBytes = bytesSentAudio - prev.bytesSentAudio;

    if (deltaVideoBytes > 0) {
      videoBitrate = Math.max(0, Math.round((deltaVideoBytes * 8) / elapsedSec / 1000));
    } else if (prev.videoBitrate > 0 && bytesSentVideo > 0) {
      videoBitrate = prev.videoBitrate;
    }

    if (deltaAudioBytes > 0) {
      audioBitrate = Math.max(0, Math.round((deltaAudioBytes * 8) / elapsedSec / 1000));
    } else if (prev.audioBitrate > 0 && bytesSentAudio > 0) {
      audioBitrate = prev.audioBitrate;
    }

    // Cálculo e persistência de FPS
    if (fps === 0 && elapsedSec > 0) {
      const currentFrames = framesSent ?? framesEncoded ?? 0;
      const prevFrames = prev.framesSent ?? prev.framesEncoded ?? 0;
      const deltaFrames = currentFrames - prevFrames;
      if (deltaFrames > 0) {
        fps = Math.round(deltaFrames / elapsedSec);
      } else if (prev.fps > 0 && bytesSentVideo > prev.bytesSentVideo) {
        fps = prev.fps;
      }
    } else if (fps === 0 && prev.fps > 0 && bytesSentVideo > 0) {
      fps = prev.fps;
    }

    const deltaSent = packetsSentVideo - prev.packetsSentVideo;
    const deltaLost = packetsLostVideo - prev.packetsLostVideo;

    if (deltaSent + deltaLost > 0 && deltaLost >= 0) {
      lossPercent = Math.max(0, Math.min(100, Math.round(((deltaLost / (deltaSent + deltaLost)) * 100) * 10) / 10));
    } else if (fractionLost !== undefined && fractionLost >= 0) {
      lossPercent = Math.max(0, Math.min(100, Math.round(fractionLost * 100 * 10) / 10));
    } else if (prev.lossPercent !== undefined) {
      lossPercent = prev.lossPercent;
    }

    if (latencyMs === 0 && prev.latencyMs > 0) {
      latencyMs = prev.latencyMs;
    }
    if (jitterMs === 0 && prev.jitterMs > 0) {
      jitterMs = prev.jitterMs;
    }
    if (packetsLostVideo === 0 && prev.packetsLostVideo > 0) {
      packetsLostVideo = prev.packetsLostVideo;
    }
  } else if (fractionLost !== undefined && fractionLost >= 0) {
    lossPercent = Math.max(0, Math.min(100, Math.round(fractionLost * 100 * 10) / 10));
  }

  previousSamples.set(peerId, {
    bytesSentVideo,
    bytesSentAudio,
    packetsSentVideo,
    packetsLostVideo,
    framesSent: framesSent ?? 0,
    framesEncoded: framesEncoded ?? 0,
    fps,
    videoBitrate,
    audioBitrate,
    latencyMs,
    jitterMs,
    lossPercent,
    timestamp: now,
  });

  const connectionQuality = classifyQuality(latencyMs, lossPercent);

  // Calcula tempo médio de decodificação e P95 (somente lado receptor)
  let decodeTimeMs: number | undefined;
  let decodeTimeP95Ms: number | undefined;
  if (framesDecoded !== undefined && totalDecodeTime !== undefined) {
    const prevDec = prevFramesDecoded.get(peerId);
    if (prevDec && framesDecoded > prevDec.framesDecoded) {
      const deltaFrames = framesDecoded - prevDec.framesDecoded;
      const deltaTime = totalDecodeTime - prevDec.totalDecodeTime;
      if (deltaFrames > 0 && deltaTime >= 0) {
        const avgMs = Math.round((deltaTime / deltaFrames) * 1000 * 10) / 10;
        decodeTimeMs = avgMs;

        // Acumula na janela deslizante para P95
        let perc = decodeTimeSamples.get(peerId);
        if (!perc) {
          perc = new SlidingPercentile(120);
          decodeTimeSamples.set(peerId, perc);
        }
        perc.add(avgMs);
        decodeTimeP95Ms = Math.round(perc.p95() * 10) / 10;
      }
    }
    prevFramesDecoded.set(peerId, { framesDecoded, totalDecodeTime });
  }

  return {
    fps,
    videoBitrate,
    audioBitrate,
    latencyMs,
    packetsLost: packetsLostVideo,
    lossPercent,
    jitterMs,
    qualityLimitation,
    connectionQuality,
    timestamp: now,
    // Campos estendidos (undefined se não disponíveis)
    ...(encodedWidth !== undefined && { encodedWidth }),
    ...(encodedHeight !== undefined && { encodedHeight }),
    ...(framesDropped !== undefined && { framesDropped }),
    ...(framesSent !== undefined && { framesSent }),
    ...(framesDecoded !== undefined && { framesDecoded }),
    ...(framesReceived !== undefined && { framesReceived }),
    ...(framesLost !== undefined && { framesLost }),
    ...(decodeTimeMs !== undefined && { decodeTimeMs }),
    ...(decodeTimeP95Ms !== undefined && { decodeTimeP95Ms }),
  };
}

/**
 * Classifica a qualidade da conexão segundo a latência e perda de pacotes.
 */
export function classifyQuality(
  latencyMs: number,
  lossPercent: number,
): StreamStats['connectionQuality'] {
  if (latencyMs < 50 && lossPercent < 1) return 'excellent';
  if (latencyMs < 150 && lossPercent < 3) return 'good';
  if (latencyMs < 300 && lossPercent < 8) return 'fair';
  return 'poor';
}

/** Remove o histórico de amostragem de um peer */
export function clearPeerSample(peerId: string): void {
  previousSamples.delete(peerId);
  prevFramesDecoded.delete(peerId);
  decodeTimeSamples.delete(peerId);
}
