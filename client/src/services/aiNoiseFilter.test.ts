import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AiNoiseFilter, createNoiseFilter } from './aiNoiseFilter';
import { installWebAudioFakes } from '../test/webAudioFakes';

describe('AiNoiseFilter', () => {
  let restoreWebAudio: () => void;
  let audioCtx: AudioContext;

  beforeEach(() => {
    restoreWebAudio = installWebAudioFakes();
    audioCtx = new AudioContext();
  });

  afterEach(() => {
    restoreWebAudio();
  });

  it('instancia o filtro e disponibiliza nós de entrada e saída', () => {
    const filter = createNoiseFilter(audioCtx, { highPassHz: 100 });
    expect(filter.input).toBeDefined();
    expect(filter.output).toBeDefined();
    expect(filter.active).toBe(true);
  });

  it('permite alternar estado ativado/desativado dinamicamente', () => {
    const filter = new AiNoiseFilter(audioCtx);
    expect(filter.active).toBe(true);

    filter.setEnabled(false);
    expect(filter.active).toBe(false);

    filter.setEnabled(true);
    expect(filter.active).toBe(true);
  });
});
