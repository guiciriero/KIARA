import React, { useState } from 'react';
import type { StreamStats } from '@shared/index';
import type { StatsSample } from '../../utils/statsHistory';
import { IconActivity } from './Icons';
import Sparkline from './Sparkline';
import styles from './StatsOverlay.module.css';

interface Props {
  stats: StreamStats;
  /** FPS-alvo configurado (para mostrar % de atingimento) */
  targetFps?: number;
  /** Últimos 30 s de amostras (ver `useStatsHistory`); sem isso os gráficos não aparecem */
  history?: readonly StatsSample[];
}

const QUALITY_CONFIG: Record<
  StreamStats['connectionQuality'],
  { label: string; color: string; bg: string }
> = {
  excellent: { label: 'Excelente', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)' },
  good:      { label: 'Boa',       color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)' },
  fair:      { label: 'Oscilando', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.15)' },
  poor:      { label: 'Instável',  color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.15)' },
};

const LIMIT_LABELS: Record<StreamStats['qualityLimitation'], string | null> = {
  none: null,
  cpu: 'CPU',
  bandwidth: 'Rede',
  other: 'Outro',
};

function fpsColor(fps: number, target: number): string {
  if (fps >= target * 0.93) return '#10b981'; // ≥ 93% do alvo → verde
  if (fps >= target * 0.75) return '#f59e0b'; // ≥ 75% → amarelo
  return '#f43f5e';                            // < 75% → vermelho
}

