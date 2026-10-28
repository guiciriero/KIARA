/**
 * SourcePicker — escolha de tela/janela embutida no painel (estrutura clássica, estilo Discord):
 * abas Telas/Janelas, grade de miniaturas com nome, qualidade e botão de confirmar.
 * Usa a mesma captura de miniaturas do app (`host.capture.listSources()`); só a apresentação é nova.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureSourceInfo, VideoConfig } from '@shared/index';
import { IconRefresh, IconScreen, IconWindow } from '../UI/Icons';
import styles from './SourcePicker.module.css';

interface Props {
  /** Fonte atualmente escolhida (ou no ar). */
  selectedId: string | null;
  /** Já transmitindo: o botão vira "Trocar". */
  isSharing: boolean;
  onConfirm: (sourceId: string, source?: CaptureSourceInfo) => Promise<void> | void;
  videoConfig: VideoConfig;
  onVideoConfigChange: (config: VideoConfig) => void;
}

type Tab = 'screen' | 'window';

const QUALITIES = [
  { id: '1080p', label: '1080p', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p', width: 2560, height: 1440 },
];

const SKELETON_COUNT = 4;

const isSafeDataUrl = (url?: string | null): boolean =>
  typeof url === 'string' && url.startsWith('data:image/');

const SourcePicker: React.FC<Props> = ({
  selectedId,
  isSharing,
  onConfirm,
  videoConfig,
  onVideoConfigChange,
}) => {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('screen');
  const [pendingId, setPendingId] = useState<string | null>(selectedId);
  const [confirming, setConfirming] = useState(false);

  const gridRef = useRef<HTMLUListElement>(null);
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const load = useCallback(async () => {
    const host = window.screenShareHost;
    if (!host) return;
    setLoading(true);
    setError(null);
    try {
      const list = await host.capture.listSources();
      setSources(list);
      const current = list.find((s) => s.id === selectedRef.current);
      if (current) setTab(current.type === 'screen' ? 'screen' : 'window');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível listar telas e janelas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setPendingId(selectedId);
  }, [selectedId]);

  if (!window.screenShareHost) return null;

  const visible = sources.filter((s) => s.type === tab);
  const counts = {
    screen: sources.filter((s) => s.type === 'screen').length,
    window: sources.filter((s) => s.type === 'window').length,
  };
  const unchanged = pendingId !== null && pendingId === selectedId;

  const confirm = async (id?: string) => {
    const target = id ?? pendingId;
    if (!target || confirming) return;
    setConfirming(true);
    try {
      await Promise.resolve(onConfirm(target, sources.find((s) => s.id === target)));
    } finally {
      setConfirming(false);
    }
  };

  const moveFocus = (delta: number | 'home' | 'end', vertical = false) => {
    const items = Array.from(gridRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    if (items.length === 0) return;
    const idx = items.indexOf(document.activeElement as HTMLElement);
    const cols = gridRef.current
      ? Math.max(1, getComputedStyle(gridRef.current).gridTemplateColumns.split(' ').length)
      : 1;
    let next: number;
    if (delta === 'home') next = 0;
    else if (delta === 'end') next = items.length - 1;
    else next = Math.min(items.length - 1, Math.max(0, idx + (vertical ? delta * cols : delta)));
    items[next]?.focus();
    const id = items[next]?.dataset.sourceId;
    if (id) setPendingId(id);
  };

  const onGridKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case 'ArrowRight': e.preventDefault(); moveFocus(1); break;
      case 'ArrowLeft': e.preventDefault(); moveFocus(-1); break;
      case 'ArrowDown': e.preventDefault(); moveFocus(1, true); break;
      case 'ArrowUp': e.preventDefault(); moveFocus(-1, true); break;
      case 'Home': e.preventDefault(); moveFocus('home'); break;
      case 'End': e.preventDefault(); moveFocus('end'); break;
      case 'Enter':
        e.preventDefault();
        void confirm();
        break;
      default:
        break;
    }
  };

  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      setTab((t) => (t === 'screen' ? 'window' : 'screen'));
    }
  };

  const emptyText = tab === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta.';

  let confirmLabel: string;
  if (confirming) confirmLabel = isSharing ? 'Trocando…' : 'Selecionando…';
  else if (unchanged) confirmLabel = isSharing ? 'No ar' : 'Selecionada';
  else confirmLabel = isSharing ? 'Trocar' : 'Selecionar';

  return (
    <section className={styles.container} aria-label="Fonte">
      <header className={styles.header}>
        <h2 className={styles.title}>Fonte</h2>
        <button
          type="button"
          className={styles.iconBtn}
          onClick={() => void load()}
          disabled={loading}
          aria-label="Atualizar lista"
          title="Atualizar lista"
        >
          <IconRefresh size={14} className={loading ? styles.spin : ''} />
        </button>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Tipo de fonte">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'screen'}
          tabIndex={tab === 'screen' ? 0 : -1}
          className={`${styles.tab} ${tab === 'screen' ? styles.tabActive : ''}`}
          onClick={() => setTab('screen')}
          onKeyDown={onTabKeyDown}
        >
          <IconScreen size={14} />
          Telas
          {counts.screen > 0 && <span className={styles.count}>{counts.screen}</span>}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'window'}
          tabIndex={tab === 'window' ? 0 : -1}
          className={`${styles.tab} ${tab === 'window' ? styles.tabActive : ''}`}
          onClick={() => setTab('window')}
          onKeyDown={onTabKeyDown}
        >
          <IconWindow size={14} />
          Janelas
          {counts.window > 0 && <span className={styles.count}>{counts.window}</span>}
        </button>
      </div>

      <div className={styles.body}>
        {loading && sources.length === 0 && (
          <ul className={styles.grid} aria-busy="true" aria-label="Carregando">
            {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
              <li key={i} className={styles.skeleton} aria-hidden="true">
                <div className={`${styles.skeletonThumb} kiara-shimmer`} />
                <div className={`${styles.skeletonName} kiara-shimmer`} />
              </li>
            ))}
          </ul>
        )}

        {!loading && error && (
          <div className={styles.state} role="alert">
            <p>{error}</p>
            <button type="button" className={styles.ghostBtn} onClick={() => void load()}>
              Tentar de novo
            </button>
          </div>
        )}

        {!loading && !error && visible.length === 0 && (
          <div className={styles.state}>
            <p>{emptyText}</p>
            <button type="button" className={styles.ghostBtn} onClick={() => void load()}>
              Atualizar
            </button>
          </div>
        )}

        {visible.length > 0 && (
          <ul
            ref={gridRef}
            className={styles.grid}
            role="listbox"
            aria-label={tab === 'screen' ? 'Telas' : 'Janelas'}
            onKeyDown={onGridKeyDown}
          >
            {visible.map((src, i) => {
              const selected = src.id === pendingId;
              const focusable = selected || (!visible.some((s) => s.id === pendingId) && i === 0);
              const inUse = isSharing && src.id === selectedId;
              return (
                <li
                  key={src.id}
                  role="option"
                  aria-selected={selected}
                  tabIndex={focusable ? 0 : -1}
                  data-source-id={src.id}
                  className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
                  style={{ '--i': Math.min(i, 8) } as React.CSSProperties}
                  onClick={() => setPendingId(src.id)}
                  onFocus={() => setPendingId(src.id)}
                  onDoubleClick={() => void confirm(src.id)}
                  title={inUse ? `${src.name} (no ar)` : src.name}
                >
                  <div className={styles.thumb}>
                    {isSafeDataUrl(src.thumbnailDataUrl) ? (
                      <img src={src.thumbnailDataUrl} alt="" className={styles.thumbImg} draggable={false} />
                    ) : (
                      <div className={styles.thumbFallback}>
                        {src.type === 'screen' ? <IconScreen size={24} /> : <IconWindow size={24} />}
                      </div>
                    )}
                  </div>
                  <span className={styles.nameRow}>
                    {isSafeDataUrl(src.appIconDataUrl) && (
                      <img src={src.appIconDataUrl} alt="" className={styles.appIcon} draggable={false} />
                    )}
                    <span className={styles.name}>{src.name}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer className={styles.footer}>
        <div className={styles.quality} role="group" aria-label="Qualidade">
          {QUALITIES.map((q) => {
            const active = q.width === videoConfig.width && q.height === videoConfig.height;
            return (
              <button
                key={q.id}
                type="button"
                className={`${styles.qualityBtn} ${active ? styles.qualityActive : ''}`}
                aria-pressed={active}
                onClick={() => onVideoConfigChange({ ...videoConfig, width: q.width, height: q.height })}
              >
                {q.label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          className={styles.confirmBtn}
          onClick={() => void confirm()}
          disabled={!pendingId || confirming || unchanged}
        >
          {confirmLabel}
        </button>
      </footer>
    </section>
  );
};

export default SourcePicker;
