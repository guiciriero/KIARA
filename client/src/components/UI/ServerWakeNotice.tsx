import React from 'react';
import styles from './ServerWakeNotice.module.css';

interface ServerWakeNoticeProps {
  /** Segundos desde que o aviso apareceu */
  seconds: number;
}

/** Aviso de cold start: o servidor está acordando e a conexão deve sair em breve */
const ServerWakeNotice: React.FC<ServerWakeNoticeProps> = ({ seconds }) => (
  <div className={styles.notice} role="status" aria-live="polite">
    <p className={styles.text}>Acordando o servidor… isso pode levar até 1 minuto</p>
    <div className={styles.track} aria-hidden="true">
      <span className={styles.bar} />
    </div>
    {/* aria-hidden: evita que o leitor de tela anuncie a cada segundo */}
    <span className={styles.seconds} aria-hidden="true">{seconds} s</span>
  </div>
);

export default ServerWakeNotice;
