/**
 * useStatsHistory.ts
 * Guarda as últimas amostras de `StreamStats` (30 s) para os mini-gráficos.
 */

import { useState } from 'react';
import type { StreamStats } from '@shared/index';
import { appendSample, type StatsSample } from '../utils/statsHistory';

export function useStatsHistory(stats: StreamStats | null): readonly StatsSample[] {
  const [history, setHistory] = useState<readonly StatsSample[]>(() =>
    stats ? appendSample([], stats) : [],
  );
  const [lastSeen, setLastSeen] = useState<StreamStats | null>(stats);

  // Ajuste de estado durante a renderização (padrão recomendado pelo React): sem efeito extra
  if (stats && stats !== lastSeen) {
    setLastSeen(stats);
    setHistory(appendSample(history, stats));
  }
  return history;
}
