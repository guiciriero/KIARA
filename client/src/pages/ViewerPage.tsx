import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useViewer } from '../hooks/useViewer';
import {
  KiaraLogo,
  IconArrowLeft,
  IconVolumeHigh,
  IconVolumeMute,
  IconFullscreen,
  IconExitFullscreen,
  IconActivity,
  IconUsers,
  IconAlertTriangle,
  IconSparkles,
} from '../components/UI/Icons';
import StatsOverlay from '../components/UI/StatsOverlay';
import ConnectionBadge from '../components/UI/ConnectionBadge';
import styles from './ViewerPage.module.css';

const ViewerPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { state, leaveRoom, setQuality } = useViewer(code);
  const [isMuted, setIsMuted] = useState(true);
  const [localVolume, setLocalVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Conecta o stream remoto ao elemento <video>
  useEffect(() => {
    if (videoRef.current && state.remoteStream) {
      videoRef.current.srcObject = state.remoteStream;
    }
  }, [state.remoteStream]);

  // Aplica o volume local ao <video>
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = localVolume;
    }
  }, [localVolume]);

  // Listener para estado de tela cheia
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Autohide de controles após inatividade do mouse
  const resetHideTimer = useCallback(() => {
    setShowControls(true);
    if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = setTimeout(() => {
      if (state.connectionState === 'connected' && !isMuted) {
        setShowControls(false);
      }
    }, 3200);
  }, [state.connectionState, isMuted]);

  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
    };
  }, []);

  const handleEnableAudio = () => {
    if (videoRef.current) {
      videoRef.current.muted = false;
      videoRef.current.volume = localVolume;
      if (videoRef.current.paused) {
        videoRef.current.play().catch((err) => {
          console.warn('[KIARA] Erro ao reproduzir com áudio:', err);
        });
      }
    }
    setIsMuted(false);
    resetHideTimer();
  };

  const handleToggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    resetHideTimer();
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setLocalVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      if (val > 0 && isMuted) {
        videoRef.current.muted = false;
        setIsMuted(false);
      }
    }
    resetHideTimer();
  };

  const handleToggleFullscreen = async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (err) {
      console.warn('[KIARA] Erro ao alternar tela cheia:', err);
    }
    resetHideTimer();
  };

  const handleLeave = () => {
    leaveRoom();
    navigate('/');
  };

  // ── Estado: Apresentador encerrou a transmissão ─────────────────────────
  if (state.hostDisconnected) {
    return (
      <div className={styles.centeredPage}>
        <div className={styles.messageCard}>
          <div className={styles.messageIconWrap}>
            <IconSparkles size={36} />
          </div>
          <h2>Transmissão Finalizada</h2>
          <p>
            O apresentador encerrou o compartilhamento de tela. Esperamos que a experiência tenha
            sido excelente!
          </p>
          <button type="button" className={styles.btnPrimary} onClick={() => navigate('/')}>
            <span>Voltar à Página Inicial</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Estado: Erro ao conectar na sala ────────────────────────────────────
  if (state.error) {
    return (
      <div className={styles.centeredPage}>
        <div className={styles.messageCard}>
          <div className={`${styles.messageIconWrap} ${styles.errorIconWrap}`}>
            <IconAlertTriangle size={36} />
          </div>
          <h2>Não foi possível entrar na sala</h2>
          <p>{state.error}</p>
          <button type="button" className={styles.btnPrimary} onClick={() => navigate('/')}>
            <span>Voltar e Conferir Código</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={styles.playerLayout}
      onMouseMove={resetHideTimer}
      onClick={resetHideTimer}
    >
      {/* ── Barra Superior Flutuante do Player ────────────────────────────── */}
      <header className={`${styles.topBar} ${!showControls ? styles.hidden : ''}`}>
        <div className={styles.topBarLeft}>
          <KiaraLogo size={22} withText />
          <div className={styles.roomPill}>
            <span className={styles.roomLabel}>SALA</span>
            <strong className={styles.roomCode}>{code}</strong>
          </div>
        </div>

        <div className={styles.topBarCenter}>
          <ConnectionBadge state={state.connectionState} compact />
          {state.viewerCount > 0 && (
            <div className={styles.viewersBadge}>
              <IconUsers size={14} />
              <span>{state.viewerCount}</span>
            </div>
          )}
        </div>

        <div className={styles.topBarRight}>
          <button
            type="button"
            className={styles.leaveBtn}
            onClick={handleLeave}
            title="Sair da transmissão"
          >
            <IconArrowLeft size={15} />
            <span>Sair</span>
          </button>
        </div>
      </header>

      {/* ── Área Central do Vídeo ────────────────────────────────────────── */}
      <div className={styles.videoViewport}>
        {/* Loading / Reconectando */}
        {state.connectionState !== 'connected' && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
            <h3>
              {state.connectionState === 'reconnecting'
                ? 'Tentando restabelecer conexão…'
                : 'Aguardando o vídeo do apresentador…'}
            </h3>
            <p>Conexão direta em andamento</p>
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          preload="none"
          className={styles.videoElement}
        />

        {/* Botão Central de Desmutar (Unmute Overlay) */}
        {state.connectionState === 'connected' && isMuted && (
          <div className={styles.unmuteOverlay}>
            <button
              type="button"
              className={styles.unmuteButton}
              onClick={handleEnableAudio}
              aria-label="Clique para ativar o áudio da transmissão"
            >
              <div className={styles.unmuteIconBox}>
                <IconVolumeHigh size={24} />
              </div>
              <div className={styles.unmuteText}>
                <strong>Ativar Som da Transmissão</strong>
                <span>Clique para ouvir em tempo real</span>
              </div>
            </button>
          </div>
        )}

        {/* Telemetria de Estatísticas */}
        {showStats && state.stats && <StatsOverlay stats={state.stats} />}
      </div>

      {/* ── Barra Inferior Flutuante de Controles do Player ──────────────── */}
      <footer className={`${styles.bottomBar} ${!showControls ? styles.hidden : ''}`}>
        <div className={styles.bottomBarLeft}>
          <div className={styles.liveIndicator}>
            <span className={styles.liveDot} />
            <span>AO VIVO</span>
          </div>

          {/* Controle de Volume do Espectador */}
          <div className={styles.volumeControl}>
            <button
              type="button"
              className={styles.iconBtn}
              onClick={handleToggleMute}
              title={isMuted ? 'Desmutar áudio' : 'Mutar áudio'}
              aria-label={isMuted ? 'Desmutar áudio' : 'Mutar áudio'}
            >
              {isMuted || localVolume === 0 ? (
                <IconVolumeMute size={18} />
              ) : (
                <IconVolumeHigh size={18} />
              )}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={isMuted ? 0 : localVolume}
              onChange={handleVolumeChange}
              className={styles.volumeSlider}
              aria-label="Volume da transmissão"
            />
          </div>
        </div>

        <div className={styles.bottomBarRight}>
          {/* Seletor Individual de Resolução / Qualidade */}
          {state.connectionState === 'connected' && (
            <div className={styles.qualitySelectWrapper}>
              <select
                className={styles.qualitySelect}
                value={state.selectedQuality}
                onChange={(e) => {
                  setQuality(e.target.value as any);
                  resetHideTimer();
                }}
                title="Qualidade de Reprodução"
                aria-label="Qualidade de Reprodução"
              >
                <option value="auto">Qualidade: Auto</option>
                <option value="1080p">1080p (FHD)</option>
                <option value="720p">720p (HD)</option>
                <option value="480p">480p (SD)</option>
                <option value="360p">360p (Economia)</option>
              </select>
            </div>
          )}

          {/* Toggle de Telemetria */}
          {state.stats && (
            <button
              type="button"
              className={`${styles.iconBtn} ${showStats ? styles.activeBtn : ''}`}
              onClick={() => {
                setShowStats(!showStats);
                resetHideTimer();
              }}
              title="Exibir telemetria e latência"
              aria-label="Telemetria da transmissão"
            >
              <IconActivity size={18} />
            </button>
          )}

          {/* Botão de Tela Cheia */}
          <button
            type="button"
            className={styles.iconBtn}
            onClick={handleToggleFullscreen}
            title={isFullscreen ? 'Sair de tela cheia' : 'Tela cheia'}
            aria-label={isFullscreen ? 'Sair de tela cheia' : 'Tela cheia'}
          >
            {isFullscreen ? <IconExitFullscreen size={18} /> : <IconFullscreen size={18} />}
          </button>
        </div>
      </footer>
    </div>
  );
};

export default ViewerPage;
