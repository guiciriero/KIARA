import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../services/SocketContext';
import { parseViewerInput, MAX_INPUT_LENGTH } from '../utils/viewerLink';
import { KiaraLogo, IconBroadcast, IconEye, IconArrowRight } from '../components/UI/Icons';
import ConnectionBadge from '../components/UI/ConnectionBadge';
import ServerWakeNotice from '../components/UI/ServerWakeNotice';
import { useServerWake } from '../hooks/useServerWake';
import PixelShihTzu, { petCelebrate, petLookAt } from '../components/UI/PixelShihTzu/PixelShihTzu';
import VersionCorner from '../components/UI/VersionCorner';
import styles from './HomePage.module.css';

const INVALID_CODE_MESSAGE = 'Código inválido. Use 6 caracteres ou cole o link.';

const prefersReducedMotion = (): boolean =>
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Saudação curta conforme a hora do dia. */
function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Boa noite';
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

/**
 * Efeitos do cartão: spotlight caramelo que segue o cursor, leve tilt 3D e
 * o mascote "olhando" para o cartão em hover. Só escreve variáveis CSS (sem re-render).
 */
function useCardFx() {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    el.style.setProperty('--spot-x', `${px * 100}%`);
    el.style.setProperty('--spot-y', `${py * 100}%`);
    if (!prefersReducedMotion()) {
      el.style.setProperty('--ry', `${((px - 0.5) * 5).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${((0.5 - py) * 4).toFixed(2)}deg`);
    }
  }, []);

  const onMouseEnter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    petLookAt(rect.left + rect.width / 2);
  }, []);

  const onMouseLeave = useCallback(() => {
    const el = ref.current;
    if (el) {
      el.style.setProperty('--rx', '0deg');
      el.style.setProperty('--ry', '0deg');
    }
    petLookAt(null);
  }, []);

  return { ref, onMouseMove, onMouseEnter, onMouseLeave };
}

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const serverWake = useServerWake();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const host = window.screenShareHost;
  const isInstalledApp = host !== undefined;
  // No app Electron o TitleBar já mostra a marca e o tema: não duplicar
  const hasTitleBar = Boolean(window.screenShareHost?.window);

  const broadcastFx = useCardFx();
  const viewerFx = useCardFx();
  const hello = useMemo(greeting, []);

  const handleJoin = useCallback(() => {
    setCodeError('');
    const parsed = parseViewerInput(code);
    if (parsed.kind === 'invalid') {
      setCodeError(INVALID_CODE_MESSAGE);
      return;
    }
    if (parsed.kind === 'code') {
      navigate(`/view/${parsed.code}`);
      return;
    }
    if (parsed.origin === window.location.origin) {
      navigate(`/view/${parsed.code}`);
    } else {
      window.location.assign(parsed.url);
    }
  }, [code, navigate]);

  // O mascote comemora quando a conexão com o servidor se estabelece
  useEffect(() => {
    if (!connected) return undefined;
    const t = window.setTimeout(petCelebrate, 500);
    return () => window.clearTimeout(t);
  }, [connected]);

  // Atalhos: T = transmitir, A = assistir (foca o campo de código)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === 't' && connected) {
        e.preventDefault();
        navigate('/broadcast');
      } else if (key === 'a') {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [connected, navigate]);

  return (
    <div className={styles.container}>
      {/* Fundo: dois marrons em fade lento + grão fino (só no menu, parado em reduced-motion) */}
      <div className={styles.bg} aria-hidden="true">
        <div className={styles.bgAlt} />
        <div className={styles.grain} />
      </div>

      <header className={styles.header}>
        {!hasTitleBar ? (
          <div className={styles.logoWrap}>
            <KiaraLogo size={20} withText />
          </div>
        ) : (
          <span />
        )}
        <div className={styles.headerRight}>
          {!isInstalledApp && (
            <a href="/download/windows" className={styles.btnDownload}>
              Baixar para Windows
            </a>
          )}
          {!connected && <ConnectionBadge state="connecting" compact />}
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>
          {hello}. <span className={styles.titleSoft}>O que vamos fazer?</span>
        </h1>

        {serverWake.waking && <ServerWakeNotice seconds={serverWake.seconds} />}

        <div className={styles.cardsGrid}>
          {/* Transmitir: ação principal (cartão claro) */}
          <div
            ref={broadcastFx.ref}
            className={`${styles.card} ${styles.cardLight}`}
            style={{ '--i': 0 } as React.CSSProperties}
            onMouseMove={broadcastFx.onMouseMove}
            onMouseEnter={broadcastFx.onMouseEnter}
            onMouseLeave={broadcastFx.onMouseLeave}
          >
            <div className={styles.spotlight} aria-hidden="true" />
            <div className={styles.cardTop}>
              <div className={styles.cardIcon}>
                <IconBroadcast size={22} />
              </div>
              <kbd className={styles.kbd} aria-hidden="true">T</kbd>
            </div>
            <div className={styles.cardBottom}>
              <h2 className={styles.cardTitleLarge}>Transmitir</h2>
              <button
                type="button"
                className={styles.btnPrimary}
                onClick={() => navigate('/broadcast')}
                disabled={!connected}
                aria-keyshortcuts="T"
              >
                <span>{connected ? 'Começar' : 'Conectando…'}</span>
                <IconArrowRight size={16} />
              </button>
            </div>
          </div>

          {/* Assistir: cartão escuro com o código embutido */}
          <div
            ref={viewerFx.ref}
            className={`${styles.card} ${styles.cardDark}`}
            style={{ '--i': 1 } as React.CSSProperties}
            onMouseMove={viewerFx.onMouseMove}
            onMouseEnter={viewerFx.onMouseEnter}
            onMouseLeave={viewerFx.onMouseLeave}
          >
            <div className={styles.spotlight} aria-hidden="true" />
            <div className={styles.cardTop}>
              <div className={styles.cardIcon}>
                <IconEye size={20} />
              </div>
              <kbd className={styles.kbd} aria-hidden="true">A</kbd>
            </div>
            <div className={styles.cardBottom}>
              <h2 className={styles.cardTitle}>Assistir</h2>
              <div className={styles.inputRow}>
                <input
                  ref={inputRef}
                  type="text"
                  id="kiara-join-input"
                  aria-invalid={codeError !== ''}
                  aria-describedby={codeError ? 'kiara-join-error' : undefined}
                  aria-label="Código ou link da sala"
                  aria-keyshortcuts="A"
                  placeholder="Código ou link da sala"
                  maxLength={MAX_INPUT_LENGTH}
                  value={code}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => { setCode(e.target.value); setCodeError(''); }}
                  onBlur={() => {
                    if (code.trim() && parseViewerInput(code).kind === 'invalid') {
                      setCodeError(INVALID_CODE_MESSAGE);
                    }
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
                  className={styles.input}
                />
                <button
                  type="button"
                  className={styles.btnJoin}
                  onClick={handleJoin}
                  disabled={!connected || code.trim() === ''}
                  aria-label="Entrar na sala"
                  title="Entrar na sala"
                >
                  <IconArrowRight size={16} />
                </button>
              </div>
              {codeError && (
                <p id="kiara-join-error" className={styles.error} role="alert">
                  {codeError}
                </p>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Único mascote do menu: segue o mouse, pointer-events: none, luz quente atrás */}
      <PixelShihTzu followCursor glow zIndex={100} />

      <VersionCorner />
    </div>
  );
};

export default HomePage;
