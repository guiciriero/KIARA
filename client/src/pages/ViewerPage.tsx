import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useViewer } from '../hooks/useViewer';
import { useChat } from '../hooks/useChat';
import { useSocket } from '../services/SocketContext';
import { isValidRoomCode } from '../utils/viewerLink';
import type { ViewerQualityPreference } from '@shared/index';
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
  IconLock,
} from '../components/UI/Icons';
import StatsOverlay from '../components/UI/StatsOverlay';
import ConnectionBadge from '../components/UI/ConnectionBadge';
import ChatPanel, { ReactionOverlay } from '../components/UI/ChatPanel';
import styles from './ViewerPage.module.css';

const ViewerPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { state, leaveRoom, setQuality, join } = useViewer(code);
  const { socket } = useSocket();
  const chat = useChat();
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState(() => {
    try {
      return localStorage.getItem('kiara:name') ?? '';
    } catch {
      return '';
    }
  });
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

  const handleSubmitPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput.length === 0) return;
    join({ password: passwordInput, name: nameInput.trim() || undefined });
  };

  // Atalhos: F = tela cheia, M = mutar (ignorados enquanto se digita em campos)
  const shortcutsRef = useRef({ fullscreen: handleToggleFullscreen, mute: handleToggleMute });
  shortcutsRef.current = { fullscreen: handleToggleFullscreen, mute: handleToggleMute };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        e.preventDefault();
        void shortcutsRef.current.fullscreen();
      } else if (key === 'm') {
        e.preventDefault();
        shortcutsRef.current.mute();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── Estado: código inválido na URL ─────────────────────────────────────
  if (!code || !isValidRoomCode(code.toUpperCase())) {
    return (
      <div className={styles.centeredPage}>
        <div className={styles.messageCard}>
          <div className={`${styles.messageIconWrap} ${styles.errorIconWrap}`}>
            <IconAlertTriangle size={36} />
          </div>
          <h2>Código inválido</h2>
          <p>O código deve ter 6 caracteres (letras e números). Confira o link recebido.</p>
          <button type="button" className={styles.btnPrimary} onClick={() => navigate('/')}>
            <span>Voltar à Página Inicial</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Estado: Apresentador encerrou a transmissão ou reconexão esgotada ──
  if (state.roomClosed) {
    return (
      <div className={styles.centeredPage}>
        <div className={styles.messageCard} role="alert">
          <div className={styles.messageIconWrap}>
            <IconSparkles size={36} />
          </div>
          <h2>{state.hostDisconnected ? 'Transmissão finalizada' : 'Sala indisponível'}</h2>
          <p>
            {state.hostDisconnected
              ? 'O apresentador encerrou o compartilhamento de tela.'
              : 'Não foi possível reconectar à sala. Ela pode ter sido encerrada.'}
          </p>
          <button type="button" className={styles.btnPrimary} onClick={handleLeave}>
            <span>Voltar à Página Inicial</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Estado: pedir senha (e apelido) ─────────────────────────────────────
  if (state.needsPassword) {
    return (
      <div className={styles.centeredPage}>
        <form className={styles.messageCard} onSubmit={handleSubmitPassword}>
          <div className={styles.messageIconWrap}>
            <IconLock size={32} />
          </div>
          <h2>Sala protegida</h2>
          <p>Digite a senha enviada pelo apresentador.</p>
          <label htmlFor="kiara-viewer-name" className={styles.fieldLabel}>Seu apelido (opcional)</label>
          <input
            id="kiara-viewer-name"
            className={styles.textInput}
            type="text"
            maxLength={30}
            autoComplete="nickname"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <label htmlFor="kiara-viewer-password" className={styles.fieldLabel}>Senha</label>
          <input
            id="kiara-viewer-password"
            className={styles.textInput}
            type="password"
            autoComplete="current-password"
            autoFocus
            value={passwordInput}
            aria-invalid={state.wrongPassword}
            aria-describedby={state.error ? 'kiara-viewer-password-error' : undefined}
            onChange={(e) => setPasswordInput(e.target.value)}
          />
          {state.wrongPassword && (
            <p id="kiara-viewer-password-error" className={styles.fieldError} role="alert">
              {state.error ?? 'Senha incorreta.'}
            </p>
          )}
          <button type="submit" className={styles.btnPrimary} disabled={passwordInput.length === 0}>
            <span>Entrar</span>
          </button>
          <button type="button" className={styles.btnSecondary} onClick={handleLeave}>
            <span>Voltar</span>
          </button>
        </form>
      </div>
    );
  }

  // ── Estado: aguardando aprovação do apresentador ────────────────────────
  if (state.pendingApproval) {
    return (
      <div className={styles.centeredPage}>
        <div className={styles.messageCard} role="status" aria-live="polite">
          <div className={styles.spinner} />
          <h2>Aguardando aprovação</h2>
          <p>O apresentador precisa aceitar a sua entrada. Mantenha esta página aberta.</p>
          <button type="button" className={styles.btnSecondary} onClick={handleLeave}>
            <span>Cancelar</span>
          </button>
        </div>
      </div>
    );
  }

  // ── Estado: erro ao conectar na sala ────────────────────────────────────
  if (state.error) {
    const messages: Partial<Record<string, { title: string; text: string }>> = {
      'room-full': {
        title: 'Sala cheia',
        text: 'A sala atingiu o limite de espectadores. Peça ao apresentador para liberar uma vaga.',
      },
      denied: {
        title: 'Entrada não autorizada',
        text: 'O apresentador não aprovou a sua entrada (ou não respondeu a tempo).',
      },
      'not-found': {
        title: 'Sala não encontrada',
        text: 'Confira o código. A sala pode já ter sido encerrada.',
      },
      closed: { title: 'Sala encerrada', text: 'Esta sala já foi encerrada pelo apresentador.' },
      'rate-limited': {
        title: 'Muitas tentativas',
        text: 'Aguarde um minuto antes de tentar entrar de novo.',
      },
      'server-busy': {
        title: 'Servidor ocupado',
        text: 'O servidor está no limite agora. Tente novamente em alguns minutos.',
      },
    };
    const info = (state.errorCode && messages[state.errorCode]) || {
      title: 'Não foi possível entrar na sala',
      text: state.error,
    };
    return (
      <div className={styles.centeredPage}>
        <div className={styles.messageCard} role="alert">
          <div className={`${styles.messageIconWrap} ${styles.errorIconWrap}`}>
            <IconAlertTriangle size={36} />
          </div>
          <h2>{info.title}</h2>
          <p>{info.text}</p>
          <button type="button" className={styles.btnPrimary} onClick={handleLeave}>
            <span>Voltar e conferir o código</span>
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
          <div className={styles.loadingOverlay} role="status" aria-live="polite">
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

        <ReactionOverlay reactions={chat.reactions} />

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
              title={isMuted ? 'Desmutar áudio (M)' : 'Mutar áudio (M)'}
              aria-label={isMuted ? 'Desmutar áudio' : 'Mutar áudio'}
              aria-keyshortcuts="M"
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
          {state.connectionState === 'connected' && (
            <ChatPanel
              messages={chat.messages}
              reactions={chat.reactions}
              unreadCount={chat.unreadCount}
              onSend={chat.sendMessage}
              onReact={chat.sendReaction}
              onMarkRead={chat.markRead}
              selfId={socket?.id}
            />
          )}
          {/* Seletor Individual de Resolução / Qualidade */}
          {state.connectionState === 'connected' && (
            <div className={styles.qualitySelectWrapper}>
              <select
                className={styles.qualitySelect}
                value={state.selectedQuality}
                onChange={(e) => {
                  setQuality(e.target.value as ViewerQualityPreference);
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
            title={isFullscreen ? 'Sair de tela cheia (F)' : 'Tela cheia (F)'}
            aria-label={isFullscreen ? 'Sair de tela cheia' : 'Tela cheia'}
            aria-keyshortcuts="F"
          >
            {isFullscreen ? <IconExitFullscreen size={18} /> : <IconFullscreen size={18} />}
          </button>
        </div>
      </footer>
    </div>
  );
};

export default ViewerPage;
