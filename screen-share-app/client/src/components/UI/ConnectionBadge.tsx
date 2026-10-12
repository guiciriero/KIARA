import React from 'react';
import type { ConnectionState } from '@shared/index';
import styles from './ConnectionBadge.module.css';

interface Props {
  state: ConnectionState;
  compact?: boolean;
}

const LABELS: Record<ConnectionState, string> = {
  disconnected: 'Desconectado',
  connecting:   'Conectando…',
  connected:    'Ao Vivo',
  reconnecting: 'Reconectando…',
  failed:       'Falha de Conexão',
};

const ConnectionBadge: React.FC<Props> = ({ state, compact = false }) => {
  const label = LABELS[state] || state;

  return (
    <div
      className={`${styles.badge} ${compact ? styles.compact : ''}`}
      data-state={state}
      role="status"
      aria-label={`Status da conexão: ${label}`}
    >
      <span className={styles.dot} />
      <span className={styles.label}>{label}</span>
    </div>
  );
};

export default ConnectionBadge;
