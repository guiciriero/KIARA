import React, { useEffect, useMemo } from 'react';
import qrcode from 'qrcode-generator';
import styles from './QrCode.module.css';

interface Props {
  value: string;
  onClose: () => void;
}

/** QR Code em SVG gerado localmente (nada é enviado a serviços externos); fecha com Esc */
const QrCode: React.FC<Props> = ({ value, onClose }) => {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
  }, [value]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label="QR Code do link da sala"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className={styles.title}>QR Code da sala</h3>
        <div className={styles.qr} role="img" aria-label="QR Code com o link da sala" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className={styles.url}>{value.replace(/^https?:\/\//, '')}</p>
        <button type="button" className={styles.close} onClick={onClose} autoFocus>
          Fechar (Esc)
        </button>
      </div>
    </div>
  );
};

export default QrCode;
