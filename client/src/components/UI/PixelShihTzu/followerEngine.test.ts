import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PET_CONFIG,
  createPetState,
  getPetFrame,
  petPet,
  stepPet,
  type PetInput,
  type PetState,
} from './followerEngine';
import { FX_H, FX_PAD_TOP, FX_PALETTE, FX_W, renderPetFx } from './petFx';
import { CLIPS, PALETTE, SPRITE_H, SPRITE_W, type SpriteAnim } from './spriteData';

const cfg = DEFAULT_PET_CONFIG;
const DT = 1 / 60;

const run = (pet: PetState, input: PetInput, seconds: number): void => {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepPet(pet, DT, input, cfg);
};

describe('spriteData', () => {
  it('todos os frames têm o tamanho certo e só usam cores da paleta', () => {
    for (const [name, clip] of Object.entries(CLIPS)) {
      expect(clip.frames.length, name).toBeGreaterThan(0);
      for (const frame of clip.frames) {
        expect(frame).toHaveLength(SPRITE_H);
        for (const row of frame) {
          expect(row).toHaveLength(SPRITE_W);
          for (const ch of row) expect(ch === '.' || ch in PALETTE).toBe(true);
        }
      }
    }
  });

  it('usa paleta reduzida (até 10 cores)', () => {
    expect(Object.keys(PALETTE).length).toBeLessThanOrEqual(10);
  });

  it('sitDown termina na pose base do idle (transição suave)', () => {
    const sit = CLIPS.sitDown.frames;
    expect(sit[sit.length - 1]).toEqual(CLIPS.idle.frames[0]);
    expect(sit[0]).toEqual(CLIPS.walk.frames[0]);
  });
});

