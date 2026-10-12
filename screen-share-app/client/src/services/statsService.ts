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
  timestamp: number;
}

const previousSamples = new Map<string, StateSample>();

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
  [key: string]: unknown;
}

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
      fps = Math.round(stat.framesPerSecond ?? 0);
      bytesSentVideo = stat.bytesSent ?? 0;
      packetsSentVideo = stat.packetsSent ?? 0;
      const reason = stat.qualityLimitationReason;
      if (reason === 'cpu' || reason === 'bandwidth' || reason === 'other') {
        qualityLimitation = reason;
      } else {
        qualityLimitation = 'none';
      }
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

  const latencyMs = Math.round((rttSeconds ?? 0) * 1000);
  const now = Date.now();
  const prev = previousSamples.get(peerId);

  let videoBitrate = 0;
  let audioBitrate = 0;
  let lossPercent = 0;

  if (prev && now > prev.timestamp) {
    const elapsedSec = (now - prev.timestamp) / 1000;
    videoBitrate = Math.max(0, Math.round(((bytesSentVideo - prev.bytesSentVideo) * 8) / elapsedSec / 1000));
    audioBitrate = Math.max(0, Math.round(((bytesSentAudio - prev.bytesSentAudio) * 8) / elapsedSec / 1000));

    const deltaSent = packetsSentVideo - prev.packetsSentVideo;
    const deltaLost = packetsLostVideo - prev.packetsLostVideo;

    if (deltaSent + deltaLost > 0 && deltaLost >= 0) {
      lossPercent = Math.max(0, Math.min(100, Math.round(((deltaLost / (deltaSent + deltaLost)) * 100) * 10) / 10));
    } else if (fractionLost !== undefined && fractionLost >= 0) {
      lossPercent = Math.max(0, Math.min(100, Math.round(fractionLost * 100 * 10) / 10));
    }
  } else if (fractionLost !== undefined && fractionLost >= 0) {
    lossPercent = Math.max(0, Math.min(100, Math.round(fractionLost * 100 * 10) / 10));
  }

  previousSamples.set(peerId, {
    bytesSentVideo,
    bytesSentAudio,
    packetsSentVideo,
    packetsLostVideo,
    timestamp: now,
  });

  const connectionQuality = classifyQuality(latencyMs, lossPercent);

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
}
