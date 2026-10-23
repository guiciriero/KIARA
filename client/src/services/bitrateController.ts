/**
 * bitrateController.ts
 *
 * Controlador de taxa de bits adaptativo (AIMD) para conexões WebRTC.
 * Ajusta o bitrate de vídeo por peer com base nas métricas de RTT e perda de pacotes.
 */

export interface NetworkSample {
  lossPercent?: number;
  rttMs?: number;
}

/** Piso padrão do bitrate em congestionamento (1.5 Mbps) */
const MIN_BITRATE_BPS = 1_500_000;
/** Piso reduzido para perda severa (> SEVERE_LOSS_PERCENT) — alivia o encoder mas mantém vídeo usável */
const SEVERE_MIN_BITRATE_BPS = 800_000;
const SEVERE_LOSS_PERCENT = 10;

export class BitrateController {
  private targetBitrateBps: number;
  private currentBitrateBps: number;
  private consecutiveCongested = 0;
  private consecutiveHealthy = 0;

  constructor(targetBitrateKbps = 5000) {
    this.targetBitrateBps = targetBitrateKbps * 1000;
    this.currentBitrateBps = this.targetBitrateBps;
  }

  /**
   * Atualiza a taxa de bits alvo (ex.: quando a configuração de vídeo é alterada).
   * Reduz imediatamente a taxa atual se ela ultrapassar o novo teto.
   */
  updateTarget(targetBitrateKbps: number): void {
    this.targetBitrateBps = targetBitrateKbps * 1000;
    if (this.currentBitrateBps > this.targetBitrateBps) {
      this.currentBitrateBps = this.targetBitrateBps;
    }
  }

  /**
   * Processa uma nova amostra de rede e calcula a nova taxa de bits máxima em bps.
   * Amostras com dados inválidos ou ausentes são ignoradas mantendo a taxa atual.
   *
   * AIMD: congestionado (perda > 5% ou RTT > 300 ms) ×2 seguidas ⇒ ×0,75; saudável
   * (perda < 1% e RTT < 150 ms) ×5 ⇒ +10% do alvo. Amostra intermediária decrementa em 1
   * o contador de saudáveis (não o zera) e zera o de congestionadas.
   *
   * Piso da redução: max(800 kbps, 25% do alvo); com perda > 10% o piso cai para 400 kbps
   * (ou 25% do alvo, o que for maior), pois manter 800 kbps em rede muito ruim sobrecarrega o encoder.
   */
  onSample(sample: NetworkSample): number {
    const { lossPercent, rttMs } = sample;

    if (
      lossPercent === undefined ||
      rttMs === undefined ||
      lossPercent < 0 ||
      rttMs < 0 ||
      Number.isNaN(lossPercent) ||
      Number.isNaN(rttMs)
    ) {
      return this.currentBitrateBps;
    }

    const isCongested = lossPercent > 5 || rttMs > 300;
    const isHealthy = lossPercent < 1 && rttMs < 150;

    if (isCongested) {
      this.consecutiveCongested += 1;
      this.consecutiveHealthy = 0;

      if (this.consecutiveCongested >= 2) {
        const minBps = lossPercent > SEVERE_LOSS_PERCENT ? SEVERE_MIN_BITRATE_BPS : MIN_BITRATE_BPS;
        const floor = Math.max(minBps, Math.round(this.targetBitrateBps * 0.25));
        this.currentBitrateBps = Math.max(floor, Math.round(this.currentBitrateBps * 0.75));
        this.consecutiveCongested = 0;
      }
    } else if (isHealthy) {
      this.consecutiveHealthy += 1;
      this.consecutiveCongested = 0;

      if (this.consecutiveHealthy >= 5) {
        const increment = Math.round(this.targetBitrateBps * 0.1);
        this.currentBitrateBps = Math.min(this.targetBitrateBps, this.currentBitrateBps + increment);
        this.consecutiveHealthy = 0;
      }
    } else {
      // Estado intermediário: zera congestionamento e só decrementa 1 do contador de saudáveis
      this.consecutiveCongested = 0;
      this.consecutiveHealthy = Math.max(0, this.consecutiveHealthy - 1);
    }

    return this.currentBitrateBps;
  }

  getCurrentBitrateBps(): number {
    return this.currentBitrateBps;
  }

  getTargetBitrateBps(): number {
    return this.targetBitrateBps;
  }
}
