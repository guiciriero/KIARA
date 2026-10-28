/**
 * followerEngine.ts — Lógica pura (sem DOM) do mini Shih Tzu que persegue o cursor.
 *
 * Máquina de estados:
 *   walk   → andando até o alvo (clip "walk")
 *   settle → sentando (clip "sitDown" para frente)
 *   sit    → sentado em idle (clip "idle")
 *   sleep  → deitado dormindo (clip "sleep"), após ficar muito tempo parado
 *   petted → recebendo carinho (clip "petted"), disparado por `petPet`; cada novo clique renova
 *   rise   → levantando (clip "sitDown" ao contrário) antes de voltar a andar
 *
 * Settle e rise compartilham `sitProgress` (0 = em pé, 1 = sentado), então interromper
 * uma transição no meio reverte a animação a partir do frame atual (transição suave).
 */

import { CLIPS, type SpriteAnim } from './spriteData';

export interface PetConfig {
  /** Velocidade máxima em px/s. */
  speed: number;
  /** Distância (px) do centro do sprite ao cursor em que ele para. */
  stopDistance: number;
  /** Folga extra (px) além de stopDistance para voltar a andar (evita tremedeira). */
  resumeMargin: number;
  /** Tempo (ms) sem o cursor se mover para o Shitzu parar de perseguir e ir para o idle. */
  idleTimeoutMs: number;
  /** Tempo (ms) sentado, sem atividade, até deitar para dormir. */
  sleepAfterMs: number;
  /** Duração (s) da transição em pé ↔ sentado. */
  transitionSec: number;
  /** Duração (s) do carinho depois do último clique. */
  pettedSec: number;
}

export const DEFAULT_PET_CONFIG: Readonly<PetConfig> = {
  speed: 260,
  stopDistance: 56,
  resumeMargin: 20,
  idleTimeoutMs: 4000,
  sleepAfterMs: 6000,
  transitionSec: 0.5,
  pettedSec: 2.4,
};

export type PetMode = 'walk' | 'settle' | 'rise' | 'sit' | 'sleep' | 'petted';

export interface PetState {
  /** Centro do sprite, em px de viewport. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 1 = olhando para a direita, -1 = para a esquerda. */
  facing: 1 | -1;
  mode: PetMode;
  /** 0 = em pé, 1 = sentado. */
  sitProgress: number;
  /** Segundos no modo atual (reiniciado enquanto há atividade em sit/sleep). */
  modeTime: number;
  /** Tempo de animação (s) do clip em loop. */
  animTime: number;
}

export interface PetInput {
  targetX: number | null;
  targetY: number | null;
  /** false quando o cursor ficou parado/saiu da janela: o Shitzu não persegue. */
  active: boolean;
}

export interface PetFrame {
  anim: SpriteAnim;
  frame: number;
}

/** Tolerância (px) de chegada enquanto anda, para não "rastejar" assintoticamente. */
const ARRIVAL_TOLERANCE = 4;
/** Velocidade (px/s) abaixo da qual o Shitzu é considerado parado. */
const STOP_SPEED = 12;
/** Ganho do freio: velocidade desejada = distância restante × ganho. */
const BRAKE_GAIN = 4;
/** Suavização da velocidade (1/s). */
const VELOCITY_SMOOTHING = 10;

export const createPetState = (x: number, y: number): PetState => ({
  x,
  y,
  vx: 0,
  vy: 0,
  facing: 1,
  mode: 'sit',
  sitProgress: 1,
  modeTime: 0,
  animTime: 0,
});

const setMode = (s: PetState, mode: PetMode): void => {
  s.mode = mode;
  s.modeTime = 0;
  if (mode === 'walk' || mode === 'sit' || mode === 'sleep' || mode === 'petted') s.animTime = 0;
};

/**
 * Registra um carinho (clique no Shitzu): ele para, senta e entra em "petted".
 * Se já está recebendo carinho, só renova o tempo (a animação continua sem reiniciar).
 */
export const petPet = (s: PetState): void => {
  if (s.mode === 'petted') {
    s.modeTime = 0;
    return;
  }
  s.vx = 0;
  s.vy = 0;
  s.sitProgress = 1;
  setMode(s, 'petted');
};

