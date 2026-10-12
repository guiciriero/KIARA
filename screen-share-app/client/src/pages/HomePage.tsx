/**
 * HomePage.tsx
 * Página inicial — permite escolher entre "Compartilhar Tela" e "Entrar como Espectador".
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../services/SocketContext';
import { parseViewerInput, MAX_INPUT_LENGTH } from '../utils/viewerLink';
import styles from './HomePage.module.css';

const HomePage: React.FC = () => {
  const navigate   = useNavigate();
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
          ? 'Não entendi. Cole o link completo que a pessoa enviou para você.'
          : 'Não entendi. Digite o código de 6 caracteres ou cole o link completo da transmissão.',
      );
      return;
    }

    // ── App instalado: a sala existe no servidor de quem transmite ─────────
    if (isInstalledApp) {
      if (parsed.kind === 'code') {
        setCodeError(
          'Aqui no aplicativo, cole o link completo que a pessoa enviou. ' +
          'O código sozinho só funciona no site de quem está transmitindo.',
        );
        return;
      }
      const hostApp = host.app as typeof host.app | undefined; // preload antigo pode não ter `app`
      if (!hostApp) {
        setCodeError('Esta versão do aplicativo não abre links. Atualize o aplicativo e tente de novo.');
        return;
      }
      try {
        await hostApp.openViewerLink(parsed.url);
        setCodeInfo('Abrimos a transmissão no seu navegador.');
      } catch {
        setCodeError('Não foi possível abrir esse link. Confira se ele está completo e tente de novo.');
      }
      return;
    }

    // ── Navegador comum ─────────────────────────────────────────────────────
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
      <header className={styles.header}>
        <div className={styles.logo}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#5c6bc0"/>
            <path d="M8 10h16v2H8zm0 5h12v2H8zm0 5h10v2H8z" fill="white"/>
            <circle cx="24" cy="22" r="5" fill="#4caf7d" stroke="#0f1117" strokeWidth="2"/>
          </svg>
          <span>ScreenShare</span>
        </div>
        <div className={styles.connectionBadge} data-connected={connected}>
          <span className={styles.dot}/>
          {connected ? 'Conectado' : 'Aguardando conexão…'}
        </div>
      </header>

      <main className={styles.main}>
        <h1 className={styles.title}>Compartilhamento de Tela em Tempo Real</h1>
        <p className={styles.subtitle}>
          Transmita sua tela e áudio por aplicativo para múltiplos espectadores,
          sem atraso, com qualidade de até 4K.
        </p>

        <div className={styles.cards}>
          {/* Card: Apresentador */}
          <div className={styles.card}>
            <div className={styles.cardIcon}>📡</div>
            <h2>Compartilhar Minha Tela</h2>
            <p>Selecione janela, monitor ou região. Configure qualidade e fontes de áudio.</p>
            <button
              className={styles.btnPrimary}
              onClick={() => navigate('/broadcast')}
              disabled={!connected}
            >
              {connected ? 'Iniciar Compartilhamento' : 'Conectando…'}
            </button>
          </div>

          {/* Card: Espectador */}
          <div className={styles.card}>
            <div className={styles.cardIcon}>👁️</div>
            <h2>Assistir Compartilhamento</h2>
            <p>
              {isInstalledApp
                ? 'Cole o link que a pessoa enviou para você (por exemplo, pelo WhatsApp).'
                : 'Cole o link que a pessoa enviou ou digite o código de 6 caracteres.'}
            </p>
            <div className={styles.codeInput}>
              <input
                type="text"
                aria-label={isInstalledApp ? 'Link da transmissão' : 'Link ou código da transmissão'}
                placeholder={isInstalledApp ? 'Cole o link aqui' : 'Cole o link ou digite o código'}
                maxLength={MAX_INPUT_LENGTH}
                value={code}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => { setCode(e.target.value); setCodeError(''); setCodeInfo(''); }}
                onKeyDown={(e) => e.key === 'Enter' && void handleJoin()}
              />
              <button
                className={styles.btnSecondary}
                onClick={() => void handleJoin()}
                disabled={!isInstalledApp && !connected}
              >
                {isInstalledApp ? 'Assistir' : 'Entrar'}
              </button>
            </div>
            {codeError && <p className={styles.error} role="alert">{codeError}</p>}
            {codeInfo && <p className={styles.info} role="status">{codeInfo}</p>}
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        Funciona em Chrome, Edge e Firefox · WebRTC P2P com STUN/TURN · Criptografia DTLS
      </footer>
    </div>
  );
};

export default HomePage;
