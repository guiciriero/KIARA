/**
 * statsHistory.ts
 * Histórico curto das estatísticas (últimos 30 s) e geração dos traçados dos sparklines.
 * Funções puras, sem React.
 */

import type { StreamStats } from '@shared/index';

/** Janela exibida nos gráficos */
export const HISTORY_WINDOW_MS = 30_000;

export interface StatsSample {
  /** `timestamp` do próprio StreamStats (relógio de quem mediu) */
  t: number;
  fps: number;
  latencyMs: number;
  /** kbps */
  videoBitrate: number;
  lossPercent: number;
}

/**
 * Acrescenta uma amostra e descarta as que ficaram fora da janela, contando a partir da amostra mais
 * nova (assim não depende de os relógios dos dois lados estarem acertados).
 * Amostra repetida ou mais antiga que a última é ignorada; devolve o mesmo array nesse caso.
 */
export function appendSample(
  history: readonly StatsSample[],
  stats: StreamStats,
  windowMs = HISTORY_WINDOW_MS,
): readonly StatsSample[] {
  const last = history[history.length - 1];
  if (last && stats.timestamp <= last.t) return history;
  const sample: StatsSample = {
    t: stats.timestamp,
    fps: stats.fps,
    latencyMs: stats.latencyMs,
    videoBitrate: stats.videoBitrate,
    lossPercent: stats.lossPercent,
  };
  const oldest = stats.timestamp - windowMs;
  const kept = history.filter((s) => s.t >= oldest);
  kept.push(sample);
  return kept;
}

export interface SparklineGeometry {
  /** Atributo `d` do traçado da linha (vazio com menos de 2 pontos) */
  line: string;
  /** Atributo `d` da área sob a linha (vazio com menos de 2 pontos) */
  area: string;
  /** Posição Y da linha de referência (ex.: FPS nominal) */
  referenceY: number | null;
}

export interface SparklineOptions {
  width: number;
  height: number;
  /** Fim mínimo da escala. A base é sempre 0; a escala cresce se algum valor passar disso */
  scaleMax: number;
  /** Valor da linha de referência (ex.: FPS nominal) */
  reference?: number;
  /** Relógio de cada ponto, para o eixo X ser o tempo e não o índice */
  times?: readonly number[];
  windowMs?: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Converte valores em coordenadas SVG. O eixo X cobre a janela de tempo; o Y vai de 0 até a escala */
export function buildSparkline(values: readonly number[], opts: SparklineOptions): SparklineGeometry {
  const { width, height, reference, times, windowMs = HISTORY_WINDOW_MS } = opts;
  const max = Math.max(opts.scaleMax, ...values, reference ?? 0, 1e-9);
  const yOf = (v: number) => round(height - (Math.max(0, v) / max) * height);
  const referenceY = reference !== undefined ? yOf(reference) : null;

  if (values.length < 2) return { line: '', area: '', referenceY };

  const lastT = times ? times[times.length - 1] : 0;
  const xOf = (i: number) => {
    if (times) return round(width - ((lastT - times[i]) / windowMs) * width);
    return round((i / (values.length - 1)) * width);
  };

  const points = values.map((v, i) => `${xOf(i)} ${yOf(v)}`);
  const line = `M${points.join(' L')}`;
  const area = `${line} L${xOf(values.length - 1)} ${height} L${xOf(0)} ${height} Z`;
  return { line, area, referenceY };
}

export interface SeriesSummary {
  min: number;
  max: number;
  last: number;
}

export function summarize(values: readonly number[]): SeriesSummary | null {
  if (values.length === 0) return null;
  return { min: Math.min(...values), max: Math.max(...values), last: values[values.length - 1] };
}
