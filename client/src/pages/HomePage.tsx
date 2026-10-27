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
import UpdateButton from '../components/UI/UpdateButton';
import ServerWakeNotice from '../components/UI/ServerWakeNotice';
import { useServerWake } from '../hooks/useServerWake';
import PixelShihTzu from '../components/UI/PixelShihTzu/PixelShihTzu';
import styles from './HomePage.module.css';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const serverWake = useServerWake();
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
      setCodeError('Insira o código de 6 caracteres ou o link completo da transmissão.');
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
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className={styles.header}>
        <div className={styles.logoWrap}>
          <KiaraLogo size={22} withText />
        </div>
        <div className={styles.headerRight}>
          {!isInstalledApp && (
            <a
              href="/download/windows"
              className={styles.btnDownload}
              title="Baixa o instalador da versão mais recente do KIARA para Windows"
            >
              Baixar para Windows
            </a>
          )}
          <UpdateButton />
          <ConnectionBadge state={connected ? 'connected' : 'connecting'} compact />
        </div>
      </header>

      {/* ── Conteúdo Central ─────────────────────────────────────────────── */}
      <main className={styles.main}>
        {/* Hero: shitzu é o personagem do app */}
        <div className={styles.hero}>
          <div className={styles.shihtzuWrap}>
            {/* Mascote inline: pose idle, escala 5x — display prop, não bloqueia cliques */}
            <PixelShihTzu
              pose="idle"
              scale={5}
              speech={connected ? undefined : 'Conectando…'}
            />
          </div>
          <h1 className={styles.title}>
            Compartilhamento de tela direto, sem atrito.
          </h1>
        </div>

        {serverWake.waking && <ServerWakeNotice seconds={serverWake.seconds} />}

        {/* ── Cards de ação ─────────────────────────────────────────────── */}
        <div className={styles.cardsGrid}>

          {/* Card: Transmitir */}
          <div className={`${styles.card} ${styles.cardBroadcast}`}>
            <div className={styles.cardTop}>
              <div className={styles.cardTitleRow}>
                <div className={styles.cardIcon}>
                  <IconBroadcast size={16} />
                </div>
                <h2>Transmitir</h2>
              </div>
            </div>

            <p className={styles.cardDesc}>
              Compartilhe sua tela ou janela com áudio e link fixo instantâneo.
            </p>

            <button
              type="button"
              className={styles.btnHost}
              onClick={() => navigate('/broadcast')}
              disabled={!connected}
            >
              <span>{connected ? 'Iniciar' : 'Conectando…'}</span>
              <IconArrowRight size={15} />
            </button>
          </div>

          {/* Card: Assistir */}
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.cardTitleRow}>
                <div className={styles.cardIcon}>
                  <IconEye size={16} />
                </div>
                <h2>Assistir</h2>
              </div>
            </div>

            <p className={styles.cardDesc}>
              Cole o código de 6 caracteres ou o link da sala.
            </p>

            <div className={styles.inputContainer}>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  id="kiara-join-input"
                  aria-invalid={codeError !== ''}
                  aria-describedby={codeError ? 'kiara-join-error' : undefined}
                  aria-label="Código ou link da transmissão"
                  placeholder="Código ou link"
                  maxLength={MAX_INPUT_LENGTH}
                  value={code}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeError('');
                    setCodeInfo('');
                  }}
                  onBlur={() => {
                    if (code.trim() !== '' && parseViewerInput(code).kind === 'invalid') {
                      setCodeError('Insira o código de 6 caracteres ou o link completo da transmissão.');
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void handleJoin()}
                  className={styles.input}
                />
                <button
                  type="button"
                  className={styles.btnViewer}
                  onClick={() => void handleJoin()}
                  disabled={!connected}
                >
                  Entrar
                </button>
              </div>

              {codeError && <p id="kiara-join-error" className={styles.error} role="alert">{codeError}</p>}
              {codeInfo && <p className={styles.info} role="status">{codeInfo}</p>}
            </div>
          </div>

        </div>
      </main>

      {/* Shitzu seguindo o cursor — elemento de charme, pointer-events: none */}
      <PixelShihTzu followCursor />
    </div>
  );
};

export default HomePage;
