import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../services/SocketContext';
import { parseViewerInput, MAX_INPUT_LENGTH } from '../utils/viewerLink';
import {
  KiaraLogo,
  IconBroadcast,
  IconEye,
  IconArrowRight,
} from '../components/UI/Icons';
import ConnectionBadge from '../components/UI/ConnectionBadge';
import ServerWakeNotice from '../components/UI/ServerWakeNotice';
import { useServerWake } from '../hooks/useServerWake';
import PixelShihTzu from '../components/UI/PixelShihTzu/PixelShihTzu';
import VersionCorner from '../components/UI/VersionCorner';
import styles from './HomePage.module.css';

/** Atualiza o glow de spotlight no card conforme o mouse se move sobre ele */
function useCardSpotlight() {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    el.style.setProperty('--spot-x', `${x}%`);
    el.style.setProperty('--spot-y', `${y}%`);
  }, []);

  const onMouseLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.setProperty('--spot-x', '50%');
    el.style.setProperty('--spot-y', '50%');
  }, []);

  return { ref, onMouseMove, onMouseLeave };
}

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const serverWake = useServerWake();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');

  const host = window.screenShareHost;
  const isInstalledApp = host !== undefined;

  const broadcastSpot = useCardSpotlight();
  const viewerSpot = useCardSpotlight();

  const handleJoin = async () => {
    setCodeError('');
    const parsed = parseViewerInput(code);
    if (parsed.kind === 'invalid') {
      setCodeError('Código inválido — use 6 caracteres ou cole o link.');
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
  };

  // No app Electron o TitleBar (em App.tsx) já mostra o logo — não duplicar
  const hasTitleBar = Boolean(window.screenShareHost?.window);

  return (
    <div className={styles.container}>
      {/* ── Fundo animado: malha de gradiente lenta ─────────────────────── */}
      <div className={styles.bgMesh} aria-hidden="true" />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        {!hasTitleBar && (
          <div className={styles.logoWrap}>
            <KiaraLogo size={20} withText />
          </div>
        )}
        <div className={styles.headerRight}>
          {!isInstalledApp && (
            <a
              href="/download/windows"
              className={styles.btnDownload}
              title="Baixar o instalador para Windows"
            >
              Baixar para Windows
            </a>
          )}
          <ConnectionBadge state={connected ? 'connected' : 'connecting'} compact />
        </div>
      </header>

      {/* ── Conteúdo central ─────────────────────────────────────────────── */}
      <main className={styles.main}>
        {/* Estado de conexão: só exibido quando desconectado — sem ponto verde redundante */}
        {!connected && (
          <div className={styles.eyebrow}>
            Conectando ao servidor…
          </div>
        )}

        <h1 className={styles.title}>
          Compartilhe sua tela.<br />Sem complicação.
        </h1>

        {serverWake.waking && <ServerWakeNotice seconds={serverWake.seconds} />}

        {/* ── Cards ────────────────────────────────────────────────────── */}
        <div className={styles.cardsGrid}>

          {/* Card Transmitir */}
          <div
            ref={broadcastSpot.ref}
            className={`${styles.card} ${styles.cardBroadcast}`}
            onMouseMove={broadcastSpot.onMouseMove}
            onMouseLeave={broadcastSpot.onMouseLeave}
          >
            <div className={styles.spotlight} aria-hidden="true" />
            <div className={styles.cardHeader}>
              <div className={styles.cardIcon}>
                <IconBroadcast size={18} />
              </div>
              <h2 className={styles.cardTitle}>Transmitir</h2>
            </div>
            <p className={styles.cardDesc}>
              Compartilhe tela e áudio com um link fixo instantâneo.
            </p>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => navigate('/broadcast')}
              disabled={!connected}
            >
              <span>{connected ? 'Começar' : 'Aguarde…'}</span>
              <IconArrowRight size={15} />
            </button>
            <span className={styles.cardKbd} aria-hidden="true">T</span>
          </div>

          {/* Card Assistir */}
          <div
            ref={viewerSpot.ref}
            className={styles.card}
            onMouseMove={viewerSpot.onMouseMove}
            onMouseLeave={viewerSpot.onMouseLeave}
          >
            <div className={styles.spotlight} aria-hidden="true" />
            <div className={styles.cardHeader}>
              <div className={styles.cardIcon}>
                <IconEye size={18} />
              </div>
              <h2 className={styles.cardTitle}>Assistir</h2>
            </div>
            <p className={styles.cardDesc}>
              Cole o código de 6 dígitos ou o link da sala.
            </p>
            <div className={styles.inputRow}>
              <input
                type="text"
                id="kiara-join-input"
                aria-invalid={codeError !== ''}
                aria-describedby={codeError ? 'kiara-join-error' : undefined}
                aria-label="Código ou link da transmissão"
                placeholder="abc123 ou https://…"
                maxLength={MAX_INPUT_LENGTH}
                value={code}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => { setCode(e.target.value); setCodeError(''); }}
                onBlur={() => {
                  if (code.trim() && parseViewerInput(code).kind === 'invalid')
                    setCodeError('Código inválido — use 6 caracteres ou cole o link.');
                }}
                onKeyDown={(e) => e.key === 'Enter' && void handleJoin()}
                className={styles.input}
              />
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => void handleJoin()}
                disabled={!connected}
              >
                Entrar
              </button>
            </div>
            {codeError && (
              <p id="kiara-join-error" className={styles.error} role="alert">
                {codeError}
              </p>
            )}
            <span className={styles.cardKbd} aria-hidden="true">A</span>
          </div>

        </div>
      </main>

      {/* Shih Tzu seguindo o cursor — identidade do app, pointer-events: none */}
      <PixelShihTzu followCursor zIndex={100} />

      {/* ── Canto inferior direito: versão + botão de atualização ────────── */}
      <VersionCorner />
    </div>
  );
};

export default HomePage;
