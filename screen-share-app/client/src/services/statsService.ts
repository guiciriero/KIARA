/**
 * statsService.ts
 *
 * Coleta e interpreta as métricas de qualidade da transmissão a partir
 * da API WebRTC (RTCStatsReport).
 *
 * Correção: o bitrate é calculado como delta entre duas amostras consecutivas
 * (bytes/segundo × 8 = bits/segundo), não como total acumulado.
 */

import type { StreamStats } from '@shared/index';

/**
 * Estado da amostra anterior — necessário para calcular o delta de bytes.
 * Mantido por referência para que o serviço funcione de forma stateful.
 */
interface StateSample {
  bytesSentVideo: number;
  bytesSentAudio: number;
  timestamp: number;
}

// Armazena a última amostra por peer (identificado pelo ID do RTCPeerConnection)
const previousSamples = new Map<string, StateSample>();

/**
 * Analisa um RTCStatsReport e calcula métricas de qualidade em tempo real.
 *
 * @param report  Resultado de RTCPeerConnection.getStats()
 * @param peerId  Identificador do peer (para cálculo de delta entre amostras)
 */
export function parseRTCStats(report: RTCStatsReport, peerId = 'default'): Partial<StreamStats> {
  let fps = 0;
  let bytesSentVideo = 0;
  let bytesSentAudio = 0;
  let latencyMs = 0;
  let packetsLost = 0;
  const now = Date.now();

  for (const stat of report.values()) {
    // Faixa de vídeo enviada
    if (stat.type === 'outbound-rtp' && stat.kind === 'video') {
      fps           = Math.round(stat.framesPerSecond ?? 0);
      bytesSentVideo = stat.bytesSent ?? 0;
      packetsLost   += stat.packetsLost ?? 0;
    }

    // Faixa de áudio enviada
    if (stat.type === 'outbound-rtp' && stat.kind === 'audio') {
      bytesSentAudio = stat.bytesSent ?? 0;
    }

    // Latência estimada via par de candidatos ICE selecionado
    if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
      latencyMs = Math.round((stat.currentRoundTripTime ?? 0) * 1000);
    }
  }

  // Calcula bitrate como delta entre a amostra atual e a anterior (kbps)
  const prev = previousSamples.get(peerId);
  let videoBitrate = 0;
  let audioBitrate = 0;

  if (prev && now > prev.timestamp) {
    const elapsedSec = (now - prev.timestamp) / 1000;
    // bits/s ÷ 1000 = kbps
    videoBitrate = Math.round(((bytesSentVideo - prev.bytesSentVideo) * 8) / elapsedSec / 1000);
    audioBitrate = Math.round(((bytesSentAudio - prev.bytesSentAudio) * 8) / elapsedSec / 1000);
    // Garante que valores negativos (reset do contador) resultem em zero
    if (videoBitrate < 0) videoBitrate = 0;
    if (audioBitrate < 0) audioBitrate = 0;
  }

  // Salva amostra atual para o próximo cálculo
  previousSamples.set(peerId, { bytesSentVideo, bytesSentAudio, timestamp: now });

  return { fps, videoBitrate, audioBitrate, latencyMs, packetsLost };
}

/**
 * Classifica a qualidade da conexão com base na latência e perda de pacotes.
 */
export function classifyQuality(
  latencyMs: number,
  packetsLost: number,
): StreamStats['connectionQuality'] {
  if (latencyMs < 50  && packetsLost < 5)  return 'excellent';
  if (latencyMs < 150 && packetsLost < 20) return 'good';
  if (latencyMs < 300 && packetsLost < 50) return 'fair';
  return 'poor';
}

/** Remove a amostra de um peer (chamar ao encerrar a conexão) */
export function clearPeerSample(peerId: string): void {
  previousSamples.delete(peerId);
}
