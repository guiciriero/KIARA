/**
 * SourcePickerModal — escolha de tela/janela em um modal (estrutura clássica, estilo Discord):
 * abas Telas/Janelas, grade de miniaturas com nome, qualidade no rodapé e botão de confirmar.
 * Usa a mesma captura de miniaturas do app (`host.capture.listSources()`); só a apresentação é nova.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CaptureSourceInfo, VideoConfig } from '@shared/index';
import { IconRefresh, IconScreen, IconWindow, IconX } from '../UI/Icons';
import styles from './SourcePickerModal.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
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

const SKELETON_COUNT = 6;

const isSafeDataUrl = (url?: string | null): boolean =>
  typeof url === 'string' && url.startsWith('data:image/');

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])';

const SourcePickerModal: React.FC<Props> = ({
  open,
  onClose,
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
  const [closing, setClosing] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLUListElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const load = useCallback(async () => {
    const host = window.screenShareHost;
    if (!host) return;
    setLoading(true);
    setError(null);
    try {
      const list = await host.capture.listSources();
      setSources(list);
      const current = list.find((s) => s.id === selectedId);
      if (current) setTab(current.type === 'screen' ? 'screen' : 'window');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível listar telas e janelas.');
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  // Ao abrir: guarda o foco anterior, carrega as fontes e foca o diálogo
  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    setPendingId(selectedId);
    setClosing(false);
    void load();
    const t = window.setTimeout(() => dialogRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(t);
      returnFocusRef.current?.focus?.();
    };
    // load depende de selectedId; só queremos recarregar ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const requestClose = useCallback(() => {
    setClosing(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.setTimeout(onClose, reduced ? 0 : 140);
  }, [onClose]);

  const visible = sources.filter((s) => s.type === tab);
  const counts = {
    screen: sources.filter((s) => s.type === 'screen').length,
    window: sources.filter((s) => s.type === 'window').length,
  };

  const confirm = async (id?: string) => {
    const target = id ?? pendingId;
    if (!target || confirming) return;
    setConfirming(true);
    try {
      await Promise.resolve(onConfirm(target, sources.find((s) => s.id === target)));
      requestClose();
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

  const onDialogKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // Nada vaza para os atalhos da página enquanto o modal está aberto
    e.stopPropagation();

    if (e.key === 'Escape') {
      e.preventDefault();
      requestClose();
      return;
    }

    if (e.key === 'Tab') {
      const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
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

  if (!open) return null;

  const emptyText = tab === 'screen' ? 'Nenhuma tela encontrada.' : 'Nenhuma janela aberta.';

  return createPortal(
    <div
      className={`${styles.overlay} ${closing ? styles.closing : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-modal-title"
        tabIndex={-1}
        onKeyDown={onDialogKeyDown}
      >
        <header className={styles.header}>
          <h2 id="source-modal-title" className={styles.title}>O que transmitir?</h2>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={() => void load()}
              disabled={loading}
              aria-label="Atualizar lista"
              title="Atualizar lista"
            >
              <IconRefresh size={16} className={loading ? styles.spin : ''} />
            </button>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={requestClose}
              aria-label="Fechar"
              title="Fechar (Esc)"
            >
              <IconX size={16} />
            </button>
          </div>
        </header>

        <div className={styles.tabs} role="tablist" aria-label="Tipo de fonte">
          <button
            type="button"
            role="tab"
            id="source-tab-screen"
            aria-selected={tab === 'screen'}
            tabIndex={tab === 'screen' ? 0 : -1}
            className={`${styles.tab} ${tab === 'screen' ? styles.tabActive : ''}`}
            onClick={() => setTab('screen')}
            onKeyDown={onTabKeyDown}
          >
            <IconScreen size={15} />
            Telas
            {counts.screen > 0 && <span className={styles.count}>{counts.screen}</span>}
          </button>
          <button
            type="button"
            role="tab"
            id="source-tab-window"
            aria-selected={tab === 'window'}
            tabIndex={tab === 'window' ? 0 : -1}
            className={`${styles.tab} ${tab === 'window' ? styles.tabActive : ''}`}
            onClick={() => setTab('window')}
            onKeyDown={onTabKeyDown}
          >
            <IconWindow size={15} />
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
                const focusable = selected || (pendingId === null && i === 0) ||
                  (!visible.some((s) => s.id === pendingId) && i === 0);
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
                    title={src.name}
                  >
                    <div className={styles.thumb}>
                      {isSafeDataUrl(src.thumbnailDataUrl) ? (
                        <img src={src.thumbnailDataUrl} alt="" className={styles.thumbImg} draggable={false} />
                      ) : (
                        <div className={styles.thumbFallback}>
                          {src.type === 'screen' ? <IconScreen size={28} /> : <IconWindow size={28} />}
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
          <div className={styles.footerActions}>
            <button type="button" className={styles.ghostBtn} onClick={requestClose}>
              Cancelar
            </button>
            <button
              type="button"
              className={styles.confirmBtn}
              onClick={() => void confirm()}
              disabled={!pendingId || confirming}
            >
              {isSharing ? (confirming ? 'Trocando…' : 'Trocar') : 'Selecionar'}
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
};

export default SourcePickerModal;
