import React, { useState } from 'react';
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
import styles from './HomePage.module.css';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const [codeInfo, setCodeInfo] = useState('');

  // Presente apenas no app instalado (preload do Electron)
  const host = window.screenShareHost;
  const isInstalledApp = host !== undefined;

  const handleJoin = async () => {
    setCodeError('');
    setCodeInfo('');

    const parsed = parseViewerInput(code);
    if (parsed.kind === 'invalid') {
      setCodeError(
        isInstalledApp
          ? 'Insira o link completo enviado pelo apresentador.'
          : 'Insira o código de 6 caracteres ou o link completo da transmissão.',
      );
      return;
    }

    if (isInstalledApp) {
      if (parsed.kind === 'code') {
        setCodeError(
          'No aplicativo instalado, cole o link completo recebido. ' +
          'O código de 6 caracteres funciona diretamente no navegador da transmissão.',
        );
        return;
      }
      const hostApp = host.app as typeof host.app | undefined;
      if (!hostApp) {
        setCodeError('Versão legada do aplicativo. Atualize para abrir links externos.');
        return;
      }
      try {
        await hostApp.openViewerLink(parsed.url);
        setCodeInfo('Abrindo transmissão no seu navegador padrão…');
      } catch {
        setCodeError('Não foi possível abrir o link. Verifique o endereço e tente novamente.');
      }
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

  return (
    <div className={styles.container}>
      {/* ── Top Bar / Header ────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.logoWrap}>
          <KiaraLogo size={22} withText />
        </div>
        <div className={styles.headerRight}>
          <ConnectionBadge state={connected ? 'connected' : 'connecting'} compact />
        </div>
      </header>

      {/* ── Conteúdo Central Minimalista ─────────────────────────────────── */}
      <main className={styles.main}>
        <div className={styles.heroText}>
          <h1 className={styles.title}>
            Compartilhamento de tela direto, sem atrito.
          </h1>
          <p className={styles.subtitle}>
            P2P WebRTC · 60 FPS nativo · Áudio por aplicativo
          </p>
        </div>

        {/* ── Grid Minimalista ────────────────────────────────────────────── */}
        <div className={styles.cardsGrid}>
          {/* Card: Host */}
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.cardTitleRow}>
                <IconBroadcast size={16} />
                <h2>Apresentar</h2>
              </div>
            </div>
            
            <p className={styles.cardDesc}>
              Compartilhe sua tela inteira ou janelas com áudio cristalino e link instantâneo.
            </p>

            <button
              type="button"
              className={styles.btnHost}
              onClick={() => navigate('/broadcast')}
              disabled={!connected}
            >
              <span>{connected ? 'Iniciar Transmissão' : 'Conectando…'}</span>
              <IconArrowRight size={15} />
            </button>
          </div>

          {/* Card: Viewer */}
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.cardTitleRow}>
                <IconEye size={16} />
                <h2>Assistir</h2>
              </div>
            </div>

            <p className={styles.cardDesc}>
              {isInstalledApp
                ? 'Cole o link completo da transmissão para abrir.'
                : 'Insira o código de 6 caracteres ou o link da sala.'}
            </p>

            <div className={styles.inputContainer}>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  aria-label={isInstalledApp ? 'Link da transmissão' : 'Código ou link da transmissão'}
                  placeholder={isInstalledApp ? 'Cole o link' : 'Código ou link'}
                  maxLength={MAX_INPUT_LENGTH}
                  value={code}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeError('');
                    setCodeInfo('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void handleJoin()}
                  className={styles.input}
                />
                <button
                  type="button"
                  className={styles.btnViewer}
                  onClick={() => void handleJoin()}
                  disabled={!isInstalledApp && !connected}
                >
                  <span>Entrar</span>
                </button>
              </div>

              {codeError && <p className={styles.error} role="alert">{codeError}</p>}
              {codeInfo && <p className={styles.info} role="status">{codeInfo}</p>}
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer Minimalista ──────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <span>KIARA · WebRTC P2P</span>
      </footer>
    </div>
  );
};

export default HomePage;
