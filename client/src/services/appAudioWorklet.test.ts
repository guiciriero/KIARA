/**
 * appAudioWorklet.test.ts
 * Carrega public/app-audio-worklet.js num contexto `vm` com AudioWorkletProcessor,
 * registerProcessor e sampleRate simulados, e verifica o ring buffer:
 * pré-buffer, overflow (limite de latência) e underrun.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const SAMPLE_RATE = 1000; // capacity 500, target 80, max 200
const CAPACITY = 500;
const TARGET = 80;
const MAX = 200;

interface Processor {
  count: number;
  primed: boolean;
  capacity: number;
  write(pcm: Float32Array, frames: number): void;
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}

let ProcessorClass: new () => Processor;

beforeAll(() => {
  const source = readFileSync(resolve(__dirname, '../../public/app-audio-worklet.js'), 'utf8');
  const registered: Record<string, new () => Processor> = {};
  class FakeAudioWorkletProcessor {
    port: { onmessage: ((e: { data: unknown }) => void) | null } = { onmessage: null };
  }
  const context = vm.createContext({
    AudioWorkletProcessor: FakeAudioWorkletProcessor,
    registerProcessor: (name: string, cls: new () => Processor) => {
      registered[name] = cls;
    },
    sampleRate: SAMPLE_RATE,
  });
  // `class` declarada no script não vira propriedade do contexto; o registro é o canal de saída
  vm.runInContext(source, context);
  ProcessorClass = registered['app-audio-source-processor'];
});

/** PCM intercalado: L = valor, R = -valor, com valor crescente a partir de `start` */
function ramp(frames: number, start = 0): Float32Array {
  const pcm = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    pcm[i * 2] = (start + i) / 10000;
    pcm[i * 2 + 1] = -(start + i) / 10000;
  }
  return pcm;
}

function render(p: Processor, n = 128): { l: Float32Array; r: Float32Array } {
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  p.process([], [[l, r]]);
  return { l, r };
}

describe('app-audio-worklet', () => {
  it('registra o processador e calcula as capacidades a partir de sampleRate', () => {
    expect(ProcessorClass).toBeTypeOf('function');
    const p = new ProcessorClass();
    expect(p.capacity).toBe(CAPACITY);
  });

  it('mantém silêncio até atingir o pré-buffer (80 ms) e então toca', () => {
    const p = new ProcessorClass();
    p.write(ramp(TARGET - 1, 1), TARGET - 1);
    const silent = render(p, 16);
    expect(Array.from(silent.l).every((v) => v === 0)).toBe(true);
    expect(p.primed).toBe(false);

    p.write(ramp(1, 1000), 1);
    const played = render(p, 16);
    expect(p.primed).toBe(true);
    expect(played.l[0]).toBeCloseTo(1 / 10000, 6);
    expect(played.r[0]).toBeCloseTo(-1 / 10000, 6);
  });

  it('desintercala L/R corretamente', () => {
    const p = new ProcessorClass();
    p.write(ramp(TARGET, 5), TARGET);
    const { l, r } = render(p, 4);
    expect(l[3]).toBeCloseTo(8 / 10000, 6);
    expect(r[3]).toBeCloseTo(-8 / 10000, 6);
  });

  it('overflow: acima de 200 ms descarta o mais antigo e volta ao nível alvo', () => {
    const p = new ProcessorClass();
    p.write(ramp(MAX + 50, 0), MAX + 50);
    expect(p.count).toBe(TARGET);
    // Mantém os quadros mais recentes
    const { l } = render(p, 1);
    expect(l[0]).toBeCloseTo((MAX + 50 - TARGET) / 10000, 6);
  });

  it('bloco maior que o buffer fica só com o final e nunca excede a capacidade', () => {
    const p = new ProcessorClass();
    p.write(ramp(CAPACITY * 2, 0), CAPACITY * 2);
    expect(p.count).toBeLessThanOrEqual(CAPACITY);
    expect(p.count).toBe(TARGET);
  });

  it('underrun: completa com silêncio e re-arma o pré-buffer', () => {
    const p = new ProcessorClass();
    p.write(ramp(TARGET, 1), TARGET);
    render(p, TARGET); // consome tudo, ainda sem underrun
    expect(p.primed).toBe(true);

    const { l } = render(p, 32); // buffer vazio => underrun
    expect(Array.from(l).every((v) => v === 0)).toBe(true);
    expect(p.primed).toBe(false);

    // Dados abaixo do alvo continuam em silêncio até reencher o pré-buffer
    p.write(ramp(10, 1), 10);
    expect(Array.from(render(p, 8).l).every((v) => v === 0)).toBe(true);
  });

  it('wrap-around do ring buffer preserva a ordem', () => {
    const p = new ProcessorClass();
    let next = 0;
    const out: number[] = [];
    for (let round = 0; round < 12; round++) {
      p.write(ramp(100, next), 100);
      next += 100;
      const { l } = render(p, 100);
      out.push(...Array.from(l));
    }
    // Após o pré-buffer não pode haver retrocesso nos valores tocados (não-silêncio)
    const played = out.filter((v) => v !== 0);
    for (let i = 1; i < played.length; i++) expect(played[i]).toBeGreaterThanOrEqual(played[i - 1]);
  });
});
