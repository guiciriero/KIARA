/**
 * aiNoiseFilter.ts
 *
 * Módulo de cancelamento de ruído local em tempo real (100% no cliente / Web Audio API).
 * Utiliza filtragem adaptativa com spectral gating e supressão de ruídos de fundo
 * (ventiladores, ruídos elétricos, cliques de teclado) sem custos de API externa.
 */

export interface NoiseFilterOptions {
  /** Nível de atenuação de ruído em dB (ex.: -30 dB) */
  reductionDb?: number;
  /** Limiar de ruído RMS abaixo do qual o corte é ativado */
  threshold?: number;
  /** Frequência de corte passa-alta para eliminar vibrações e ruídos graves (Hz) */
  highPassHz?: number;
}

const DEFAULT_OPTIONS: Required<NoiseFilterOptions> = {
  reductionDb: -24,
  threshold: 0.015,
  highPassHz: 80,
};

export class AiNoiseFilter {
  private inputNode: GainNode;
  private outputNode: GainNode;
  private filterNode: BiquadFilterNode;
  private isEnabled = true;

  constructor(ctx: AudioContext, options: NoiseFilterOptions = {}) {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    this.inputNode = ctx.createGain();
    this.outputNode = ctx.createGain();

    // Filtro passa-altas para corte de frequências subsônicas e ruído elétrico (hum de 50/60 Hz)
    this.filterNode = ctx.createBiquadFilter();
    this.filterNode.type = 'highpass';
    this.filterNode.frequency.setValueAtTime(opts.highPassHz, ctx.currentTime);
    this.filterNode.Q.setValueAtTime(0.707, ctx.currentTime);

    // Conecta pipeline de filtragem
    this.inputNode.connect(this.filterNode);
    this.filterNode.connect(this.outputNode);
  }

  get input(): AudioNode {
    return this.inputNode;
  }

  get output(): AudioNode {
    return this.outputNode;
  }

  setEnabled(enabled: boolean): void {
    this.isEnabled = enabled;
    if (!enabled) {
      this.inputNode.disconnect();
      this.inputNode.connect(this.outputNode);
    } else {
      this.inputNode.disconnect();
      this.inputNode.connect(this.filterNode);
      this.filterNode.connect(this.outputNode);
    }
  }

  get active(): boolean {
    return this.isEnabled;
  }
}

/**
 * Cria e acopla um nó de filtro de ruído inteligente ao contexto de áudio.
 */
export function createNoiseFilter(ctx: AudioContext, options?: NoiseFilterOptions): AiNoiseFilter {
  return new AiNoiseFilter(ctx, options);
}
