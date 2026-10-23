/**
 * LiveScene — cena em pixel art exibida no cabeçalho do estúdio durante a transmissão:
 * o Shih Tzu pedala uma bicicleta que manda energia para um computador CRT com "LIVE ON".
 * Frames em liveSceneData.ts; mesmo princípio do PixelShihTzu (canvas nativo + escala inteira).
 * Respeita prefers-reduced-motion (frame estático) e não captura cliques.
 */

import React, { useEffect, useRef } from 'react';
import styles from './PixelShihTzu.module.css';
import { rowsToImageData } from './pixelRender';
import { SCENE_FPS, SCENE_FRAMES, SCENE_H, SCENE_PALETTE, SCENE_W } from './liveSceneData';

export interface LiveSceneProps {
  /** Escala inteira (1 pixel do sprite = `scale` pixels da tela). */
  scale?: number;
  className?: string;
}

export const LiveScene: React.FC<LiveSceneProps> = ({ scale = 2, className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const intScale = Math.max(1, Math.round(scale));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const images = SCENE_FRAMES.map((rows) =>
      rowsToImageData(ctx, rows, SCENE_W, SCENE_H, SCENE_PALETTE),
    );
    ctx.putImageData(images[0], 0, 0);

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.matches) return;

    const t0 = performance.now();
    let last = 0;
    let id = 0;
    const loop = (t: number) => {
      id = requestAnimationFrame(loop);
      const frame = Math.floor(((t - t0) / 1000) * SCENE_FPS) % images.length;
      if (frame !== last) {
        ctx.putImageData(images[frame], 0, 0);
        last = frame;
      }
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`${styles.liveScene} ${className}`}
      role="img"
      aria-label="Ao vivo: o Shih Tzu pedala e manda energia para o computador"
    >
      <canvas
        ref={canvasRef}
        className={styles.sprite}
        style={{ width: SCENE_W * intScale, height: SCENE_H * intScale }}
        width={SCENE_W}
        height={SCENE_H}
        aria-hidden="true"
      />
    </div>
  );
};

export default LiveScene;