const StatsOverlay: React.FC<Props> = ({ stats, targetFps = 60, history }) => {
  const [minimized, setMinimized] = useState(false);
  const quality = QUALITY_CONFIG[stats.connectionQuality] || QUALITY_CONFIG.good;
  const limitation = LIMIT_LABELS[stats.qualityLimitation];

  if (minimized) {
    return (
      <button
        type="button"
        className={styles.minimizedBtn}
        onClick={() => setMinimized(false)}
        title="Mostrar estatísticas de transmissão"
        aria-label="Abrir estatísticas da transmissão"
      >
        <IconActivity size={14} />
        <span style={{ color: fpsColor(stats.fps, targetFps) }}>{stats.fps} FPS</span>
        <span>·</span>
        <span style={{ color: stats.latencyMs < 100 ? '#10b981' : '#f59e0b' }}>{stats.latencyMs}ms</span>
        {stats.lossPercent > 0 && <span style={{ color: '#f43f5e' }}>·{stats.lossPercent.toFixed(1)}%↓</span>}
      </button>
    );
  }

  const resLabel = stats.encodedWidth && stats.encodedHeight
    ? `${stats.encodedWidth}×${stats.encodedHeight}`
    : null;

  return (
    <div className={styles.overlay} role="region" aria-label="Telemetria da transmissão">
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <IconActivity size={15} className={styles.titleIcon} />
          <span className={styles.title}>Telemetria KIARA</span>
        </div>
        <div className={styles.headerActions}>
          {limitation && (
            <div className={styles.qualityPill} style={{ background: 'rgba(244,63,94,0.15)', color: '#f43f5e' }}>
              <span className={styles.dot} style={{ background: '#f43f5e' }} />
              <span>Limitado: {limitation}</span>
            </div>
          )}
          <div className={styles.qualityPill} style={{ background: quality.bg, color: quality.color }}>
            <span className={styles.dot} style={{ background: quality.color }} />
            <span>{quality.label}</span>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            onClick={() => setMinimized(true)}
            title="Minimizar HUD"
            aria-label="Minimizar HUD"
          >
            ×
          </button>
        </div>
      </div>

      <div className={styles.grid}>
        {/* FPS com cor baseada no atingimento do alvo */}
        <div className={styles.metric}>
          <span className={styles.label}>Taxa de Quadros</span>
          <span className={styles.value} style={{ color: fpsColor(stats.fps, targetFps) }}>
            {stats.fps} <small>/ {targetFps} FPS</small>
          </span>
        </div>

        {/* Resolução efetiva codificada */}
        {resLabel && (
          <div className={styles.metric}>
            <span className={styles.label}>Resolução Codificada</span>
            <span className={styles.value}>{resLabel}</span>
          </div>
        )}

        <div className={styles.metric}>
          <span className={styles.label}>Vídeo</span>
          <span className={styles.value}>
            {(stats.videoBitrate / 1000).toFixed(1)} <small>Mbps</small>
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Áudio</span>
          <span className={styles.value}>{stats.audioBitrate} <small>kbps</small></span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Latência RTT</span>
          <span className={styles.value} style={{ color: stats.latencyMs < 100 ? '#10b981' : '#f59e0b' }}>
            {stats.latencyMs} <small>ms</small>
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Perda de Pacotes</span>
          <span className={styles.value} style={{ color: stats.lossPercent > 2 ? '#f43f5e' : '#10b981' }}>
            {stats.lossPercent.toFixed(1)} <small>%</small>
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Jitter</span>
          <span className={styles.value} style={{ color: stats.jitterMs > 30 ? '#f59e0b' : undefined }}>
            {stats.jitterMs} <small>ms</small>
          </span>
        </div>

        {/* Frames descartados (encoder ou rede) */}
        {stats.framesDropped !== undefined && (
          <div className={styles.metric}>
            <span className={styles.label}>Frames Descartados</span>
            <span className={styles.value} style={{ color: stats.framesDropped > 0 ? '#f59e0b' : undefined }}>
              {stats.framesDropped}
            </span>
          </div>
        )}

        {/* Frames perdidos (receptor) */}
        {stats.framesLost !== undefined && (
          <div className={styles.metric}>
            <span className={styles.label}>Frames Perdidos (RX)</span>
            <span className={styles.value} style={{ color: stats.framesLost > 0 ? '#f59e0b' : undefined }}>
              {stats.framesLost}
            </span>
          </div>
        )}

        {/* Tempo de decodificação */}
        {stats.decodeTimeMs !== undefined && (
          <div className={styles.metric}>
            <span className={styles.label}>Decode (avg / P95)</span>
            <span className={styles.value}>
              {stats.decodeTimeMs.toFixed(1)}
              {stats.decodeTimeP95Ms !== undefined ? ` / ${stats.decodeTimeP95Ms.toFixed(1)}` : ''}
              <small> ms</small>
            </span>
          </div>
        )}
      </div>

      {history && (
        <div className={styles.charts} aria-label="Histórico dos últimos 30 segundos">
          <Sparkline
            label="Latência RTT"
            unit="ms"
            values={history.map((s) => s.latencyMs)}
            times={history.map((s) => s.t)}
            scaleMax={100}
            reference={100}
            referenceLabel="limite recomendado"
            color={stats.latencyMs < 100 ? '#10b981' : '#f59e0b'}
          />
          <Sparkline
            label="FPS real"
            unit={`/ ${targetFps}`}
            values={history.map((s) => s.fps)}
            times={history.map((s) => s.t)}
            scaleMax={targetFps}
            reference={targetFps}
            referenceLabel="FPS nominal"
            color={fpsColor(stats.fps, targetFps)}
          />
          <Sparkline
            label="Bitrate"
            unit="Mbps"
            values={history.map((s) => s.videoBitrate / 1000)}
            times={history.map((s) => s.t)}
            scaleMax={1}
            color="#60a5fa"
            decimals={1}
          />
          <Sparkline
            label="Perda"
            unit="%"
            values={history.map((s) => s.lossPercent)}
            times={history.map((s) => s.t)}
            scaleMax={5}
            reference={2}
            referenceLabel="limite de alerta"
            color={stats.lossPercent > 2 ? '#f43f5e' : '#10b981'}
            decimals={1}
          />
        </div>
      )}
    </div>
  );
};

export default StatsOverlay;