/** Avança a simulação em `dt` segundos. Muta `s`. */
export const stepPet = (
  s: PetState,
  dt: number,
  input: PetInput,
  cfg: Readonly<PetConfig>,
): void => {
  const hasTarget = input.active && input.targetX !== null && input.targetY !== null;
  let dx = 0;
  let dy = 0;
  let dist = 0;
  if (hasTarget) {
    dx = (input.targetX as number) - s.x;
    dy = (input.targetY as number) - s.y;
    dist = Math.hypot(dx, dy);
  }

  const threshold =
    s.mode === 'walk' ? cfg.stopDistance + ARRIVAL_TOLERANCE : cfg.stopDistance + cfg.resumeMargin;
  const wantMove = hasTarget && dist > threshold;

  s.modeTime += dt;
  s.animTime += dt;

  switch (s.mode) {
    case 'walk': {
      let desired = 0;
      if (wantMove) desired = Math.min(cfg.speed, Math.max(0, dist - cfg.stopDistance) * BRAKE_GAIN);
      const ux = dist > 0 ? dx / dist : 0;
      const uy = dist > 0 ? dy / dist : 0;
      const k = 1 - Math.exp(-dt * VELOCITY_SMOOTHING);
      s.vx += (ux * desired - s.vx) * k;
      s.vy += (uy * desired - s.vy) * k;
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      const speed = Math.hypot(s.vx, s.vy);
      if (Math.abs(s.vx) > 4) s.facing = s.vx > 0 ? 1 : -1;
      // passos acompanham a velocidade, sem ficar lentos demais
      s.animTime += dt * (Math.max(0.5, Math.min(1, speed / cfg.speed)) - 1);

      if (!wantMove && speed < STOP_SPEED) {
        s.vx = 0;
        s.vy = 0;
        s.sitProgress = 0;
        setMode(s, 'settle');
      }
      break;
    }
    case 'settle': {
      s.sitProgress += dt / cfg.transitionSec;
      if (wantMove) {
        setMode(s, 'rise');
      } else if (s.sitProgress >= 1) {
        s.sitProgress = 1;
        setMode(s, 'sit');
      }
      break;
    }
    case 'rise': {
      s.sitProgress -= dt / cfg.transitionSec;
      if (!wantMove) {
        setMode(s, 'settle');
      } else if (s.sitProgress <= 0) {
        s.sitProgress = 0;
        setMode(s, 'walk');
      }
      break;
    }
    case 'sit': {
      if (wantMove) {
        s.sitProgress = 1;
        setMode(s, 'rise');
      } else if (hasTarget) {
        s.modeTime = 0; // ainda há atividade perto dele: não dorme
      } else if (s.modeTime * 1000 >= cfg.sleepAfterMs) {
        setMode(s, 'sleep');
      }
      break;
    }
    case 'sleep': {
      if (wantMove) {
        s.sitProgress = 1;
        setMode(s, 'rise');
      }
      break;
    }
    case 'petted': {
      if (wantMove) {
        s.sitProgress = 1;
        setMode(s, 'rise');
      } else if (s.modeTime >= cfg.pettedSec) {
        setMode(s, 'sit');
      }
      break;
    }
  }

  // Olha na direção do cursor mesmo parado
  if (s.mode !== 'walk' && hasTarget && Math.abs(dx) > 4) s.facing = dx > 0 ? 1 : -1;
};

/** Converte o estado atual no clip + índice de frame a desenhar. */
export const getPetFrame = (s: PetState): PetFrame => {
  const loopFrame = (anim: SpriteAnim): number => {
    const clip = CLIPS[anim];
    return Math.floor(s.animTime * clip.fps) % clip.frames.length;
  };

  switch (s.mode) {
    case 'walk':
      return { anim: 'walk', frame: loopFrame('walk') };
    case 'settle':
    case 'rise': {
      const last = CLIPS.sitDown.frames.length - 1;
      const p = Math.min(1, Math.max(0, s.sitProgress));
      return { anim: 'sitDown', frame: Math.round(p * last) };
    }
    case 'sleep':
      return { anim: 'sleep', frame: loopFrame('sleep') };
    case 'petted':
      return { anim: 'petted', frame: loopFrame('petted') };
    default:
      return { anim: 'idle', frame: loopFrame('idle') };
  }
};
