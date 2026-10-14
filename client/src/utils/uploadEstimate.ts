/**
 * uploadEstimate.ts
 * Estimativa da banda de upload necessária ao apresentador (um fluxo por espectador).
 * Funções puras, sem dependência de DOM/React.
 */

export type UploadAdvice = 'ok' | 'warning' | 'danger';

/** Upload estimado em Mbps = bitrate (kbps) × espectadores / 1000, arredondado a 0,1 */
export function estimateUploadMbps(bitrateKbps: number, viewers: number): number {
  const kbps = Number.isFinite(bitrateKbps) ? Math.max(0, bitrateKbps) : 0;
  const count = Number.isFinite(viewers) ? Math.max(0, viewers) : 0;
  return Math.round(((kbps * count) / 1000) * 10) / 10;
}

/** ≤ 20 Mbps ok; ≤ 50 Mbps atenção; acima disso, perigo */
export function uploadAdvice(mbps: number): UploadAdvice {
  if (mbps <= 20) return 'ok';
  if (mbps <= 50) return 'warning';
  return 'danger';
}
