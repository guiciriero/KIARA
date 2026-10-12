/**
 * ConnectionBadge.tsx
 * Indicador visual do estado da conexão WebSocket/WebRTC.
 */

import React from 'react';
import type { ConnectionState } from '@shared/index';
import styles from './ConnectionBadge.module.css';

interface Props {
  state: ConnectionState;
  compact?: boolean;
}

const LABELS: Record<ConnectionState, string> = {
  disconnected:  'Sem conexão',
  connecting:    'Conectando…',
  connected:     'Conectado',
  reconnecting:  'Reconectando…',
  failed:        'Falha na conexão',
};

const COLORS: Record<ConnectionState, string> = {
  disconnected:  'var(--color-text-muted)',
  connecting:    'var(--color-warning)',
  connected:     'var(--color-success)',
  reconnecting:  'var(--color-warning)',
  failed:        'var(--color-danger)',
};

const ConnectionBadge: React.FC<Props> = ({ state, compact }) => {
  const color = COLORS[state];
  const label = LABELS[state];

  return (
    <div className={`${styles.badge} ${compact ? styles.compact : ''}`}>
      <span className={styles.dot} style={{ background: color }} />
      {!compact && <span className={styles.label} style={{ color }}>{label}</span>}
      {compact && <span className={styles.label} style={{ color }}>{label}</span>}
    </div>
  );
};

export default ConnectionBadge;
