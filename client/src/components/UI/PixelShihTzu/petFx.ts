/**
 * petFx.ts — Efeitos do carinho em pixel art: uma mão que afaga a cabeça do Shitzu e
 * corações que sobem. Função pura (sem DOM): devolve as linhas do frame como texto, no mesmo
 * formato dos sprites (cada caractere = uma cor da paleta, '.' = transparente).
 *
 * O frame de efeitos tem a largura do sprite e `FX_PAD_TOP` linhas extras acima dele: o
 * sprite do Shitzu ocupa as últimas SPRITE_H linhas (a cabeça fica perto de y = FX_PAD_TOP + 5).
 */

import { SPRITE_H, SPRITE_W } from './spriteData';

export const FX_W = SPRITE_W;
/** Linhas extras acima do sprite do Shitzu (espaço para a mão e os corações). */
export const FX_PAD_TOP = 8;
export const FX_H = FX_PAD_TOP + SPRITE_H;

export const FX_PALETTE: Readonly<Record<string, string>> = {
  k: '#F2C9A0', // pele
  j: '#D9A57B', // sombra da pele
  b: '#7C5CD8', // manga
  p: '#F2708A', // coração
  q: '#FFC2CD', // brilho do coração
};

const HAND = ['..kkk..', '.kkkkk.', 'kkkkkkk', 'kkkkkkk', '.jjjjj.'] as const;
const HEART = ['.p.p.', 'pqppp', 'ppppp', '.ppp.', '..p..'] as const;

/** Vai e volta sobre a cabeça (8 passos por ciclo). */
const STROKE_DX = [0, 1, 2, 1, 0, -1, -2, -1] as const;
const STROKE_FPS = 16;
const HAND_X = 14;
const HAND_Y = 5;
/** Tempo (s) para a mão descer no início e subir no fim. */
const HAND_MOVE_SEC = 0.2;
const HAND_MOVE_PX = 5;

const HEART_PERIOD = 1.2;
const HEART_DELAY = 0.4;
const HEART_RISE = 11;
/** Corações nascem na região acima das costas/rabo e sobem; o último ciclo termina antes da mão sair. */
const HEARTS = [
  { x: 6, y: 13 },
  { x: 1, y: 11 },
  { x: 9, y: 12 },
] as const;
/** Não nasce coração novo quando faltam menos que isto (s) para o fim do carinho. */
const HEART_STOP_SEC = 0.5;

const stamp = (grid: string[][], art: readonly string[], x0: number, y0: number): void => {
  for (let y = 0; y < art.length; y++) {
    for (let x = 0; x < art[y].length; x++) {
      const ch = art[y][x];
      const gy = y0 + y;
      const gx = x0 + x;
      if (ch === '.' || gy < 0 || gy >= FX_H || gx < 0 || gx >= FX_W) continue;
      grid[gy][gx] = ch;
    }
  }
};

/**
 * @param t         segundos desde o início do carinho
 * @param remaining segundos até o carinho acabar (a mão sobe nos últimos instantes)
 */
export const renderPetFx = (t: number, remaining: number): string[] => {
  const grid = Array.from({ length: FX_H }, () => new Array<string>(FX_W).fill('.'));

  // Corações: ciclos escalonados subindo e sumindo no topo; param de nascer perto do fim
  if (remaining > HEART_STOP_SEC) {
    HEARTS.forEach((h, i) => {
      const local = t - i * HEART_DELAY;
      if (local < 0) return;
      const u = (local % HEART_PERIOD) / HEART_PERIOD;
      stamp(grid, HEART, h.x, h.y - Math.round(u * HEART_RISE));
    });
  }

  // Mão: desce, afaga de um lado para o outro e sobe no fim
  const enter = Math.max(0, 1 - t / HAND_MOVE_SEC);
  const leave = Math.max(0, 1 - remaining / HAND_MOVE_SEC);
  const lift = Math.ceil(Math.max(enter, leave) * HAND_MOVE_PX);
  const step = Math.floor(t * STROKE_FPS) % STROKE_DX.length;
  const x = HAND_X + STROKE_DX[step];
  const y = HAND_Y + (step % 2) - lift;

  // Manga: do topo do frame até o pulso
  for (let row = 0; row < y; row++) stamp(grid, ['bbb'], x + 2, row);
  stamp(grid, HAND, x, y);

  return grid.map((r) => r.join(''));
};
