import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../services/SocketContext';
import { parseViewerInput, MAX_INPUT_LENGTH } from '../utils/viewerLink';
import {
  KiaraLogo,
  IconBroadcast,
  IconEye,
  IconArrowRight,
  IconShield,
  IconZap,
  IconSparkles,
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
          <KiaraLogo size={32} withText />
          <span className={styles.versionBadge}>v1.0</span>
        </div>
        <div className={styles.headerRight}>
          <ConnectionBadge state={connected ? 'connected' : 'connecting'} compact />
        </div>
      </header>

      {/* ── Hero Principal ──────────────────────────────────────────────── */}
      <main className={styles.main}>
        <div className={styles.heroText}>
          <div className={styles.pillLabel}>
            <IconSparkles size={13} className={styles.pillIcon} />
            <span>Compartilhamento P2P de Alta Fidelidade</span>
          </div>
          <h1 className={styles.title}>
            Transmita sua tela com fluidez absoluta e zero complicação
          </h1>
          <p className={styles.subtitle}>
            Conexão direta WebRTC ponto a ponto, áudio por aplicativo individual,
            qualidade de até 4K a 60 FPS e criptografia ponta a ponta.
          </p>
        </div>

        {/* ── Grid de Seleção de Modo (Host vs Viewer) ────────────────────── */}
        <div className={styles.cardsGrid}>
          {/* Card: Host (Apresentador) */}
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.cardIconBox}>
                <IconBroadcast size={24} />
              </div>
              <span className={styles.cardTag}>Apresentador</span>
            </div>
            
            <div className={styles.cardContent}>
              <h2>Compartilhar Tela</h2>
              <p>
                Escolha monitores ou janelas específicas, selecione canais de áudio de aplicativos
                individuais e gere um link seguro em segundos.
              </p>
            </div>

            <div className={styles.cardFeatures}>
              <span>4K / 60 FPS</span>
              <span>•</span>
              <span>Áudio por App</span>
              <span>•</span>
              <span>Multi-viewers</span>
            </div>

            <button
              type="button"
              className={styles.btnHost}
              onClick={() => navigate('/broadcast')}
              disabled={!connected}
            >
              <span>{connected ? 'Iniciar como Host' : 'Conectando ao servidor…'}</span>
              <IconArrowRight size={16} />
            </button>
          </div>

          {/* Card: Viewer (Espectador) */}
          <div className={styles.card}>
            <div className={styles.cardTop}>
              <div className={styles.cardIconBox}>
                <IconEye size={24} />
              </div>
              <span className={styles.cardTag}>Espectador</span>
            </div>

            <div className={styles.cardContent}>
              <h2>Assistir Transmissão</h2>
              <p>
                {isInstalledApp
                  ? 'Cole o link completo que você recebeu para assistir em alta fidelidade no seu navegador.'
                  : 'Digite o código de 6 caracteres ou cole o link da transmissão para entrar na sala.'}
              </p>
            </div>

            <div className={styles.inputContainer}>
              <div className={styles.inputWrapper}>
                <input
                  type="text"
                  aria-label={isInstalledApp ? 'Link da transmissão' : 'Código ou link da transmissão'}
                  placeholder={isInstalledApp ? 'https://… ou cole o link' : 'Código (ex: 7KJ89X) ou link'}
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
                  <span>{isInstalledApp ? 'Assistir' : 'Entrar'}</span>
                </button>
              </div>

              {codeError && <p className={styles.error} role="alert">{codeError}</p>}
              {codeInfo && <p className={styles.info} role="status">{codeInfo}</p>}
            </div>
          </div>
        </div>

        {/* ── Destaques de Segurança e Arquitetura ───────────────────────── */}
        <div className={styles.featuresBanner}>
          <div className={styles.featureItem}>
            <IconZap size={16} className={styles.featureIcon} />
            <span>Baixíssima Latência P2P</span>
          </div>
          <div className={styles.featureItem}>
            <IconShield size={16} className={styles.featureIcon} />
            <span>Criptografia DTLS 1.2 + SRTP</span>
          </div>
          <div className={styles.featureItem}>
            <IconSparkles size={16} className={styles.featureIcon} />
            <span>Sem Necessidade de Cadastro</span>
          </div>
        </div>
      </main>

      {/* ── Footer ────────────────────────────────────────────────────── */}
      <footer className={styles.footer}>
        <span>KIARA · Compartilhamento de tela em tempo real com áudio isolado por processo</span>
      </footer>
    </div>
  );
};

export default HomePage;
