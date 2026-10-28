/**
 * PixelShihTzu — mini Shih Tzu em pixel art (sprite feito no projeto, ver spriteData.ts).
 *
 * - `followCursor`: o mini passeia pela tela (portal em document.body, pointer-events: none)
 *   em direção ao cursor, parando a uma pequena distância dele. Em dispositivos touch
 *   segue o último toque. Sem movimento do cursor por `idleTimeoutMs`, ou com o mouse
 *   fora da janela / aba oculta / janela sem foco, ele senta (e depois dorme).
 * - sem `followCursor`: renderiza inline (mascote da marca) em loop numa `pose` fixa,
 *   com balão de fala opcional (`speech`).
 *
 * Desempenho: um único loop de requestAnimationFrame fora do ciclo de renderização do React;
 * o canvas só é redesenhado quando muda o frame e a posição só é escrita no DOM quando muda.
 */

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './PixelShihTzu.module.css';
import { CLIPS, SPRITE_H, SPRITE_W, type SpriteAnim } from './spriteData';
import { KIARA_PALETTE } from './kiaraPalette';
import { rowsToImageData } from './pixelRender';
import {
  DEFAULT_PET_CONFIG,
  createPetState,
  getPetFrame,
  stepPet,
  type PetConfig,
  type PetInput,
  type PetState,
} from './followerEngine';

export type PetStartCorner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/** Eventos (window) para o mascote reagir ao contexto, sem acoplar componentes. */
export const PET_LOOK_EVENT = 'kiara:pet-look';
export const PET_CELEBRATE_EVENT = 'kiara:pet-celebrate';

/** Faz o mascote "olhar" para um ponto (x em px de viewport) ou parar de olhar (null). */
export const petLookAt = (x: number | null): void => {
  window.dispatchEvent(new CustomEvent(PET_LOOK_EVENT, { detail: { x } }));
};

/** Faz o mascote comemorar (pulinho com o sprite existente). */
export const petCelebrate = (): void => {
  window.dispatchEvent(new Event(PET_CELEBRATE_EVENT));
};

/** Duração (ms) e altura (em pixels do sprite) do pulinho de comemoração. */
const CELEBRATE_MS = 900;
const CELEBRATE_HOP = 5;

/** Pose do modo inline: sentado respirando, andando no lugar (procurando) ou dormindo. */
export type PetPose = 'idle' | 'walk' | 'sleep';

export interface PixelShihTzuProps {
  /** Modo inline: animação em loop (padrão: idle). */
  pose?: PetPose;
  /** Modo inline: balão de fala acima do Shitzu. */
  speech?: string;
  /** Se true, passeia pela tela perseguindo o cursor (ou o último toque). */
  followCursor?: boolean;
  /** Escala inteira do sprite (1 pixel do sprite = `scale` pixels da tela). */
  scale?: number;
  /** Posição inicial (só com followCursor): canto da janela ou coordenadas em px. */
  startPosition?: PetStartCorner | { x: number; y: number };
  /** Tempo (ms) sem o cursor se mover até o Shitzu parar de perseguir. */
  idleTimeoutMs?: number;
  /** Velocidade máxima, em px/s. */
  speed?: number;
  /** Distância (px) ao cursor em que ele para. Padrão: derivada da escala. */
  stopDistance?: number;
  /** Tempo (ms) em idle até deitar para dormir. */
  sleepAfterMs?: number;
  /** z-index do modo followCursor. */
  zIndex?: number;
  /** Só com followCursor: ponto de luz quente atrás do mascote. */
  glow?: boolean;
  className?: string;
}

/** Margem (px) do canto da janela na posição inicial. */
const CORNER_MARGIN = 28;

// ── Cache de frames (ImageData 1x) ────────────────────────────────────────────
const frameCache = new Map<string, ImageData>();

const getFrameData = (ctx: CanvasRenderingContext2D, anim: SpriteAnim, frame: number): ImageData => {
  const key = `${anim}:${frame}`;
  const cached = frameCache.get(key);
  if (cached) return cached;

  const img = rowsToImageData(ctx, CLIPS[anim].frames[frame], SPRITE_W, SPRITE_H, KIARA_PALETTE);
  frameCache.set(key, img);
  return img;
};

