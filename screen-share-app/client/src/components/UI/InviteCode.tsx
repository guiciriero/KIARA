/**
 * InviteCode.tsx
 * Exibe o código de convite e o link de compartilhamento com botão de cópia.
 */

import React, { useState } from 'react';
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
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Fallback para navegadores antigos
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(type);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.urlBlock}>
        <span className={styles.label}>Link de Convite</span>
        <div className={styles.urlRow}>
          <span className={styles.url}>{url}</span>
        </div>
        <button
          className={`${styles.primaryCopyBtn} ${copied === 'url' ? styles.copied : ''}`}
          onClick={() => copy(url, 'url')}
          disabled={!url}
        >
          {copied === 'url' ? '✓ Link copiado' : 'Copiar link para enviar'}
        </button>
      </div>

      <div className={styles.codeBlock}>
        <span className={styles.label}>Código da Sala</span>
        <div className={styles.codeRow}>
          <span className={styles.code}>{code}</span>
          <button
            className={`${styles.copyBtn} ${copied === 'code' ? styles.copied : ''}`}
            onClick={() => copy(code, 'code')}
            title="Copiar código"
            aria-label="Copiar código"
          >
            {copied === 'code' ? '✓' : '⎘'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InviteCode;
