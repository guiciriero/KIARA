/**
 * HomePage.tsx
 * Página inicial — permite escolher entre "Compartilhar Tela" e "Entrar como Espectador".
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSocket } from '../services/SocketContext';
import styles from './HomePage.module.css';

const HomePage: React.FC = () => {
  const navigate   = useNavigate();
  const { connected } = useSocket();
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');

  const handleJoin = () => {
    const trimmed = code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (trimmed.length !== 6) {
      setCodeError('O código deve ter 6 caracteres.');
      return;
    }
    setCodeError('');
    navigate(`/view/${trimmed}`);
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
            <p>Digite o código de convite para ver a tela de outro usuário em tempo real.</p>
            <div className={styles.codeInput}>
              <input
                type="text"
                placeholder="Código (ex.: AB3X7K)"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
              <button
                className={styles.btnSecondary}
                onClick={handleJoin}
                disabled={!connected}
              >
                Entrar
              </button>
            </div>
            {codeError && <p className={styles.error}>{codeError}</p>}
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
