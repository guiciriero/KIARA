import React from 'react';
import { buildSparkline, summarize, HISTORY_WINDOW_MS } from '../../utils/statsHistory';
import styles from './Sparkline.module.css';

interface Props {
  label: string;
  unit: string;
  values: readonly number[];
  times: readonly number[];
  /** Fim mínimo da escala (a base é 0) */
  scaleMax: number;
  /** Linha tracejada de referência (ex.: FPS nominal) */
  reference?: number;
  referenceLabel?: string;
  color: string;
  /** Casas decimais do valor mostrado */
  decimals?: number;
}

const WIDTH = 120;
const HEIGHT = 28;

const Sparkline: React.FC<Props> = ({
  label,
  unit,
  values,
  times,
  scaleMax,
  reference,
  referenceLabel,
  color,
  decimals = 0,
}) => {
  const summary = summarize(values);
  const geo = buildSparkline(values, { width: WIDTH, height: HEIGHT, scaleMax, reference, times });
  const fmt = (n: number) => n.toFixed(decimals);
  const seconds = HISTORY_WINDOW_MS / 1000;
  const description = summary
    ? `${label}, últimos ${seconds} segundos: atual ${fmt(summary.last)} ${unit}, mínimo ${fmt(summary.min)}, máximo ${fmt(summary.max)}` +
      (reference !== undefined && referenceLabel ? `, ${referenceLabel} ${reference}` : '')
    : `${label}: aguardando dados`;

  return (
    <div className={styles.row}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value} style={{ color }}>
          {summary ? fmt(summary.last) : '–'} <small>{unit}</small>
        </span>
      </div>
      <svg
        className={styles.chart}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={description}
      >
        {geo.referenceY !== null && (
          <line
            x1="0"
            x2={WIDTH}
            y1={geo.referenceY}
            y2={geo.referenceY}
            className={styles.reference}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {geo.area && <path d={geo.area} style={{ fill: color }} className={styles.area} />}
        {geo.line && (
          <path
            d={geo.line}
            fill="none"
            style={{ stroke: color }}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <div className={styles.range}>
        {summary ? (
          <>
            <span>mín {fmt(summary.min)}</span>
            <span>máx {fmt(summary.max)}</span>
          </>
        ) : (
          <span>Coletando…</span>
        )}
      </div>
    </div>
  );
};

export default Sparkline;
