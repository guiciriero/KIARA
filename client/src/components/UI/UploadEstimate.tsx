import React from 'react';
import { estimateUploadMbps, recommendedUploadMbps, uploadAdvice } from '../../utils/uploadEstimate';
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
  const recommended = recommendedUploadMbps(bitrateKbps, considered);
  const worstCase = maxViewers > 0 ? estimateUploadMbps(bitrateKbps, maxViewers) : current;
  const worstRecommended = maxViewers > 0 ? recommendedUploadMbps(bitrateKbps, maxViewers) : recommended;
  const advice = uploadAdvice(current);
  const worstAdvice = uploadAdvice(worstCase);

  const className =
    advice === 'danger' ? styles.danger : advice === 'warning' ? styles.warning : styles.ok;

  return (
    <div className={`${styles.container} ${className}`} role="status">
      <div className={styles.row}>
        {advice === 'ok' ? <IconUpload size={15} /> : <IconAlertTriangle size={15} />}
        <span>
          Upload usado: <strong>{current.toLocaleString('pt-BR')} Mbps</strong>
          {' '}por {considered} {considered === 1 ? 'espectador' : 'espectadores'}
        </span>
      </div>

      {/* Recomendação de margem: sempre visível, pois é orientação prática */}
      <p className={styles.note}>
        Recomendado: <strong>{recommended.toLocaleString('pt-BR')} Mbps</strong> disponíveis
        {' '}(margem de 1,5× para oscilações de rede).
      </p>

      {advice === 'warning' && (
        <p className={styles.note}>
          Conexão no limite. Se travar, reduza o bitrate ou a resolução.
        </p>
      )}
      {advice === 'danger' && (
        <p className={styles.note}>
          Upload provavelmente insuficiente. Reduza a resolução ou o bitrate.
        </p>
      )}

      {maxViewers > 0 && maxViewers > considered && (
        <p className={styles.note}>
          Com a sala cheia ({maxViewers}): {worstCase.toLocaleString('pt-BR')} Mbps usados
          {worstAdvice !== 'ok' ? ` — recomendado ${worstRecommended.toLocaleString('pt-BR')} Mbps` : ''}.
        </p>
      )}
    </div>
  );
};

export default UploadEstimate;
