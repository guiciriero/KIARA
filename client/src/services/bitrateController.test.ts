/**
 * bitrateController.test.ts
 */

import { describe, it, expect } from 'vitest';
import { BitrateController } from './bitrateController';

describe('BitrateController', () => {
  it('inicializa com o bitrate alvo configurado', () => {
    const controller = new BitrateController(5000);
    expect(controller.getCurrentBitrateBps()).toBe(5000000);
    expect(controller.getTargetBitrateBps()).toBe(5000000);
  });

  it('reduz bitrate em 25% após 2 amostras congestionadas consecutivas respeitando o piso', () => {
    const controller = new BitrateController(4000); // 4000 kbps = 4_000_000 bps
    // Piso = max(800k, 25% de 4M) = 1_000_000 bps

    // 1ª amostra congestionada (perda > 5%) -> ainda mantém
    let bitrate = controller.onSample({ lossPercent: 6, rttMs: 50 });
    expect(bitrate).toBe(4000000);

    // 2ª amostra congestionada -> reduz x0.75 = 3_000_000
    bitrate = controller.onSample({ lossPercent: 8, rttMs: 60 });
    expect(bitrate).toBe(3000000);

    // Próxima amostra congestionada isolada -> mantém 3_000_000 até completar 2
    bitrate = controller.onSample({ lossPercent: 10, rttMs: 70 });
    expect(bitrate).toBe(3000000);

    // 2ª amostra -> reduz x0.75 = 2_250_000
    bitrate = controller.onSample({ lossPercent: 12, rttMs: 80 });
    expect(bitrate).toBe(2250000);
  });

  it('respeita o piso mínimo de bitrate (800 kbps ou 25% do alvo)', () => {
    const controller = new BitrateController(2000); // 2_000_000 bps -> piso = max(800k, 500k) = 800k
    for (let i = 0; i < 20; i++) {
      controller.onSample({ lossPercent: 10, rttMs: 400 });
    }
    expect(controller.getCurrentBitrateBps()).toBe(800000);
  });

  it('reduz o piso para 400 kbps quando a perda é severa (> 10%)', () => {
    const controller = new BitrateController(2000); // piso = max(400k, 500k) = 500k
    for (let i = 0; i < 30; i++) {
      controller.onSample({ lossPercent: 15, rttMs: 400 });
    }
    expect(controller.getCurrentBitrateBps()).toBe(500000);

    const small = new BitrateController(1000); // piso = max(400k, 250k) = 400k
    for (let i = 0; i < 30; i++) {
      small.onSample({ lossPercent: 15, rttMs: 400 });
    }
    expect(small.getCurrentBitrateBps()).toBe(400000);
  });

  it('recupera bitrate gradualmente (+10% do alvo) após 5 amostras saudáveis consecutivas respeitando o teto', () => {
    const controller = new BitrateController(5000); // 5M bps, +10% = +500k bps
    // Força redução inicial
    controller.onSample({ lossPercent: 10, rttMs: 100 });
    controller.onSample({ lossPercent: 10, rttMs: 100 }); // Reduz para 3_750_000

    expect(controller.getCurrentBitrateBps()).toBe(3750000);

    // 4 amostras saudáveis -> ainda mantém
    for (let i = 0; i < 4; i++) {
      controller.onSample({ lossPercent: 0, rttMs: 40 });
      expect(controller.getCurrentBitrateBps()).toBe(3750000);
    }

    // 5ª amostra saudável -> sobe +500k = 4_250_000
    const bitrate = controller.onSample({ lossPercent: 0, rttMs: 40 });
    expect(bitrate).toBe(4250000);
  });

  it('amostra intermediária só decrementa em 1 o contador de saudáveis (não o zera)', () => {
    const controller = new BitrateController(5000);
    controller.onSample({ lossPercent: 10, rttMs: 100 });
    controller.onSample({ lossPercent: 10, rttMs: 100 }); // 3_750_000

    // 4 saudáveis, 1 intermediária (RTT 200 ms) => contador 4 -> 3
    for (let i = 0; i < 4; i++) controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 2, rttMs: 200 });
    expect(controller.getCurrentBitrateBps()).toBe(3750000);

    // Precisa de mais 2 saudáveis (3 -> 5); a 1ª ainda não sobe, a 2ª sobe
    expect(controller.onSample({ lossPercent: 0, rttMs: 40 })).toBe(3750000);
    expect(controller.onSample({ lossPercent: 0, rttMs: 40 })).toBe(4250000);
  });

  it('amostra congestionada zera o progresso de saudáveis', () => {
    const controller = new BitrateController(5000);
    controller.onSample({ lossPercent: 10, rttMs: 100 });
    controller.onSample({ lossPercent: 10, rttMs: 100 }); // 3_750_000
    for (let i = 0; i < 4; i++) controller.onSample({ lossPercent: 0, rttMs: 40 });
    controller.onSample({ lossPercent: 10, rttMs: 100 }); // zera saudáveis

    // 4 saudáveis não bastam (precisaria de 5)
    for (let i = 0; i < 4; i++) controller.onSample({ lossPercent: 0, rttMs: 40 });
    expect(controller.getCurrentBitrateBps()).toBe(3750000);
  });

  it('contador de saudáveis nunca fica negativo', () => {
    const controller = new BitrateController(5000);
    controller.onSample({ lossPercent: 10, rttMs: 100 });
    controller.onSample({ lossPercent: 10, rttMs: 100 }); // 3_750_000
    for (let i = 0; i < 5; i++) controller.onSample({ lossPercent: 2, rttMs: 200 });
    for (let i = 0; i < 4; i++) controller.onSample({ lossPercent: 0, rttMs: 40 });
    expect(controller.getCurrentBitrateBps()).toBe(3750000);
    expect(controller.onSample({ lossPercent: 0, rttMs: 40 })).toBe(4250000);
  });

  it('não ultrapassa o teto do alvo configurado', () => {
    const controller = new BitrateController(5000);
    for (let i = 0; i < 15; i++) {
      controller.onSample({ lossPercent: 0, rttMs: 20 });
    }
    expect(controller.getCurrentBitrateBps()).toBe(5000000);
  });

  it('ignora amostras inválidas mantendo a taxa atual', () => {
    const controller = new BitrateController(5000);
    expect(controller.onSample({ lossPercent: -1, rttMs: 50 })).toBe(5000000);
    expect(controller.onSample({ lossPercent: undefined, rttMs: 50 })).toBe(5000000);
  });
});
