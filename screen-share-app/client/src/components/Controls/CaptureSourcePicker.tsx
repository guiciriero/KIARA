/**
 * CaptureSourcePicker.tsx
 * Seletor de tela/janela para o app desktop (Electron).
 * Lista `host.capture.listSources()` com miniaturas. Só renderiza no desktop
 * e fica desabilitado durante a transmissão.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { CaptureSourceInfo } from '@shared/index';
import styles from './CaptureSourcePicker.module.css';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled: boolean;
}

/** Só aceita data URLs de imagem — evita usar valores arbitrários em <img src> */
const isSafeImageDataUrl = (url: string): boolean => url.startsWith('data:image/');

const CaptureSourcePicker: React.FC<Props> = ({ selectedId, onSelect, disabled }) => {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const load = useCallback(async () => {
    const host = window.screenShareHost;
    if (!host) return;
    setLoading(true);
    setError(null);
    try {
      setSources(await host.capture.listSources());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível listar telas e janelas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Fora do app desktop o navegador mostra o seu próprio seletor
  if (!window.screenShareHost) return null;

  return (
    <div className={`${styles.container} ${disabled ? styles.disabled : ''}`}>
      <div className={styles.header}>
        <span className={styles.label}>🖥️ Tela ou Janela</span>
        <button
          className={styles.refreshBtn}
          onClick={() => { void load(); }}
          disabled={disabled || loading}
          title="Atualizar lista"
        >
          {loading ? '…' : '↻'}
        </button>
      </div>

      {error && <p className={styles.empty}>{error}</p>}
      {!error && !loading && sources.length === 0 && (
        <p className={styles.empty}>Nenhuma tela ou janela encontrada.</p>
      )}

      <ul className={styles.grid}>
        {sources.map((src) => {
          const isSelected = src.id === selectedId;
          return (
            <li key={src.id}>
              <button
                type="button"
                className={`${styles.card} ${isSelected ? styles.selected : ''}`}
                onClick={() => onSelect(src.id)}
                disabled={disabled}
                aria-pressed={isSelected}
                title={src.name}
              >
                <div className={styles.thumb}>
                  {isSafeImageDataUrl(src.thumbnailDataUrl)
                    ? <img src={src.thumbnailDataUrl} alt="" />
                    : <span>{src.type === 'screen' ? '🖥️' : '🪟'}</span>}
                </div>
                <span className={styles.name}>{src.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default CaptureSourcePicker;