const startXY = (
  start: NonNullable<PixelShihTzuProps['startPosition']>,
  w: number,
  h: number,
  vw: number,
  vh: number,
): { x: number; y: number } => {
  if (typeof start === 'object') return start;
  const left = CORNER_MARGIN + w / 2;
  const top = CORNER_MARGIN + h / 2;
  return {
    x: start.endsWith('left') ? left : vw - left,
    y: start.startsWith('top') ? top : vh - top,
  };
};

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const PixelShihTzu: React.FC<PixelShihTzuProps> = ({
  pose = 'idle',
  speech,
  followCursor = false,
  scale = 3,
  startPosition = 'bottom-right',
  idleTimeoutMs = DEFAULT_PET_CONFIG.idleTimeoutMs,
  speed = DEFAULT_PET_CONFIG.speed,
  stopDistance,
  sleepAfterMs = DEFAULT_PET_CONFIG.sleepAfterMs,
  zIndex = 90,
  glow = false,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(prefersReducedMotion);
  const intScale = Math.max(1, Math.round(scale));

  // Acompanha mudanças da preferência do sistema
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const startKey =
    typeof startPosition === 'object' ? `${startPosition.x},${startPosition.y}` : startPosition;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const w = SPRITE_W * intScale;
    const h = SPRITE_H * intScale;

    const draw = (anim: SpriteAnim, frame: number) => {
      ctx.putImageData(getFrameData(ctx, anim, frame), 0, 0);
    };

    const start = startXY(startPosition, w, h, window.innerWidth, window.innerHeight);

    // prefers-reduced-motion: pose estática, sem loop nem perseguição
    if (reduced) {
      draw(followCursor ? 'idle' : pose, 0);
      if (followCursor) {
        const x = Math.round((start.x - w / 2) / intScale) * intScale;
        const y = Math.round((start.y - h / 2) / intScale) * intScale;
        canvas.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        if (glowRef.current) glowRef.current.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      }
      return;
    }

    // Modo inline: só repete o clip da pose escolhida
    if (!followCursor) {
      const clip = CLIPS[pose];
      const t0 = performance.now();
      let id = 0;
      let last = -1;
      const loop = (t: number) => {
        id = requestAnimationFrame(loop);
        const frame = Math.floor(((t - t0) / 1000) * clip.fps) % clip.frames.length;
        if (frame !== last) {
          draw(pose, frame);
          last = frame;
        }
      };
      id = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(id);
    }

    const cfg: PetConfig = {
      ...DEFAULT_PET_CONFIG,
      speed,
      idleTimeoutMs,
      sleepAfterMs,
      stopDistance: stopDistance ?? w / 2 + 24,
    };

    const pet: PetState = createPetState(start.x, start.y);

    // Entrada do usuário (mutável, fora do React)
    const input: PetInput = { targetX: null, targetY: null, active: false };
    let lastMoveAt = -Infinity;
    let pointerInside = true;
    let rafId = 0;
    let lastT = 0;
    let lastAnim: SpriteAnim | null = null;
    let lastFrame = -1;
    let lastTransform = '';
    let lookX: number | null = null;
    let celebrateStart = -Infinity;

    const onLook = (e: Event) => {
      const x = (e as CustomEvent<{ x: number | null }>).detail?.x;
      lookX = typeof x === 'number' ? x : null;
    };
    const onCelebrate = () => {
      celebrateStart = performance.now();
    };

    const onPointer = (e: PointerEvent) => {
      input.targetX = e.clientX;
      input.targetY = e.clientY;
      lastMoveAt = performance.now();
      pointerInside = true;
    };
    const onLeave = () => {
      pointerInside = false;
    };
    const onVisibility = () => {
      if (document.hidden) {
        pointerInside = false;
      } else {
        lastT = 0; // evita um dt gigante ao voltar para a aba
      }
    };

    const tick = (t: number) => {
      rafId = requestAnimationFrame(tick);
      const dt = lastT === 0 ? 0 : Math.min(0.05, (t - lastT) / 1000);
      lastT = t;

      input.active =
        followCursor && pointerInside && !document.hidden && t - lastMoveAt < cfg.idleTimeoutMs;
      stepPet(pet, dt, input, cfg);
      // Olha para o cartão em hover quando está parado
      if (lookX !== null && pet.mode !== 'walk' && Math.abs(lookX - pet.x) > 4) {
        pet.facing = lookX > pet.x ? 1 : -1;
      }

      const { anim, frame } = getPetFrame(pet);
      if (anim !== lastAnim || frame !== lastFrame) {
        draw(anim, frame);
        lastAnim = anim;
        lastFrame = frame;
      }

      if (followCursor) {
        // Mantém dentro da janela (também cobre resize)
        const maxX = Math.max(w / 2, window.innerWidth - w / 2);
        const maxY = Math.max(h / 2, window.innerHeight - h / 2);
        pet.x = Math.min(maxX, Math.max(w / 2, pet.x));
        pet.y = Math.min(maxY, Math.max(h / 2, pet.y));
        // Pixel perfeito: posição sempre em múltiplos da escala
        const px = Math.round((pet.x - w / 2) / intScale) * intScale;
        let py = Math.round((pet.y - h / 2) / intScale) * intScale;
        // Comemoração: pulinhos só com transform (em múltiplos da escala)
        const ce = t - celebrateStart;
        if (ce >= 0 && ce < CELEBRATE_MS) {
          const hop = Math.abs(Math.sin((ce / CELEBRATE_MS) * Math.PI * 3));
          py -= Math.round(hop * CELEBRATE_HOP) * intScale;
        }
        const transform = `translate3d(${px}px, ${py}px, 0) scaleX(${pet.facing})`;
        if (transform !== lastTransform) {
          canvas.style.transform = transform;
          if (glowRef.current) glowRef.current.style.transform = `translate3d(${px}px, ${py}px, 0)`;
          lastTransform = transform;
        }
      }
    };

    if (followCursor) {
      window.addEventListener('pointermove', onPointer, { passive: true });
      window.addEventListener('pointerdown', onPointer, { passive: true });
      document.documentElement.addEventListener('mouseleave', onLeave);
      window.addEventListener('blur', onLeave);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener(PET_LOOK_EVENT, onLook);
      window.addEventListener(PET_CELEBRATE_EVENT, onCelebrate);
    }
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('pointerdown', onPointer);
      document.documentElement.removeEventListener('mouseleave', onLeave);
      window.removeEventListener('blur', onLeave);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(PET_LOOK_EVENT, onLook);
      window.removeEventListener(PET_CELEBRATE_EVENT, onCelebrate);
    };
    // startPosition é representado por startKey (evita reiniciar com objetos novos a cada render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followCursor, pose, intScale, startKey, idleTimeoutMs, speed, stopDistance, sleepAfterMs, reduced]);

  const canvas = (
    <canvas
      ref={canvasRef}
      className={followCursor ? `${styles.floating} ${className}` : styles.sprite}
      style={{
        width: SPRITE_W * intScale,
        height: SPRITE_H * intScale,
        ...(followCursor ? { zIndex } : null),
      }}
      width={SPRITE_W}
      height={SPRITE_H}
      aria-hidden="true"
    />
  );

  if (followCursor) {
    return createPortal(
      <>
        {glow && !reduced && (
          <div
            ref={glowRef}
            className={styles.glow}
            style={{
              width: SPRITE_W * intScale,
              height: SPRITE_H * intScale,
              zIndex: zIndex - 1,
            }}
            aria-hidden="true"
          />
        )}
        {canvas}
      </>,
      document.body,
    );
  }

  return (
    <div className={`${styles.inline} ${className}`}>
      {speech && <div className={styles.speechBubble}>{speech}</div>}
      {canvas}
    </div>
  );
};

export default PixelShihTzu;
