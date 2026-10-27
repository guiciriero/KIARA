import React, { useState } from 'react';
import type { ViewerItem } from '../../utils/viewerList';
import { IconUsers } from './Icons';
import styles from './ViewerListPanel.module.css';

interface Props {
  viewers: ViewerItem[];
  onKick: (viewerId: string, ban: boolean) => void;
}

const ViewerListPanel: React.FC<Props> = ({ viewers, onKick }) => {
  /** Espectador aguardando confirmação de banimento */
  const [banning, setBanning] = useState<string | null>(null);

  if (viewers.length === 0) return null;

  return (
    <section className={styles.container} aria-label="Espectadores conectados">
      <div className={styles.header}>
        <IconUsers size={16} />
        <span>Espectadores ({viewers.length})</span>
      </div>
      <ul className={styles.list}>
        {viewers.map((v) => (
          <li key={v.id} className={styles.item}>
            <span className={styles.name} title={v.name}>{v.name}</span>
            {banning === v.id ? (
              <div className={styles.actions} role="group" aria-label={`Confirmar banimento de ${v.name}`}>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => { setBanning(null); onKick(v.id, true); }}
                  aria-label={`Confirmar banimento de ${v.name}`}
                >
                  Confirmar banimento
                </button>
                <button type="button" className={styles.btn} onClick={() => setBanning(null)} aria-label="Cancelar banimento">
                  Cancelar
                </button>
              </div>
            ) : (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.btn}
                  onClick={() => onKick(v.id, false)}
                  aria-label={`Expulsar ${v.name}`}
                  title="Remove da sala; pode entrar de novo"
                >
                  Expulsar
                </button>
                <button
                  type="button"
                  className={styles.btnDanger}
                  onClick={() => setBanning(v.id)}
                  aria-label={`Banir ${v.name}`}
                  title="Bloqueia o acesso desta pessoa até a sala fechar"
                >
                  Banir
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
};

export default ViewerListPanel;