describe('followerEngine', () => {
  it('persegue o cursor e para a uma distância segura, sem sobrepor', () => {
    const pet = createPetState(100, 100);
    const input: PetInput = { targetX: 700, targetY: 100, active: true };
    run(pet, input, 6);
    const dist = Math.hypot(700 - pet.x, 100 - pet.y);
    expect(dist).toBeGreaterThanOrEqual(cfg.stopDistance - 1);
    expect(dist).toBeLessThanOrEqual(cfg.stopDistance + cfg.resumeMargin);
    expect(['settle', 'sit']).toContain(pet.mode);
  });

  it('respeita a velocidade máxima', () => {
    const pet = createPetState(0, 0);
    const input: PetInput = { targetX: 5000, targetY: 0, active: true };
    let max = 0;
    for (let i = 0; i < 300; i++) {
      stepPet(pet, DT, input, cfg);
      max = Math.max(max, Math.hypot(pet.vx, pet.vy));
    }
    expect(max).toBeLessThanOrEqual(cfg.speed + 0.001);
    expect(max).toBeGreaterThan(cfg.speed * 0.9);
  });

  it('vira o sprite conforme a direção', () => {
    const right = createPetState(500, 300);
    run(right, { targetX: 1000, targetY: 300, active: true }, 1);
    expect(right.facing).toBe(1);

    const left = createPetState(500, 300);
    run(left, { targetX: 0, targetY: 300, active: true }, 1);
    expect(left.facing).toBe(-1);
  });

  it('inativo (cursor parado/fora da janela): para de andar e vai para o idle', () => {
    const pet = createPetState(100, 100);
    run(pet, { targetX: 900, targetY: 100, active: true }, 1);
    expect(pet.mode).toMatch(/walk|rise/);
    const xAtStop = pet.x;

    run(pet, { targetX: 900, targetY: 100, active: false }, 2);
    expect(pet.mode).toBe('sit');
    expect(getPetFrame(pet).anim).toBe('idle');
    expect(pet.x - xAtStop).toBeLessThan(80); // só o freio, sem continuar a perseguição
  });

  it('dorme após ficar muito tempo em idle e acorda ao retomar a perseguição', () => {
    const pet = createPetState(100, 100);
    run(pet, { targetX: null, targetY: null, active: false }, cfg.sleepAfterMs / 1000 + 1);
    expect(pet.mode).toBe('sleep');
    expect(getPetFrame(pet).anim).toBe('sleep');

    const x0 = pet.x;
    run(pet, { targetX: 800, targetY: 100, active: true }, 3);
    expect(pet.x).toBeGreaterThan(x0 + 100);
    expect(pet.mode).not.toBe('sleep');
  });

  it('retoma a perseguição quando o mouse volta a se mover', () => {
    const pet = createPetState(100, 100);
    run(pet, { targetX: 400, targetY: 100, active: true }, 4);
    run(pet, { targetX: 400, targetY: 100, active: false }, 1);
    const x0 = pet.x;
    run(pet, { targetX: 900, targetY: 100, active: true }, 2);
    expect(pet.x).toBeGreaterThan(x0 + 50);
  });

  it('interromper a transição no meio reverte sem pular frames', () => {
    const pet = createPetState(100, 100);
    pet.mode = 'settle';
    pet.sitProgress = 0;
    stepPet(pet, 0.25, { targetX: null, targetY: null, active: false }, cfg);
    const mid = pet.sitProgress;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    stepPet(pet, DT, { targetX: 900, targetY: 100, active: true }, cfg);
    expect(pet.mode).toBe('rise');
    expect(Math.abs(pet.sitProgress - mid)).toBeLessThan(0.1);
  });

  it('carinho: entra em petted, renova com novos cliques e volta a sentar sozinho', () => {
    const idleInput: PetInput = { targetX: null, targetY: null, active: false };
    const pet = createPetState(100, 100);
    petPet(pet);
    expect(pet.mode).toBe('petted');
    expect(getPetFrame(pet).anim).toBe('petted');

    run(pet, idleInput, cfg.pettedSec - 0.5);
    petPet(pet); // novo clique renova o tempo sem reiniciar a animação
    expect(pet.mode).toBe('petted');
    expect(pet.modeTime).toBe(0);
    expect(pet.animTime).toBeGreaterThan(1);

    run(pet, idleInput, cfg.pettedSec - 0.5);
    expect(pet.mode).toBe('petted');
    run(pet, idleInput, 1);
    expect(pet.mode).toBe('sit');
  });

  it('carinho: para um Shitzu em movimento e levanta quando o cursor se afasta', () => {
    const pet = createPetState(100, 100);
    run(pet, { targetX: 900, targetY: 100, active: true }, 0.5);
    expect(pet.mode).toMatch(/walk|rise/);

    petPet(pet);
    expect(pet.mode).toBe('petted');
    expect(pet.vx).toBe(0);

    // cursor em cima dele: continua recebendo carinho
    run(pet, { targetX: pet.x + 10, targetY: pet.y, active: true }, 0.5);
    expect(pet.mode).toBe('petted');

    // cursor longe: levanta e volta a perseguir
    run(pet, { targetX: pet.x + 600, targetY: pet.y, active: true }, 2);
    expect(pet.mode).toMatch(/walk|rise/);
  });

  it('getPetFrame sempre devolve um frame existente', () => {
    const pet = createPetState(100, 100);
    for (let i = 0; i < 2000; i++) {
      const active = Math.floor(i / 250) % 2 === 0;
      stepPet(pet, DT, { targetX: 50 + (i % 600), targetY: 200, active }, cfg);
      const { anim, frame } = getPetFrame(pet);
      const clip = CLIPS[anim as SpriteAnim];
      expect(frame).toBeGreaterThanOrEqual(0);
      expect(frame).toBeLessThan(clip.frames.length);
    }
  });

  it('getPetFrame no carinho nunca sai dos frames do clip petted', () => {
    const pet = createPetState(100, 100);
    petPet(pet);
    for (let i = 0; i < 300; i++) {
      stepPet(pet, DT, { targetX: null, targetY: null, active: false }, cfg);
      const { anim, frame } = getPetFrame(pet);
      if (pet.mode === 'petted') expect(anim).toBe('petted');
      expect(frame).toBeLessThan(CLIPS[anim as SpriteAnim].frames.length);
    }
  });
});

describe('petFx', () => {
  it('todos os frames têm o tamanho certo e só usam cores da paleta de efeitos', () => {
    for (let t = 0; t < cfg.pettedSec; t += 0.05) {
      const rows = renderPetFx(t, cfg.pettedSec - t);
      expect(rows).toHaveLength(FX_H);
      for (const row of rows) {
        expect(row).toHaveLength(FX_W);
        for (const ch of row) expect(ch === '.' || ch in FX_PALETTE).toBe(true);
      }
    }
  });

  it('mão e corações aparecem durante o carinho, a mão fica sobre a cabeça e sobe no fim', () => {
    const rows = renderPetFx(1, 1.4);
    const rowsWith = (ch: string) => rows.flatMap((r, y) => (r.includes(ch) ? [y] : []));
    expect(rowsWith('k').length).toBeGreaterThan(0);
    expect(rowsWith('p').length).toBeGreaterThan(0);
    // a mão nunca desce até os pés do sprite
    expect(Math.max(...rowsWith('k'))).toBeLessThan(FX_PAD_TOP + 10);

    // no instante final os corações param de nascer e a mão está mais alta que durante o afago
    const ending = renderPetFx(cfg.pettedSec - 0.05, 0.05);
    expect(ending.join('')).not.toContain('p');
    const handBottom = (r: string[]) =>
      Math.max(...r.flatMap((l, y) => (l.includes('j') ? [y] : [])));
    expect(handBottom(ending)).toBeLessThan(handBottom(rows));
  });
});
