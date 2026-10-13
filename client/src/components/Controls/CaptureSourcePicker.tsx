import React, { useCallback, useEffect, useState } from 'react';
import type { CaptureSourceInfo } from '@shared/index';
import { IconScreen, IconWindow, IconRefresh } from '../UI/Icons';
import styles from './CaptureSourcePicker.module.css';

interface Props {
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  isSharing?: boolean;
}

const isSafeImageDataUrl = (url: string): boolean => url.startsWith('data:image/');

const CaptureSourcePicker: React.FC<Props> = ({ selectedId, onSelect, disabled = false, isSharing = false }) => {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

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

  if (!window.screenShareHost) return null;

  const handleSelect = async (id: string) => {
    if (disabled || switchingId) return;
    if (isSharing && id !== selectedId) {
      setSwitchingId(id);
      try {
        await Promise.resolve(onSelect(id));
      } finally {
        setSwitchingId(null);
      }
    } else {
      onSelect(id);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <IconScreen size={16} className={styles.icon} />
          <span className={styles.title}>Tela ou Janela</span>
          {isSharing && <span className={styles.liveHint}>Troca ao vivo ativa</span>}
        </div>
        <button
          type="button"
          className={styles.refreshBtn}
          onClick={() => { void load(); }}
          disabled={loading}
          title="Atualizar telas e janelas disponíveis"
          aria-label="Atualizar fontes de captura"
        >
          <IconRefresh size={14} className={loading ? styles.spinning : ''} />
        </button>
      </div>

      {error && <p className={styles.empty}>{error}</p>}
      {!error && !loading && sources.length === 0 && (
        <p className={styles.empty}>Nenhuma tela ou janela encontrada.</p>
      )}

      {loading && (
        <div className={styles.loading}>
          <div className={styles.miniSpinner} />
          <span>Buscando telas e janelas…</span>
        </div>
      )}

      <ul className={styles.grid}>
        {sources.map((src) => {
          const isSelected = src.id === selectedId;
          const isScreen = src.type === 'screen';
          const isSwitching = switchingId === src.id;

          return (
            <li key={src.id}>
              <button
                type="button"
                className={`${styles.card} ${isSelected ? styles.selected : ''} ${isSwitching ? styles.switching : ''}`}
                onClick={() => { void handleSelect(src.id); }}
                disabled={disabled}
                aria-pressed={isSelected}
                title={isSharing && !isSelected ? `Trocar transmissão para: ${src.name}` : src.name}
              >
                <div className={styles.thumb}>
                  {isSafeImageDataUrl(src.thumbnailDataUrl) ? (
                    <img src={src.thumbnailDataUrl} alt="" className={styles.thumbImg} />
                  ) : (
                    <div className={styles.thumbFallback}>
                      {isScreen ? <IconScreen size={24} /> : <IconWindow size={24} />}
                    </div>
                  )}
                  <div className={styles.badgeType}>
                    {isScreen ? 'Monitor' : 'Janela'}
                  </div>
                  {isSelected && isSharing && (
                    <div className={styles.badgeLive}>NO AR</div>
                  )}
                  {isSwitching && (
                    <div className={styles.switchingOverlay}>
                      <div className={styles.miniSpinner} />
                    </div>
                  )}
                </div>
                <div className={styles.infoRow}>
                  {isScreen ? <IconScreen size={13} className={styles.typeIcon} /> : <IconWindow size={13} className={styles.typeIcon} />}
                  <span className={styles.name}>{src.name}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default CaptureSourcePicker;
