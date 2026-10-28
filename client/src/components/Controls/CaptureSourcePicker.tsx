import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureSourceInfo } from '@shared/index';
import { IconScreen, IconWindow, IconRefresh } from '../UI/Icons';
import styles from './CaptureSourcePicker.module.css';

interface Props {
  selectedId: string | null;
  onSelect: (sourceId: string, source?: CaptureSourceInfo) => Promise<void> | void;
  disabled?: boolean;
  isSharing?: boolean;
}

type Tab = 'screen' | 'window';

const isSafeDataUrl = (url?: string | null): boolean =>
  typeof url === 'string' && url.startsWith('data:image/');

const CaptureSourcePicker: React.FC<Props> = ({
  selectedId,
  onSelect,
  disabled = false,
  isSharing = false,
}) => {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('screen');
  const [pendingId, setPendingId] = useState<string | null>(selectedId);
  const [confirming, setConfirming] = useState(false);
  const gridRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setPendingId(selectedId);
  }, [selectedId]);

  const load = useCallback(async () => {
    const host = window.screenShareHost;
    if (!host) return;
    setLoading(true);
    setError(null);
    try {
      const list = await host.capture.listSources();
      setSources(list);
      if (selectedId) {
        const cur = list.find((s) => s.id === selectedId);
        if (cur) setTab(cur.type === 'screen' ? 'screen' : 'window');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível listar telas e janelas.');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!window.screenShareHost) return null;

  const handleConfirm = async (idToConfirm?: string) => {
    const targetId = idToConfirm ?? pendingId;
    if (!targetId || confirming || disabled) return;
    setConfirming(true);
    try {
      const source = sources.find((s) => s.id === targetId);
      await Promise.resolve(onSelect(targetId, source));
      setPendingId(targetId);
    } finally {
      setConfirming(false);
    }
  };

  const handleCardClick = (src: CaptureSourceInfo) => {
    setPendingId(src.id);
    if (!isSharing) {
      void handleConfirm(src.id);
    }
  };

  const handleGridKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;

    const cols = Math.round(items.length / Math.max(1, Math.ceil(items.length / 3)));
    const next =
      e.key === 'ArrowRight' ? Math.min(idx + 1, items.length - 1)
      : e.key === 'ArrowLeft' ? Math.max(idx - 1, 0)
      : e.key === 'ArrowDown' ? Math.min(idx + cols, items.length - 1)
      : e.key === 'ArrowUp' ? Math.max(idx - cols, 0)
      : null;

    if (next !== null) {
      e.preventDefault();
      items[next]?.focus();
      const id = items[next]?.dataset.sourceId ?? null;
      if (id) {
        setPendingId(id);
        if (!isSharing) {
          void handleConfirm(id);
        }
      }
    } else if (e.key === 'Enter' && pendingId) {
      e.preventDefault();
      void handleConfirm();
    }
  };

  const visible = sources.filter((s) => (tab === 'screen' ? s.type === 'screen' : s.type === 'window'));
  const screenCount = sources.filter((s) => s.type === 'screen').length;
  const windowCount = sources.filter((s) => s.type === 'window').length;

  return (
    <section className={styles.container} aria-label="Selecionar tela ou janela">
      {/* ── Abas e Atualizar ── */}
      <div className={styles.tabs} role="tablist">
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'screen'}
          className={`${styles.tab} ${tab === 'screen' ? styles.tabActive : ''}`}
          onClick={() => setTab('screen')}
        >
          <IconScreen size={13} />
          Tela Inteira
          {screenCount > 0 && <span className={styles.tabCount}>{screenCount}</span>}
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'window'}
          className={`${styles.tab} ${tab === 'window' ? styles.tabActive : ''}`}
          onClick={() => setTab('window')}
        >
          <IconWindow size={13} />
          Aplicativos
          {windowCount > 0 && <span className={styles.tabCount}>{windowCount}</span>}
        </button>

        <button
          type="button"
          className={styles.refreshBtn}
          onClick={() => void load()}
          disabled={loading}
          title="Atualizar lista"
          aria-label="Atualizar telas e janelas"
        >
          <IconRefresh size={13} className={loading ? styles.spinning : ''} />
        </button>
      </div>

      {/* ── Grade de Miniaturas ── */}
      <div className={styles.body}>
        {loading && sources.length === 0 && (
          <ul className={styles.grid} aria-busy="true">
            {Array.from({ length: 2 }).map((_, i) => (
              <li key={i} className={styles.skeleton} aria-hidden="true">
                <div className={styles.skeletonThumb} />
                <div className={styles.skeletonName} />
              </li>
            ))}
          </ul>
        )}

        {!loading && error && (
          <div className={styles.empty} role="alert">
            <p>{error}</p>
            <button type="button" className={styles.retryBtn} onClick={() => void load()}>
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className={styles.empty}>
            <p>Nenhum{tab === 'screen' ? 'a tela' : ' aplicativo'} encontrado.</p>
          </div>
        )}

        {visible.length > 0 && (
          <ul
            ref={gridRef}
            className={styles.grid}
            onKeyDown={handleGridKey}
            aria-label={tab === 'screen' ? 'Telas disponíveis' : 'Janelas disponíveis'}
          >
            {visible.map((src) => {
              const isSelected = src.id === (pendingId ?? selectedId);
              const isLive = src.id === selectedId && isSharing;
              const hasAppIcon = isSafeDataUrl(src.appIconDataUrl);

              return (
                <li key={src.id}>
                  <button
                    type="button"
                    data-source-id={src.id}
                    className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
                    onClick={() => handleCardClick(src)}
                    onDoubleClick={() => {
                      setPendingId(src.id);
                      void handleConfirm(src.id);
                    }}
                    disabled={disabled}
                    aria-pressed={isSelected}
                    title={isLive ? `(em uso) ${src.name}` : src.name}
                  >
                    <div className={styles.thumb}>
                      {isSafeDataUrl(src.thumbnailDataUrl) ? (
                        <img
                          src={src.thumbnailDataUrl}
                          alt=""
                          className={styles.thumbImg}
                          draggable={false}
                        />
                      ) : (
                        <div className={styles.thumbFallback}>
                          {src.type === 'screen' ? <IconScreen size={24} /> : <IconWindow size={24} />}
                        </div>
                      )}
                      {isLive && <div className={styles.badgeLive}>Em uso</div>}
                      {isSelected && <div className={styles.selOverlay} aria-hidden="true" />}
                    </div>

                    <span className={styles.nameRow}>
                      {hasAppIcon && (
                        <img
                          src={src.appIconDataUrl}
                          alt=""
                          className={styles.appIcon}
                          draggable={false}
                        />
                      )}
                      <span className={styles.name}>{src.name}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ── Botão de confirmação quando transmitindo e selecionou outra fonte ── */}
      {isSharing && pendingId && pendingId !== selectedId && (
        <div className={styles.confirmActions}>
          <button
            type="button"
            className={styles.confirmBtn}
            disabled={confirming || disabled}
            onClick={() => void handleConfirm()}
          >
            {confirming ? 'Trocando…' : 'Trocar tela transmitida'}
          </button>
        </div>
      )}
    </section>
  );
};

export default CaptureSourcePicker;
