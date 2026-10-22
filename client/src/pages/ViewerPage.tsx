import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useViewer } from '../hooks/useViewer';
import { useReactions } from '../hooks/useReactions';
import { useCopresenter } from '../hooks/useCopresenter';
import { useAudioSources } from '../hooks/useAudioSources';
import { useSocket } from '../services/SocketContext';
import { isDisplayCaptureSupported } from '../services/captureService';
import { isValidRoomCode } from '../utils/viewerLink';
import {
  deviceSupportsFullscreen,
  getFullscreenElement,
  setLandscapeLock,
  toggleFullscreen,
  type FullscreenDocument,
  type FullscreenTarget,
  type FullscreenVideo,
} from '../utils/fullscreen';
import {
  isPictureInPictureSupported,
  togglePictureInPicture,
} from '../utils/pip';
import { useWakeLock } from '../hooks/useWakeLock';
import type { ViewerQualityPreference, VideoConfig } from '@shared/index';
import {
  KiaraLogo,
  IconArrowLeft,
  IconBroadcast,
  IconScreen,
  IconX,
  IconVolumeHigh,
  IconVolumeMute,
  IconFullscreen,
  IconExitFullscreen,
  IconPictureInPicture,
  IconActivity,
  IconSettings,
  IconUsers,
} from '../components/UI/Icons';
import StreamControls from '../components/Controls/StreamControls';
import VideoConfigPanel from '../components/Controls/VideoConfigPanel';
import AudioSourceList from '../components/Controls/AudioSourceList';
import CaptureSourcePicker from '../components/Controls/CaptureSourcePicker';
import StatsOverlay from '../components/UI/StatsOverlay';
import ConnectionBadge from '../components/UI/ConnectionBadge';
import ReactionBar, { ReactionOverlay } from '../components/UI/Reactions';
import ShihTzuMascot from '../components/UI/ShihTzuMascot';
import PixelShihTzu from '../components/UI/PixelShihTzu/PixelShihTzu';
import styles from './ViewerPage.module.css';

const ViewerPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { state, leaveRoom, setQuality, join, updateName, storedName } = useViewer(code);
  const { socket } = useSocket();
  const reactions = useReactions();
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState(() => storedName || '');
  const [showNameModal, setShowNameModal] = useState(false);
  const [modalNameValue, setModalNameValue] = useState(() => storedName || '');
  const [isMuted, setIsMuted] = useState(true);
  const [localVolume, setLocalVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPip, setIsPip] = useState(false);
  const [isCoverMode, setIsCoverMode] = useState(false);
  const [hudMessage, setHudMessage] = useState<string | null>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showControls, setShowControls] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHud = useCallback((message: string) => {
    setHudMessage(message);
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    hudTimerRef.current = setTimeout(() => {
      setHudMessage(null);
    }, 1800);
  }, []);

  useEffect(() => () => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
  }, []);

  // ── Co-apresentação ───────────────────────────────────────────────────
  const coPreviewRef = useRef<HTMLVideoElement>(null);
  const [showCoPresenterPanel, setShowCoPresenterPanel] = useState(false);
  const [videoConfig, setVideoConfig] = useState<VideoConfig>({
    width: 1920,
    height: 1080,
    frameRate: 60,
    codec: 'H264',
    bitrate: 5000,
    quality: 'high',
  });
  const [captureSourceId, setCaptureSourceId] = useState<string | null>(null);
  const audioHook = useAudioSources();
  const { setPaused: setAudioPollingPaused } = audioHook;
  const audioSelection = useMemo(
    () => audioHook.sources
      .filter((src) => audioHook.selected.has(src.id))
      .map((src) => ({ id: src.id, pid: src.processId, volume: src.volume, muted: src.isMuted })),
    [audioHook.sources, audioHook.selected],
  );
  const copresentOptions = useMemo(
    () => ({ name: nameInput.trim().slice(0, 24) || undefined }),
    [nameInput],
  );
  const copresenter = useCopresenter(
    socket,
    state.hostId,
    state.iceServers,
    videoConfig,
    audioSelection,
    captureSourceId,
    copresentOptions,
  );
  const {
    state: coState,
    startCopresent,
    stopCopresent,
    togglePause: toggleCoPause,
    updateVideoConfig: updateCoVideoConfig,
  } = copresenter;
  const captureSupported = isDisplayCaptureSupported() || window.screenShareHost !== undefined;

  useEffect(() => {
    setAudioPollingPaused(coState.isSharing);
  }, [coState.isSharing, setAudioPollingPaused]);

  // Conecta o preview local do co-apresentador
  useEffect(() => {
    if (coPreviewRef.current) {
      coPreviewRef.current.srcObject = coState.isSharing ? coState.stream : null;
    }
  }, [coState.stream, coState.isSharing, showCoPresenterPanel]);

  // Sala encerrada: a transmissão local não faz mais sentido
  useEffect(() => {
    if (state.roomClosed) stopCopresent();
  }, [state.roomClosed, stopCopresent]);

  const handleCoVideoConfigChange = (newConfig: VideoConfig) => {
    setVideoConfig(newConfig);
    if (coState.isSharing) void updateCoVideoConfig(newConfig);
  };

  const handleUpdateName = useCallback(
    (newName: string) => {
      const clean = newName.trim();
      if (clean.length > 0) {
        setNameInput(clean);
        updateName(clean);
      }
    },
    [updateName],
  );

  const handleRequireName = useCallback((): boolean => {
    if (nameInput.trim().length > 0) return true;
    setModalNameValue('');
    setShowNameModal(true);
    return false;
  }, [nameInput]);

  const handleConfirmNameModal = (e?: React.FormEvent) => {
    e?.preventDefault();
    const clean = modalNameValue.trim();
    if (clean.length > 0) {
      handleUpdateName(clean);
    }
    setShowNameModal(false);
  };

  // Conecta o stream remoto ao elemento <video> e garante a reprodução sem tela preta no mobile
  useEffect(() => {
    const video = videoRef.current;
    const stream = state.remoteStream;
    if (!video || !stream) return;

    // Garante propriedades nativas essenciais para navegadores mobile (iOS Safari e Android)
    video.muted = isMuted;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');

    // Só reatribui se o srcObject for diferente (evita rebind desnecessário)
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    const attemptPlay = () => {
      if (video.paused) {
        video.play().catch((err) => {
          if ((err as Error)?.name !== 'AbortError') {
            console.warn('[KIARA:viewer] Erro ao iniciar reprodução automática:', err);
          }
        });
      }
    };

    attemptPlay();

    // No mobile, a faixa de vídeo começa em estado 'muted' e dispara 'unmute' assim que
    // os primeiros pacotes de imagem chegam da rede; disparamos play() para começar a renderizar
    const videoTracks = stream.getVideoTracks();
    for (const track of videoTracks) {
      track.addEventListener('unmute', attemptPlay);
    }

    return () => {
      for (const track of videoTracks) {
        track.removeEventListener('unmute', attemptPlay);
      }
    };
  }, [state.remoteStream, isMuted]);

  // Sincroniza estado de Picture-in-Picture
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnterPip = () => setIsPip(true);
    const onLeavePip = () => setIsPip(false);

    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);

    return () => {
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
    };
  }, []);

  // Aplica o volume local ao <video>
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = localVolume;
    }
  }, [localVolume]);

  // Estado de tela cheia: API padrão, prefixo webkit e player nativo do iPhone
  useEffect(() => {
    const video = videoRef.current as (HTMLVideoElement & FullscreenVideo) | null;
    const sync = () => {
      const active = Boolean(getFullscreenElement(document as FullscreenDocument)) ||
        Boolean(video?.webkitDisplayingFullscreen);
      setIsFullscreen(active);
      // Em celular, tela cheia trava em paisagem (onde o navegador permite)
      if (window.matchMedia?.('(pointer: coarse)').matches) {
        void setLandscapeLock(screen.orientation as unknown as Parameters<typeof setLandscapeLock>[0], active);
      }
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    video?.addEventListener('webkitbeginfullscreen', sync);
    video?.addEventListener('webkitendfullscreen', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
      video?.removeEventListener('webkitbeginfullscreen', sync);
      video?.removeEventListener('webkitendfullscreen', sync);
    };
  }, []);

  // Mantém a tela do celular acesa enquanto assiste
  useWakeLock(state.connectionState === 'connected');

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
    showHud('Áudio da transmissão ativado');
    resetHideTimer();
  };

  const handleToggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
    showHud(nextMuted ? 'Áudio silenciado (Mudo)' : 'Áudio ativado');
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
      const res = await toggleFullscreen(
        document as FullscreenDocument,
        containerRef.current as unknown as FullscreenTarget,
        videoRef.current as unknown as FullscreenVideo | null,
      );
      if (res === 'entered') showHud('Tela cheia ativada');
      else if (res === 'exited') showHud('Tela cheia desativada');
    } catch (err) {
      console.warn('[KIARA] Erro ao alternar tela cheia:', err);
    }
    resetHideTimer();
  };

  const handleTogglePip = async () => {
    if (!videoRef.current) return;
    try {
      const entered = await togglePictureInPicture(videoRef.current);
      showHud(entered ? 'Picture-in-Picture ativado' : 'Picture-in-Picture fechado');
    } catch (err) {
      console.warn('[KIARA] Erro ao alternar Picture-in-Picture:', err);
    }
    resetHideTimer();
  };

  const handleToggleCoverMode = () => {
    setIsCoverMode((prev) => {
      const next = !prev;
      showHud(next ? 'Enquadramento: Preencher Tela' : 'Enquadramento: Proporção Original');
      return next;
    });
    resetHideTimer();
  };

  const toggleSettingsPanel = () => {
    setShowCoPresenterPanel((v) => {
      const next = !v;
      showHud(next ? 'Painel de configurações exibido' : 'Painel de configurações ocultado');
      return next;
    });
    resetHideTimer();
  };

  // iPhone só tem tela cheia pelo player do <video>; sem nenhum suporte, o botão some
  const fullscreenSupported = deviceSupportsFullscreen();
  const pipSupported = isPictureInPictureSupported();

  /** Mouse: mostra os controles. Toque: um toque no vídeo alterna mostrar/esconder */
  const handleSurfaceClick = (e: React.MouseEvent) => {
    const onControls = (e.target as HTMLElement).closest('header, footer, button, select, input, section');
    if (onControls) {
      resetHideTimer();
      return;
    }
    if (window.matchMedia?.('(pointer: coarse)').matches && showControls && state.connectionState === 'connected' && !isMuted) {
      setShowControls(false);
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      return;
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

  // Atalhos: F = tela cheia, M = mutar, P = Picture-in-Picture, S/C = painéis laterais, Z = enquadramento
  const shortcutsRef = useRef({
    fullscreen: handleToggleFullscreen,
    mute: handleToggleMute,
    pip: handleTogglePip,
    toggleSettings: toggleSettingsPanel,
    toggleCover: handleToggleCoverMode,
  });
  shortcutsRef.current = {
    fullscreen: handleToggleFullscreen,
    mute: handleToggleMute,
    pip: handleTogglePip,
    toggleSettings: toggleSettingsPanel,
    toggleCover: handleToggleCoverMode,
  };
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
      } else if (key === 'p') {
        e.preventDefault();
        void shortcutsRef.current.pip();
      } else if (key === 's' || key === 'c') {
        e.preventDefault();
        shortcutsRef.current.toggleSettings();
      } else if (key === 'z') {
        e.preventDefault();
        shortcutsRef.current.toggleCover();
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
          <ShihTzuMascot state="error" size={110} speech="Código de sala inválido..." />
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
          <ShihTzuMascot
            state="idle"
            size={110}
            speech={state.hostDisconnected ? 'Transmissão encerrada! Até a próxima 🐾' : 'Sala indisponível no momento...'}
          />
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
          <ShihTzuMascot state="locked" size={100} speech="Esta sala tem senha! 🔒" />
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
          <ShihTzuMascot state="connecting" size={110} speech="Esperando o host aprovar... 🐾" />
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
          <ShihTzuMascot state="error" size={110} speech="Ops! Houve um imprevisto na conexão." />
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
      className={`${styles.playerLayout} ${!showControls && state.connectionState === 'connected' ? styles.cursorHidden : ''}`}
      onPointerMove={(e) => {
        if (e.pointerType === 'mouse') resetHideTimer();
      }}
      onClick={handleSurfaceClick}
    >
      {/* ── HUD Flutuante de Feedback ─────────────────────────────────── */}
      {hudMessage && (
        <div className={styles.hudNotification} role="status" aria-live="polite">
          <span>{hudMessage}</span>
        </div>
      )}
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
          {state.connectionState === 'connected' && (
            <button
              type="button"
              className={styles.settingsToggle}
              onClick={toggleSettingsPanel}
              aria-expanded={showCoPresenterPanel}
              aria-controls="viewer-settings-panel"
              title={showCoPresenterPanel ? 'Ocultar abas laterais (S)' : 'Exibir abas laterais (S)'}
            >
              <IconSettings size={15} />
              <span>{showCoPresenterPanel ? 'Ocultar Painel' : 'Exibir Painel'}</span>
            </button>
          )}
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

      {/* ── Área Central do Vídeo (Foco Total e Máxima Resolução) ───────── */}
      <div className={styles.videoViewport}>
        {/* Aura ambiente sutil */}
        {state.connectionState === 'connected' && <div className={styles.ambientAura} />}

        {/* Loading / Reconectando */}
        {state.connectionState !== 'connected' && (
          <div className={styles.loadingOverlay} role="status" aria-live="polite">
            <ShihTzuMascot
              state="connecting"
              size={120}
              speech={state.connectionState === 'reconnecting' ? 'Buscando sinal da live... 🐾' : 'Aguardando o vídeo começar... ✨'}
            />
            <h3>
              {state.connectionState === 'reconnecting'
                ? 'Tentando restabelecer conexão…'
                : 'Aguardando o vídeo do apresentador…'}
            </h3>
            <p>Conexão direta em andamento</p>
            <PixelShihTzu scale={3} className={styles.loadingPixelPet} />
          </div>
        )}

        <video
          ref={videoRef}
          autoPlay
          muted={isMuted}
          playsInline
          preload="auto"
          className={`${styles.videoElement} ${isCoverMode ? styles.videoCover : ''}`}
          onLoadedMetadata={() => {
            if (videoRef.current && videoRef.current.paused) {
              videoRef.current.play().catch(() => {});
            }
          }}
          onCanPlay={() => {
            if (videoRef.current && videoRef.current.paused) {
              videoRef.current.play().catch(() => {});
            }
          }}
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

        <ReactionOverlay
          reactions={reactions.reactions}
          enabled={state.reactionsEnabled}
        />

        {/* Telemetria de Estatísticas */}
        {showStats && state.stats && <StatsOverlay stats={state.stats} />}
      </div>

      {/* ── Painel Lateral de Co-apresentação ────────────────────────────── */}
      {/* Sempre montado (com a prévia e a transmissão intactas); ocultar só o desliza para fora */}
      {state.connectionState === 'connected' && (
        <>
          {showCoPresenterPanel && (
            <div
              className={styles.coPresenterOverlay}
              onClick={() => setShowCoPresenterPanel(false)}
              aria-hidden="true"
            />
          )}
          <aside
            id="viewer-settings-panel"
            className={`${styles.coPresenterPanel} ${!showCoPresenterPanel ? styles.coPresenterPanelHidden : ''}`}
            aria-label="Co-apresentação"
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.coPresenterPanelHeader}>
              <span>Configurações</span>
              <button
                type="button"
                className={styles.settingsToggle}
                onClick={() => setShowCoPresenterPanel(false)}
                tabIndex={showCoPresenterPanel ? 0 : -1}
                title="Ocultar painel de configurações"
              >
                <IconX size={15} />
                <span>Ocultar Configurações</span>
              </button>
            </div>

            <div className={styles.coPresenterPanelSection}>
              <StreamControls
                isSharing={coState.isSharing}
                isPaused={coState.isPaused}
                previewAtivo={true}
                onStart={() => void startCopresent()}
                startDisabled={!captureSupported || coState.starting || !state.hostId}
                onStop={stopCopresent}
                onTogglePause={toggleCoPause}
                onTogglePreview={() => {}}
              />

              {coState.starting && (
                <p role="status" aria-live="polite">Iniciando transmissão…</p>
              )}
              {!captureSupported && (
                <p role="alert">
                  Este aparelho não consegue compartilhar a tela pelo navegador.
                </p>
              )}
              {coState.error && <p role="alert">{coState.error}</p>}

              {coState.isSharing && (
                <video
                  ref={coPreviewRef}
                  className={styles.coPresenterPreview}
                  autoPlay
                  muted
                  playsInline
                />
              )}
            </div>

            <div className={styles.coPresenterPanelSection}>
              <VideoConfigPanel
                config={videoConfig}
                onChange={handleCoVideoConfigChange}
                isSharing={coState.isSharing}
              />
            </div>

            {audioHook.isDesktop && (
              <div className={styles.coPresenterPanelSection}>
                <CaptureSourcePicker
                  selectedId={captureSourceId}
                  onSelect={setCaptureSourceId}
                  isSharing={false}
                />
              </div>
            )}

            <div className={styles.coPresenterPanelSection}>
              <AudioSourceList
                sources={audioHook.sources}
                selected={audioHook.selected}
                loading={audioHook.loading}
                onToggle={audioHook.toggleSource}
                onVolumeChange={audioHook.setVolume}
                onMuteToggle={audioHook.toggleMute}
                onRefresh={audioHook.refreshSources}
                webMode={!audioHook.isDesktop}
              />
            </div>
          </aside>
        </>
      )}

      {/* Modal para inserção de nome do viewer */}
      {showNameModal && (
        <div className={styles.modalBackdrop}>
          <form className={styles.modalContent} onSubmit={handleConfirmNameModal}>
            <h2>Identifique-se</h2>
            <p>Insira seu nome ou apelido para reagir à transmissão.</p>
            <label htmlFor="viewer-name-modal-input" className={styles.fieldLabel}>
              Seu nome
            </label>
            <input
              id="viewer-name-modal-input"
              type="text"
              maxLength={24}
              autoFocus
              className={styles.textInput}
              value={modalNameValue}
              placeholder="Ex.: Alice"
              onChange={(e) => setModalNameValue(e.target.value)}
            />
            <div className={styles.modalButtons}>
              <button
                type="submit"
                className={styles.btnPrimary}
                disabled={modalNameValue.trim().length === 0}
              >
                <span>Confirmar Nome</span>
              </button>
              <button
                type="button"
                className={styles.btnSecondary}
                onClick={() => setShowNameModal(false)}
              >
                <span>Fechar</span>
              </button>
            </div>
          </form>
        </div>
      )}

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
            <button
              type="button"
              className={`${styles.coPresenterToggleBtn} ${showCoPresenterPanel ? styles.activeBtn : ''}`}
              onClick={() => {
                setShowCoPresenterPanel((v) => !v);
                resetHideTimer();
              }}
              title="Também transmitir"
              aria-label="Também transmitir"
              aria-pressed={showCoPresenterPanel}
            >
              {showCoPresenterPanel ? <IconX size={16} /> : <IconBroadcast size={16} />}
              <span>Também transmitir</span>
            </button>
          )}
          {state.connectionState === 'connected' && (
            <ReactionBar
              onReact={reactions.sendReaction}
              enabled={state.reactionsEnabled}
              onRequestName={handleRequireName}
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

          {/* Botão de Enquadramento (Fit / Fill) */}
          {state.connectionState === 'connected' && (
            <button
              type="button"
              className={`${styles.iconBtn} ${isCoverMode ? styles.activeBtn : ''}`}
              onClick={handleToggleCoverMode}
              title={isCoverMode ? 'Modo de enquadramento: Ajustar proporção (Z)' : 'Modo de enquadramento: Preencher tela (Z)'}
              aria-label={isCoverMode ? 'Ajustar proporção original' : 'Preencher tela'}
              aria-keyshortcuts="Z"
              aria-pressed={isCoverMode}
            >
              <IconScreen size={18} />
            </button>
          )}

          {/* Botão de Picture-in-Picture (Janela Flutuante) */}
          {pipSupported && state.connectionState === 'connected' && (
            <button
              type="button"
              className={`${styles.iconBtn} ${isPip ? styles.activeBtn : ''}`}
              onClick={handleTogglePip}
              title={isPip ? 'Sair de janela flutuante (PiP) (P)' : 'Assistir em janela flutuante (PiP) (P)'}
              aria-label={isPip ? 'Sair do Picture-in-Picture' : 'Assistir em janela flutuante Picture-in-Picture'}
              aria-keyshortcuts="P"
              aria-pressed={isPip}
            >
              <IconPictureInPicture size={18} />
            </button>
          )}

          {/* Botão de Tela Cheia */}
          {fullscreenSupported && (
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
          )}
        </div>
      </footer>
    </div>
  );
};

export default ViewerPage;
