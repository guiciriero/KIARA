/**
 * ViewerPage.tsx
 *
 * Página do modo espectador.
 * Recebe o código da sala via URL, conecta ao servidor e reproduz
 * o vídeo do apresentador assim que a conexão P2P for estabelecida.
 *
 * Autoplay com som: navegadores bloqueiam autoplay com som quando o espectador
 * acessa diretamente. O <video> inicia com `muted` para permitir autoplay imediato
 * do vídeo, e exibe um botão central para o espectador ativar o áudio com um clique.
 */

import React, { useRef, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useViewer } from '../hooks/useViewer';
import StatsOverlay from '../components/UI/StatsOverlay';
import ConnectionBadge from '../components/UI/ConnectionBadge';
import styles from './ViewerPage.module.css';

const ViewerPage: React.FC = () => {
  const { code }   = useParams<{ code: string }>();
  const navigate   = useNavigate();
  const videoRef   = useRef<HTMLVideoElement>(null);
  const { state, leaveRoom } = useViewer(code);
  const [isMuted, setIsMuted] = useState(true);

  // Conecta o stream remoto ao elemento <video> sempre que ele chegar
  useEffect(() => {
    if (videoRef.current && state.remoteStream) {
      videoRef.current.srcObject = state.remoteStream;
    }
  }, [state.remoteStream]);

  const handleEnableAudio = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      if (videoRef.current.paused) {
        videoRef.current.play().catch((err) => {
          console.warn('[ScreenShare] Erro ao reproduzir com áudio:', err);
        });
      }
    }
    setIsMuted(false);
  };

  const handleLeave = () => {
    leaveRoom();
    navigate('/');
  };

  // Apresentador encerrou a transmissão
  if (state.hostDisconnected) {
    return (
      <div className={styles.centeredMessage}>
        <span>📴</span>
        <h2>Transmissão encerrada</h2>
        <p>O apresentador encerrou o compartilhamento de tela. Obrigado por assistir!</p>
        <button className={styles.btnPrimary} onClick={() => navigate('/')}>
          Voltar ao início
        </button>
      </div>
    );
  }

  // Não foi possível entrar na sala
  if (state.error) {
    return (
      <div className={styles.centeredMessage}>
        <span>⚠️</span>
        <h2>Não foi possível entrar na sala</h2>
        <p>{state.error}</p>
        <button className={styles.btnPrimary} onClick={() => navigate('/')}>
          Voltar ao início
        </button>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
      {/* Barra superior com código da sala e botão de sair */}
      <header className={styles.topBar}>
        <div className={styles.roomBadge}>
          <span>Sala: </span>
          <strong>{code}</strong>
        </div>

        <div className={styles.centerBadges}>
          <ConnectionBadge state={state.connectionState} compact />
          {state.viewerCount > 0 && (
            <span className={styles.viewers}>👥 {state.viewerCount}</span>
          )}
        </div>

        <button className={styles.leaveBtn} onClick={handleLeave}>
          Sair
        </button>
      </header>

      {/* Área do player */}
      <div className={styles.playerContainer}>
        {/* Overlay de carregamento enquanto aguarda o vídeo chegar */}
        {state.connectionState !== 'connected' && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <p>
              {state.connectionState === 'reconnecting'
                ? 'Tentando reconectar…'
                : 'Aguardando o vídeo do apresentador…'}
            </p>
          </div>
        )}

        {/*
          autoPlay: reproduz automaticamente quando o stream chegar.
          muted: inicia mudo para respeitar a política de autoplay dos navegadores.
          playsInline: evita que o iOS abra o player em tela cheia.
          preload="none": não pré-carrega nada antes do stream estar disponível.
        */}
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          preload="none"
          className={styles.player}
        />

        {/* Botão de ativação de som quando o stream estiver conectado e ainda mudo */}
        {state.connectionState === 'connected' && isMuted && (
          <div className={styles.unmuteOverlay}>
            <button
              type="button"
              className={styles.unmuteBtn}
              onClick={handleEnableAudio}
              aria-label="Clique para ativar o som"
            >
              🔊 Clique para ativar o som
            </button>
          </div>
        )}

        {state.stats && <StatsOverlay stats={state.stats} />}
      </div>
    </div>
  );
};

export default ViewerPage;
