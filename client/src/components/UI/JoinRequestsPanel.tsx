import React from 'react';
import type { JoinRequestPayload } from '@shared/index';
import { IconUserCheck } from './Icons';
import styles from './JoinRequestsPanel.module.css';

interface Props {
  requests: JoinRequestPayload[];
  onRespond: (viewerId: string, approved: boolean) => void;
}

const JoinRequestsPanel: React.FC<Props> = ({ requests, onRespond }) => {
  if (requests.length === 0) return null;

  return (
    <section className={styles.container} aria-label="Pedidos de entrada" role="region">
      <div className={styles.header} role="status" aria-live="polite">
        <IconUserCheck size={16} />
        <span>
          {requests.length === 1
            ? '1 pessoa quer entrar na sala'
            : `${requests.length} pessoas querem entrar na sala`}
        </span>
      </div>
      <ul className={styles.list}>
        {requests.map((req) => (
          <li key={req.viewerId} className={styles.item}>
            <span className={styles.name} title={req.name}>{req.name}</span>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btnApprove}
                onClick={() => onRespond(req.viewerId, true)}
                aria-label={`Aprovar a entrada de ${req.name}`}
              >
                Aprovar
              </button>
              <button
                type="button"
                className={styles.btnDeny}
                onClick={() => onRespond(req.viewerId, false)}
                aria-label={`Negar a entrada de ${req.name}`}
              >
                Negar
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default JoinRequestsPanel;
