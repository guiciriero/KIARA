import { useEffect, useRef } from 'react';
import styles from './LowLatencyCanvas.module.css';

interface LowLatencyCanvasProps {
  /** Canvas criado pelo LowLatencyRenderer; o controle de desenho pertence ao worker */
  canvas: HTMLCanvasElement;
  /** Mesmo enquadramento "preencher tela" do <video> */
  cover: boolean;
}

/** Monta o canvas do modo baixa latência por cima do <video> (que segue tocando o áudio) */
export default function LowLatencyCanvas({ canvas, cover }: LowLatencyCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    host.appendChild(canvas);
    return () => {
      if (canvas.parentNode === host) host.removeChild(canvas);
    };
  }, [canvas]);

  useEffect(() => {
    canvas.className = `${styles.canvas} ${cover ? styles.cover : ''}`;
    canvas.setAttribute('aria-hidden', 'true');
  }, [canvas, cover]);

  return <div ref={hostRef} className={styles.host} data-testid="low-latency-canvas" />;
}
