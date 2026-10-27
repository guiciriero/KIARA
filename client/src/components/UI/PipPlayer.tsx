/**
 * PipPlayer.tsx
 * Conteúdo da janela flutuante (Document Picture-in-Picture): vídeo da transmissão com volume,
 * tela cheia e estatísticas. É renderizado por portal dentro do documento da janela flutuante.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { StreamStats } from '@shared/index';
import { togglePipFullscreen, type PipExpandMemory, type PipWindowLike } from '../../utils/documentPip';
import { formatPipStats } from '../../utils/pipStats';
import {
  IconActivity,
  IconExitFullscreen,
  IconFullscreen,
  IconPictureInPicture,
  IconVolumeHigh,
  IconVolumeMute,
} from './Icons';
import styles from './PipPlayer.module.css';

interface PipPlayerProps {
  pipWindow: Window;
  stream: MediaStream | null;
  muted: boolean;
  /** 0 a 1 */
  volume: number;
  stats: StreamStats | null;
  targetFps: number;
  onToggleMute: () => void;
  onVolumeChange: (volume: number) => void;
  /** Fecha a janela flutuante e devolve o vídeo para a página */
  onClose: () => void;
}

const PipPlayer: React.FC<PipPlayerProps> = ({
  pipWindow,
  stream,
  muted,
  volume,
  stats,
  targetFps,
  onToggleMute,
  onVolumeChange,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const memoryRef = useRef<PipExpandMemory>({});
  const [expanded, setExpanded] = useState(false);
  const [showStats, setShowStats] = useState(false);

  // Liga a transmissão ao <video> da janela flutuante
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !stream) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    video.play().catch((err) => {
      if ((err as Error)?.name !== 'AbortError') console.warn('[KIARA] PiP: falha ao reproduzir:', err);
    });
  }, [stream]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = volume;
  }, [volume]);

  const handleToggleFullscreen = React.useCallback(async () => {
    try {
      const result = await togglePipFullscreen(pipWindow as unknown as PipWindowLike, memoryRef.current);
      setExpanded(result === 'fullscreen' || result === 'expanded');
    } catch (err) {
      console.warn('[KIARA] PiP: erro ao alternar tela cheia:', err);
    }
  }, [pipWindow]);

  // Sai da tela cheia por Esc (o navegador avisa por fullscreenchange)
  useEffect(() => {
    const doc = pipWindow.document;
    const sync = () => {
      if (!doc.fullscreenElement && !memoryRef.current.previous) setExpanded(false);
    };
    doc.addEventListener('fullscreenchange', sync);
    return () => doc.removeEventListener('fullscreenchange', sync);
  }, [pipWindow]);

  // Atalhos dentro da janela flutuante: M = mutar, F = tela cheia
  const shortcutsRef = useRef({ mute: onToggleMute, fullscreen: handleToggleFullscreen });
  shortcutsRef.current = { mute: onToggleMute, fullscreen: handleToggleFullscreen };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      const key = e.key.toLowerCase();
      if (key === 'm') {
        e.preventDefault();
        shortcutsRef.current.mute();
      } else if (key === 'f') {
        e.preventDefault();
        void shortcutsRef.current.fullscreen();
      }
    };
    pipWindow.addEventListener('keydown', onKey);
    return () => pipWindow.removeEventListener('keydown', onKey);
  }, [pipWindow]);

  const items = useMemo(() => (stats ? formatPipStats(stats, targetFps) : []), [stats, targetFps]);
  const silent = muted || volume === 0;

  return createPortal(
    <div className={styles.root}>
      <video
        ref={videoRef}
        className={styles.video}
        autoPlay
        playsInline
        muted={muted}
        onDoubleClick={() => void handleToggleFullscreen()}
      />

      {showStats && (
        <dl className={styles.stats} aria-label="Estatísticas da transmissão">
          {items.length === 0 && <div className={styles.statsEmpty}>Aguardando dados…</div>}
          {items.map((item) => (
            <div key={item.label} className={styles.stat}>
              <dt>{item.label}</dt>
              <dd className={styles[item.tone]}>{item.value}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.btn}
          onClick={onToggleMute}
          title={muted ? 'Desmutar áudio (M)' : 'Mutar áudio (M)'}
          aria-label={muted ? 'Desmutar áudio' : 'Mutar áudio'}
        >
          {silent ? <IconVolumeMute size={18} /> : <IconVolumeHigh size={18} />}
        </button>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={muted ? 0 : volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className={styles.slider}
          aria-label="Volume da transmissão"
        />
        <span className={styles.spacer} />
        <button
          type="button"
          className={`${styles.btn} ${showStats ? styles.active : ''}`}
          onClick={() => setShowStats((v) => !v)}
          title="Estatísticas"
          aria-label="Mostrar estatísticas da transmissão"
          aria-pressed={showStats}
        >
          <IconActivity size={18} />
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={() => void handleToggleFullscreen()}
          title={expanded ? 'Sair da tela cheia (F)' : 'Tela cheia (F)'}
          aria-label={expanded ? 'Sair da tela cheia' : 'Tela cheia'}
        >
          {expanded ? <IconExitFullscreen size={18} /> : <IconFullscreen size={18} />}
        </button>
        <button
          type="button"
          className={styles.btn}
          onClick={onClose}
          title="Voltar para a página"
          aria-label="Fechar janela flutuante e voltar para a página"
        >
          <IconPictureInPicture size={18} />
        </button>
      </div>
    </div>,
    pipWindow.document.body,
  );
};

export default PipPlayer;
