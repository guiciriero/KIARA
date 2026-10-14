import React from 'react';
import { estimateUploadMbps, uploadAdvice } from '../../utils/uploadEstimate';
import { IconUpload, IconAlertTriangle } from './Icons';
import styles from './UploadEstimate.module.css';

interface Props {
  bitrateKbps: number;
  /** Espectadores simultâneos considerados (pelo menos 1) */
  viewers: number;
  maxViewers: number;
}

const UploadEstimate: React.FC<Props> = ({ bitrateKbps, viewers, maxViewers }) => {
  const considered = Math.max(1, viewers);
  const current = estimateUploadMbps(bitrateKbps, considered);
  const worstCase = maxViewers > 0 ? estimateUploadMbps(bitrateKbps, maxViewers) : current;
  const advice = uploadAdvice(Math.max(current, 0));
  const worstAdvice = uploadAdvice(worstCase);

  const className =
    advice === 'danger' ? styles.danger : advice === 'warning' ? styles.warning : styles.ok;

  return (
    <div className={`${styles.container} ${className}`} role="status">
      <div className={styles.row}>
        {advice === 'ok' ? <IconUpload size={15} /> : <IconAlertTriangle size={15} />}
        <span>
          Upload necessário: <strong>{current.toLocaleString('pt-BR')} Mbps</strong>
          {' '}para {considered} {considered === 1 ? 'espectador' : 'espectadores'}
        </span>
      </div>
      {advice !== 'ok' && (
        <p className={styles.note}>
          {advice === 'danger'
            ? 'Sua internet provavelmente não aguenta isso. Reduza a resolução ou o bitrate.'
            : 'Confira se sua internet tem esse upload sobrando; se travar, reduza a qualidade.'}
        </p>
      )}
      {maxViewers > 0 && worstAdvice !== 'ok' && maxViewers > considered && (
        <p className={styles.note}>
          Com a sala cheia ({maxViewers}) seriam {worstCase.toLocaleString('pt-BR')} Mbps.
        </p>
      )}
    </div>
  );
};

export default UploadEstimate;
