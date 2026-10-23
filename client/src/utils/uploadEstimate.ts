/**
 * uploadEstimate.ts
 * Estimativa da banda de upload necessária ao apresentador (um fluxo por espectador).
 * Funções puras, sem dependência de DOM/React.
 */

export type UploadAdvice = 'ok' | 'warning' | 'danger';

/**
 * Fator de margem recomendado sobre o bitrate configurado.
 * Ex.: 8 Mbps de bitrate → recomenda-se 12 Mbps de upload disponível (8 × 1.5).
 * Garante espaço para oscilações de rede sem saturar o uplink.
 */
export const UPLOAD_MARGIN_FACTOR = 1.5;

/** Upload estimado em Mbps = bitrate (kbps) × espectadores / 1000, arredondado a 0,1 */
export function estimateUploadMbps(bitrateKbps: number, viewers: number): number {
  const kbps = Number.isFinite(bitrateKbps) ? Math.max(0, bitrateKbps) : 0;
  const count = Number.isFinite(viewers) ? Math.max(0, viewers) : 0;
  return Math.round(((kbps * count) / 1000) * 10) / 10;
}

/**
 * Upload recomendado com margem para oscilações = estimado × UPLOAD_MARGIN_FACTOR, arredondado a 0,1.
 * Ex.: 8 Mbps estimado → recomenda-se 12 Mbps disponíveis.
 */
export function recommendedUploadMbps(bitrateKbps: number, viewers: number): number {
  const estimated = estimateUploadMbps(bitrateKbps, viewers);
  return Math.round(estimated * UPLOAD_MARGIN_FACTOR * 10) / 10;
}

/**
 * Classifica o risco de saturação com base no upload estimado (sem margem).
 * - ok:      ≤ 20 Mbps — provável que a maioria das conexões domésticas aguentem
 * - warning: ≤ 50 Mbps — requer conexão de alta capacidade; monitorar
 * - danger:  > 50 Mbps — improvável em conexões residenciais
 */
export function uploadAdvice(mbps: number): UploadAdvice {
  if (mbps <= 20) return 'ok';
  if (mbps <= 50) return 'warning';
  return 'danger';
}
