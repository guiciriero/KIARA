/**
 * bitrateController.test.ts
 *
 * Parâmetros do controlador (calibrados para jogos de ação):
 *   - Congestionamento: perda > 8% OU RTT > 400 ms
 *   - Saudável: perda < 1% E RTT < 150 ms
 *   - Amostras consecutivas congestionadas para reduzir: 3
 *   - Amostras consecutivas saudáveis para recuperar:   3
 *   - Fator de redução: ×0.8 (−20% por evento)
 *   - Incremento de recuperação: +15% do alvo por evento
 *   - Piso padrão: max(1 500 000 bps, 25% do alvo)
 *   - Piso severo (perda > 15%): max(800 000 bps, 25% do alvo)
 */

import { describe, it, expect } from 'vitest';
import { BitrateController } from './bitrateController';

describe('BitrateController', () => {
  it('inicializa com o bitrate alvo configurado', () => {
    const controller = new BitrateController(5000);
    expect(controller.getCurrentBitrateBps()).toBe(5_000_000);
    expect(controller.getTargetBitrateBps()).toBe(5_000_000);
  });

  it('reduz bitrate em 20% após 3 amostras congestionadas consecutivas (perda > 8%)', () => {
    // alvo = 4 000 000; piso = max(1 500 000, 1 000 000) = 1 500 000
    const controller = new BitrateController(4000);

    // 1ª e 2ª amostras congestionadas — ainda aguarda
    expect(controller.onSample({ lossPercent: 9, rttMs: 50 })).toBe(4_000_000);
    expect(controller.onSample({ lossPercent: 9, rttMs: 50 })).toBe(4_000_000);

    // 3ª amostra → dispara redução: 4 000 000 × 0.8 = 3 200 000
    expect(controller.onSample({ lossPercent: 9, rttMs: 50 })).toBe(3_200_000);

    // Próximas duas congestionadas — aguarda novamente
    expect(controller.onSample({ lossPercent: 9, rttMs: 50 })).toBe(3_200_000);
    expect(controller.onSample({ lossPercent: 9, rttMs: 50 })).toBe(3_200_000);

    // 3ª → 3 200 000 × 0.8 = 2 560 000
    expect(controller.onSample({ lossPercent: 9, rttMs: 50 })).toBe(2_560_000);
  });

  it('dispara congestionamento quando RTT > 400 ms independente da perda', () => {
    const controller = new BitrateController(4000);
    // RTT = 401 ms com perda 0 → congestionado
    controller.onSample({ lossPercent: 0, rttMs: 401 });
    controller.onSample({ lossPercent: 0, rttMs: 401 });
    // 3ª → reduz
    expect(controller.onSample({ lossPercent: 0, rttMs: 401 })).toBe(3_200_000);
  });

  it('não dispara congestionamento para perda ≤ 8% e RTT ≤ 400 ms', () => {
    const controller = new BitrateController(4000);
    // perda exatamente 8% (não é > 8%) e RTT 400 ms (não é > 400) → não congesta
    controller.onSample({ lossPercent: 8, rttMs: 400 });
    controller.onSample({ lossPercent: 8, rttMs: 400 });
    controller.onSample({ lossPercent: 8, rttMs: 400 });
    expect(controller.getCurrentBitrateBps()).toBe(4_000_000);
  });

  it('respeita o piso mínimo padrão (1.5 Mbps ou 25% do alvo, o maior)', () => {
    // 2000 kbps → piso = max(1 500 000, 500 000) = 1 500 000
    const low = new BitrateController(2000);
    for (let i = 0; i < 30; i++) low.onSample({ lossPercent: 9, rttMs: 50 });
    expect(low.getCurrentBitrateBps()).toBe(1_500_000);

    // 8000 kbps → piso = max(1 500 000, 2 000 000) = 2 000 000 (25% prevalece)
    const high = new BitrateController(8000);
    for (let i = 0; i < 30; i++) high.onSample({ lossPercent: 9, rttMs: 50 });
    expect(high.getCurrentBitrateBps()).toBe(2_000_000);
  });

  it('aplica piso severo (800 kbps) quando perda > 15%', () => {
    // 2000 kbps → piso severo = max(800 000, 500 000) = 800 000
    const low = new BitrateController(2000);
    for (let i = 0; i < 30; i++) low.onSample({ lossPercent: 16, rttMs: 50 });
    expect(low.getCurrentBitrateBps()).toBe(800_000);

    // 1000 kbps → piso severo = max(800 000, 250 000) = 800 000
    const small = new BitrateController(1000);
    for (let i = 0; i < 30; i++) small.onSample({ lossPercent: 16, rttMs: 50 });
    expect(small.getCurrentBitrateBps()).toBe(800_000);
  });

  it('recupera bitrate em +15% do alvo após 3 amostras saudáveis consecutivas', () => {
    // alvo = 5 000 000; +15% = +750 000
    const controller = new BitrateController(5000);

    // Reduz: 3 congestionadas → 5 000 000 × 0.8 = 4 000 000
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    expect(controller.getCurrentBitrateBps()).toBe(4_000_000);

    // 2 saudáveis — ainda aguarda
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    expect(controller.getCurrentBitrateBps()).toBe(4_000_000);

    // 3ª saudável → 4 000 000 + 750 000 = 4 750 000
    expect(controller.onSample({ lossPercent: 0, rttMs: 40 })).toBe(4_750_000);
  });

  it('recuperação não ultrapassa o teto do alvo', () => {
    const controller = new BitrateController(5000);
    // Reduz apenas levemente para ficar próximo do alvo
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 }); // → 4 000 000

    // Sobe até o teto: 4 000 000 + 750 000 = 4 750 000; depois 4 750 000 + 750 000 > 5 000 000 → teto
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 0, rttMs: 40 }); // 4 750 000
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 0, rttMs: 40 }); // 5 000 000 (teto)
    expect(controller.getCurrentBitrateBps()).toBe(5_000_000);
  });

  it('não ultrapassa o teto mesmo começando no alvo (apenas amostras saudáveis)', () => {
    const controller = new BitrateController(5000);
    for (let i = 0; i < 30; i++) controller.onSample({ lossPercent: 0, rttMs: 20 });
    expect(controller.getCurrentBitrateBps()).toBe(5_000_000);
  });

  it('amostra intermediária decrementa 1 do contador saudável e não o zera', () => {
    // alvo = 5 000 000; +15% = +750 000
    const controller = new BitrateController(5000);
    // Reduz → 4 000 000
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 });

    // 2 saudáveis (contador = 2)
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    // 1 intermediária (perda = 2, RTT = 200) → contador = 2 - 1 = 1
    controller.onSample({ lossPercent: 2, rttMs: 200 });
    expect(controller.getCurrentBitrateBps()).toBe(4_000_000);

    // Precisa de mais 2 saudáveis para chegar a 3 (1 → 2 → 3)
    expect(controller.onSample({ lossPercent: 0, rttMs: 40 })).toBe(4_000_000); // 2
    expect(controller.onSample({ lossPercent: 0, rttMs: 40 })).toBe(4_750_000); // 3 → sobe
  });

  it('amostra congestionada zera o progresso de saudáveis', () => {
    const controller = new BitrateController(5000);
    // Reduz → 4 000 000
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 });

    // 2 saudáveis (contador = 2)
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    // 1 congestionada → zera saudáveis e inicia novo ciclo de congestionamento
    controller.onSample({ lossPercent: 9, rttMs: 50 });

    // 2 saudáveis não bastam (contador vai de 0 a 2, precisa de 3)
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    expect(controller.getCurrentBitrateBps()).toBe(4_000_000);

    // 3ª → sobe
    expect(controller.onSample({ lossPercent: 0, rttMs: 40 })).toBe(4_750_000);
  });

  it('contador de saudáveis nunca fica negativo após múltiplas intermediárias', () => {
    const controller = new BitrateController(5000);
    // Reduz → 4 000 000
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 });
    controller.onSample({ lossPercent: 9, rttMs: 50 });

    // 5 intermediárias consecutivas (contador nunca abaixo de 0)
    for (let i = 0; i < 5; i++) controller.onSample({ lossPercent: 2, rttMs: 200 });
    // Deve precisar de exatamente 3 saudáveis para recuperar
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 0, rttMs: 40 });
    expect(controller.getCurrentBitrateBps()).toBe(4_000_000);
    expect(controller.onSample({ lossPercent: 0, rttMs: 40 })).toBe(4_750_000);
  });

  it('updateTarget ajusta o alvo e clampa o bitrate atual imediatamente', () => {
    const controller = new BitrateController(5000);
    // Sem redução, current = 5 000 000
    controller.updateTarget(3000);
    expect(controller.getTargetBitrateBps()).toBe(3_000_000);
    // current clampado ao novo alvo
    expect(controller.getCurrentBitrateBps()).toBe(3_000_000);
  });

  it('ignora amostras inválidas mantendo a taxa atual', () => {
    const controller = new BitrateController(5000);
    expect(controller.onSample({ lossPercent: -1, rttMs: 50 })).toBe(5_000_000);
    expect(controller.onSample({ lossPercent: undefined, rttMs: 50 })).toBe(5_000_000);
    expect(controller.onSample({ lossPercent: 0, rttMs: NaN })).toBe(5_000_000);
  });
});
