import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CaptureSourceInfo } from '@shared/index';
import { IconScreen, IconWindow, IconRefresh } from '../UI/Icons';
import type { VideoConfig } from '@shared/index';
import styles from './CaptureSourceModal.module.css';

interface Props {
  /** Fonte atualmente selecionada (null = nenhuma) */
  selectedId: string | null;
  /** Estamos transmitindo (troca ao vivo) */
  isSharing?: boolean;
  /** Config de vídeo para o seletor de qualidade no rodapé */
  videoConfig: VideoConfig;
  onVideoConfigChange: (config: VideoConfig) => void;
  /** Confirmar seleção (também fecha o modal) */
  onConfirm: (sourceId: string) => void;
  /** Fechar sem confirmar */
  onClose: () => void;
}

type Tab = 'screen' | 'window';

const RESOLUTIONS = [
  { id: '1080p', label: '1080p', sub: 'FHD', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p', sub: '2K',  width: 2560, height: 1440 },
];

const isSafeDataUrl = (url: string) => url.startsWith('data:image/');

/**
 * Modal de seleção de fonte de captura — estilo Discord.
 * Apresenta duas abas (Tela Inteira / Aplicativos) com grade de miniaturas.
 * Não altera nenhuma lógica de captura; apenas apresenta os dados.
 */
const CaptureSourceModal: React.FC<Props> = ({
  selectedId,
  isSharing = false,
  videoConfig,
  onVideoConfigChange,
  onConfirm,
  onClose,
}) => {
  const [sources, setSources] = useState<CaptureSourceInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('screen');
  const [pendingId, setPendingId] = useState<string | null>(selectedId);
  const [confirming, setConfirming] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusableRef = useRef<HTMLButtonElement>(null);

  /* ── Carregar fontes ─────────────────────────────────────────────── */
  const load = useCallback(async () => {
    const host = window.screenShareHost;
    if (!host) return;
    setLoading(true);
    setError(null);
    try {
      const list = await host.capture.listSources();
      setSources(list);
      // mudar para a aba onde a seleção já está
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

  useEffect(() => { void load(); }, [load]);

  /* ── Focus trap ──────────────────────────────────────────────────── */
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    first?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, [onClose]);

  /* ── Navegação de teclado na grade ───────────────────────────────── */
  const gridRef = useRef<HTMLUListElement>(null);
  const handleGridKey = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const items = Array.from(gridRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLButtonElement);
    if (idx === -1) return;

    const cols = Math.round(items.length / Math.max(1, Math.ceil(items.length / 3))); // aprox
    let next = idx;
    if (e.key === 'ArrowRight') next = Math.min(idx + 1, items.length - 1);
    else if (e.key === 'ArrowLeft') next = Math.max(idx - 1, 0);
    else if (e.key === 'ArrowDown') next = Math.min(idx + cols, items.length - 1);
    else if (e.key === 'ArrowUp') next = Math.max(idx - cols, 0);
    else return;

    e.preventDefault();
    items[next]?.focus();
    setPendingId(items[next]?.dataset.sourceId ?? null);
  };

  /* ── Confirmar ───────────────────────────────────────────────────── */
  const handleConfirm = async () => {
    if (!pendingId || confirming) return;
    setConfirming(true);
    try {
      await Promise.resolve(onConfirm(pendingId));
      onClose();
    } finally {
      setConfirming(false);
    }
  };

  /* ── Filtrar por aba ──────────────────────────────────────────────── */
  const visible = sources.filter((s) =>
    tab === 'screen' ? s.type === 'screen' : s.type === 'window',
  );

  const screenCount = sources.filter((s) => s.type === 'screen').length;
  const windowCount = sources.filter((s) => s.type === 'window').length;

  return (
    /* Backdrop */
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Selecionar tela ou janela"
        className={styles.dialog}
      >
        {/* ── Cabeçalho ────────────────────────────────────────────── */}
        <div className={styles.header}>
          <h2 className={styles.title}>
            {isSharing ? 'Trocar fonte de transmissão' : 'Selecionar o que transmitir'}
          </h2>
          <button
            ref={firstFocusableRef}
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Fechar"
          >
            <IconClose />
          </button>
        </div>

        {/* ── Abas ─────────────────────────────────────────────────── */}
        <div className={styles.tabs} role="tablist">
          <button
            role="tab"
            type="button"
            aria-selected={tab === 'screen'}
            className={`${styles.tab} ${tab === 'screen' ? styles.tabActive : ''}`}
            onClick={() => setTab('screen')}
          >
            <IconScreen size={14} />
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
            <IconWindow size={14} />
            Aplicativos
            {windowCount > 0 && <span className={styles.tabCount}>{windowCount}</span>}
          </button>

          {/* Atualizar fontes */}
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

        {/* ── Corpo: grade de miniaturas ───────────────────────────── */}
        <div className={styles.body}>
          {/* Esqueleto de carregamento */}
          {loading && (
            <ul className={styles.grid} aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <li key={i} className={styles.skeleton} aria-hidden="true">
                  <div className={styles.skeletonThumb} />
                  <div className={styles.skeletonName} />
                </li>
              ))}
            </ul>
          )}

          {/* Erro */}
          {!loading && error && (
            <div className={styles.empty} role="alert">
              <p>{error}</p>
              <button type="button" className={styles.retryBtn} onClick={() => void load()}>
                Tentar novamente
              </button>
            </div>
          )}

          {/* Vazio */}
          {!loading && !error && visible.length === 0 && (
            <div className={styles.empty}>
              <p>Nenhum{tab === 'screen' ? 'a tela' : ' aplicativo'} encontrado.</p>
            </div>
          )}

          {/* Grade */}
          {!loading && !error && visible.length > 0 && (
            <ul
              ref={gridRef}
              className={styles.grid}
              onKeyDown={handleGridKey}
              aria-label={tab === 'screen' ? 'Telas disponíveis' : 'Janelas disponíveis'}
            >
              {visible.map((src) => {
                const isSelected = src.id === pendingId;
                const isLive = src.id === selectedId && isSharing;
                return (
                  <li key={src.id}>
                    <button
                      type="button"
                      data-source-id={src.id}
                      className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
                      onClick={() => setPendingId(src.id)}
                      onDoubleClick={() => { setPendingId(src.id); void handleConfirm(); }}
                      aria-pressed={isSelected}
                      title={isLive ? `(no ar) ${src.name}` : src.name}
                    >
                      {/* Miniatura */}
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
                            {src.type === 'screen'
                              ? <IconScreen size={28} />
                              : <IconWindow size={28} />}
                          </div>
                        )}
                        {isLive && <div className={styles.badgeLive}>NO AR</div>}
                        {isSelected && <div className={styles.selOverlay} aria-hidden="true" />}
                      </div>

                      {/* Nome */}
                      <span className={styles.name}>{src.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* ── Rodapé: qualidade + confirmar ───────────────────────── */}
        <div className={styles.footer}>
          {/* Seletor de qualidade compacto */}
          <div className={styles.qualityRow}>
            <span className={styles.qualityLabel}>Qualidade</span>
            <div className={styles.resChips}>
              {RESOLUTIONS.map((res) => {
                const active = res.width === videoConfig.width && res.height === videoConfig.height;
                return (
                  <button
                    key={res.id}
                    type="button"
                    className={`${styles.resChip} ${active ? styles.resChipActive : ''}`}
                    aria-pressed={active}
                    onClick={() => onVideoConfigChange({ ...videoConfig, width: res.width, height: res.height })}
                  >
                    {res.label}
                    <span className={styles.resSub}>{res.sub}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Ações */}
          <div className={styles.footerActions}>
            <button type="button" className={styles.cancelBtn} onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className={styles.confirmBtn}
              disabled={!pendingId || confirming}
              onClick={() => void handleConfirm()}
            >
              {confirming
                ? 'Aguarde…'
                : isSharing
                  ? 'Trocar'
                  : 'Transmitir esta tela'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

/* ── Ícone de fechar inline ─────────────────────────────────────────── */
const IconClose: React.FC = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="3" x2="13" y2="13" />
    <line x1="13" y1="3" x2="3" y2="13" />
  </svg>
);

export default CaptureSourceModal;
