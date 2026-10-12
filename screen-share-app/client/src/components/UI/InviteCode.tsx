import React, { useState } from 'react';
import { IconCopy, IconCheck } from './Icons';
import styles from './InviteCode.module.css';

interface Props {
  code: string;
  url: string;
}

const InviteCode: React.FC<Props> = ({ code, url }) => {
  const [copied, setCopied] = useState<'code' | 'url' | null>(null);

  const copy = async (text: string, type: 'code' | 'url') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(type);
      setTimeout(() => setCopied(null), 2200);
    } catch {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(type);
      setTimeout(() => setCopied(null), 2200);
    }
  };

  return (
    <div className={styles.container}>
      {/* Bloco do Código da Sala (Destaque Principal) */}
      <div className={styles.codeCard}>
        <div className={styles.codeHeader}>
          <span className={styles.label}>Código da Sala</span>
          <span className={styles.tag}>P2P Direto</span>
        </div>
        <div className={styles.codeRow}>
          <span className={styles.code}>{code}</span>
          <button
            type="button"
            className={`${styles.copyCodeBtn} ${copied === 'code' ? styles.copied : ''}`}
            onClick={() => copy(code, 'code')}
            title="Copiar código de 6 dígitos"
            aria-label="Copiar código da sala"
          >
            {copied === 'code' ? <IconCheck size={16} /> : <IconCopy size={16} />}
            <span>{copied === 'code' ? 'Copiado!' : 'Copiar'}</span>
          </button>
        </div>
      </div>

      {/* Bloco de Link de Compartilhamento Rápido */}
      {url && (
        <div className={styles.urlCard}>
          <div className={styles.urlHeader}>
            <span className={styles.label}>Link para Compartilhar</span>
          </div>
          <div className={styles.urlRow}>
            <span className={styles.urlText} title={url}>{url}</span>
            <button
              type="button"
              className={`${styles.copyUrlBtn} ${copied === 'url' ? styles.copied : ''}`}
              onClick={() => copy(url, 'url')}
              aria-label="Copiar link completo da transmissão"
            >
              {copied === 'url' ? <IconCheck size={15} /> : <IconCopy size={15} />}
              <span>{copied === 'url' ? 'Copiado!' : 'Copiar Link'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default InviteCode;
