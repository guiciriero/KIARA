/**
 * bitrateController.ts
 *
 * Controlador de taxa de bits adaptativo (AIMD) para conexões WebRTC.
 * Ajusta o bitrate de vídeo por peer com base nas métricas de RTT e perda de pacotes.
 *
 * Calibrado para jogos de ação e conteúdo de movimento rápido:
 * - Congestionamento exige 3 amostras consecutivas (não 2) para reduzir — evita
 *   reações a picos de bitrate normais em cenas de explosão/movimento rápido.
 * - Limiar de congestionamento: perda > 8% (não 5%) — o GCC do Chrome reporta
 *   "perda" em picos de bitrate que não são congestionamento de rede real.
 * - RTT congestionado: > 400 ms (não 300 ms) — RTTs de 300-400 ms são comuns
 *   em redes Wi-Fi sem indicar saturação real.
 * - Recuperação em 3 amostras saudáveis (não 5) subindo 15% do alvo (não 10%) —
 *   após uma cena calma o bitrate volta ao alvo mais rápido.
 * - Redução de 20% por evento (não 25%) — reação proporcional menor a picos.
 */

export interface NetworkSample {
  lossPercent?: number;
  rttMs?: number;
}

/** Piso padrão do bitrate em congestionamento (1.5 Mbps) */
const MIN_BITRATE_BPS = 1_500_000;
/** Piso reduzido para perda severa (> SEVERE_LOSS_PERCENT) */
const SEVERE_MIN_BITRATE_BPS = 800_000;

/** Perda acima deste valor é congestionamento real (não pico de cena) */
const CONGESTION_LOSS_THRESHOLD = 8;
/** RTT acima deste valor indica congestionamento real */
const CONGESTION_RTT_THRESHOLD_MS = 400;
/** Perda acima deste valor indica rede com problema grave */
const SEVERE_LOSS_PERCENT = 15;

/** Amostras consecutivas congestionadas para reduzir bitrate */
const CONGESTION_SAMPLES_TO_REDUCE = 3;
/** Amostras consecutivas saudáveis para recuperar bitrate */
const HEALTHY_SAMPLES_TO_RECOVER = 3;

/** Fator de redução por evento de congestionamento confirmado */
const REDUCTION_FACTOR = 0.8;   // reduz 20%
/** Incremento de recuperação como fração do alvo por evento saudável */
const RECOVERY_INCREMENT_RATIO = 0.15; // sobe 15% do alvo

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
   * Processa uma nova amostra de rede e retorna a taxa de bits máxima em bps.
   * Amostras inválidas são ignoradas mantendo a taxa atual.
   *
   * AIMD ajustado para jogos:
   * - Congestionado (perda > 8% OU RTT > 400 ms) por 3 amostras seguidas → reduz 20%.
   * - Saudável (perda < 1% E RTT < 150 ms) por 3 amostras seguidas → sobe 15% do alvo.
   * - Amostra intermediária: decrementa 1 do contador saudável, não zera.
   * - Piso: max(MIN_BITRATE_BPS, 25% do alvo); com perda > 15%: SEVERE_MIN_BITRATE_BPS.
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

    const isCongested = lossPercent > CONGESTION_LOSS_THRESHOLD || rttMs > CONGESTION_RTT_THRESHOLD_MS;
    const isHealthy = lossPercent < 1 && rttMs < 150;

    if (isCongested) {
      this.consecutiveCongested += 1;
      this.consecutiveHealthy = 0;

      if (this.consecutiveCongested >= CONGESTION_SAMPLES_TO_REDUCE) {
        const minBps = lossPercent > SEVERE_LOSS_PERCENT ? SEVERE_MIN_BITRATE_BPS : MIN_BITRATE_BPS;
        const floor = Math.max(minBps, Math.round(this.targetBitrateBps * 0.25));
        this.currentBitrateBps = Math.max(floor, Math.round(this.currentBitrateBps * REDUCTION_FACTOR));
        this.consecutiveCongested = 0;
      }
    } else if (isHealthy) {
      this.consecutiveHealthy += 1;
      this.consecutiveCongested = 0;

      if (this.consecutiveHealthy >= HEALTHY_SAMPLES_TO_RECOVER) {
        const increment = Math.round(this.targetBitrateBps * RECOVERY_INCREMENT_RATIO);
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
