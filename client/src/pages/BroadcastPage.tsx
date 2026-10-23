import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBroadcast } from '../hooks/useBroadcast';
import { useCopresenterStream } from '../hooks/useCopresenterStream';
import { useAudioSources } from '../hooks/useAudioSources';
import { useReactions } from '../hooks/useReactions';
import { useSocket } from '../services/SocketContext';
import { isDisplayCaptureSupported } from '../services/captureService';
import {
  deviceSupportsFullscreen,
  getFullscreenElement,
  toggleFullscreen,
  type FullscreenDocument,
  type FullscreenTarget,
} from '../utils/fullscreen';
import {
  isPictureInPictureSupported,
  togglePictureInPicture,
} from '../utils/pip';
import {
  KiaraLogo,
  IconArrowLeft,
  IconUsers,
  IconScreen,
  IconAlertTriangle,
  IconEye,
  IconEyeOff,
  IconCopy,
  IconCheck,
  IconBroadcast,
  IconPause,
  IconPlay,
  IconStop,
  IconSettings,
  IconActivity,
  IconFullscreen,
  IconExitFullscreen,
  IconVolumeHigh,
  IconVolumeMute,
  IconPictureInPicture,
  IconX,
} from '../components/UI/Icons';
import StreamControls from '../components/Controls/StreamControls';
import AudioSourceList from '../components/Controls/AudioSourceList';
import CaptureSourcePicker from '../components/Controls/CaptureSourcePicker';
import VideoConfigPanel from '../components/Controls/VideoConfigPanel';
import RoomOptionsPanel, {
  isRoomPasswordValid,
  type RoomOptionsValue,
} from '../components/Controls/RoomOptionsPanel';
import StatsOverlay from '../components/UI/StatsOverlay';
import ConnectionBadge from '../components/UI/ConnectionBadge';
import JoinRequestsPanel from '../components/UI/JoinRequestsPanel';
import ReactionBar, { ReactionOverlay } from '../components/UI/Reactions';
import PixelShihTzu from '../components/UI/PixelShihTzu/PixelShihTzu';
import LiveScene from '../components/UI/PixelShihTzu/LiveScene';
import { buildPermanentLink, getOrCreatePermanentRoomCode } from '../utils/permanentRoom';
import {
  clampMiniWidth,
  parseStoredMiniWidth,
  MINI_MAX_WIDTH,
  MINI_MIN_WIDTH,
  MINI_STEP,
} from '../utils/miniPlayer';
import styles from './BroadcastPage.module.css';
// Barra flutuante e botões do player: as mesmas classes do espectador, para os dois ficarem idênticos
import viewerStyles from './ViewerPage.module.css';
import type { VideoConfig as VideoConfigType, CreateRoomPayload } from '@shared/index';

const BroadcastPage: React.FC = () => {
  const navigate = useNavigate();
  const previewRef = useRef<HTMLVideoElement>(null);
  const copresenterVideoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  // Painéis de configuração: recolhíveis para dar todo o espaço ao vídeo
  const [isSettingsVisible, setIsSettingsVisible] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isNativePip, setIsNativePip] = useState(false);
  const [hudMessage, setHudMessage] = useState<string | null>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** O som do co-apresentador começa mudo para evitar eco com o áudio que ele recebe */
  const [copresenterMuted, setCopresenterMuted] = useState(true);

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

  const [videoConfig, setVideoConfig] = useState<VideoConfigType>({
    width: 1920,
    height: 1080,
    frameRate: 60,
    codec: 'H264',
    bitrate: 5000,
    quality: 'high',
  });

  const [roomOptions, setRoomOptions] = useState<RoomOptionsValue>({
    password: '',
    requireApproval: false,
    privacyMode: false,
    reactionsEnabled: true,
  });
  const createRoomOptions = useMemo<CreateRoomPayload>(() => {
    const options: CreateRoomPayload = {
      reactionsEnabled: roomOptions.reactionsEnabled,
    };
    if (roomOptions.password) options.password = roomOptions.password;
    if (roomOptions.requireApproval) options.requireApproval = true;
    if (roomOptions.privacyMode) options.privacyMode = true;
    return options;
  }, [roomOptions]);

  const audioHook = useAudioSources();
  const { setPaused: setAudioPollingPaused } = audioHook;
  const [captureSourceId, setCaptureSourceId] = useState<string | null>(null);

  const audioSelection = useMemo(
    () => audioHook.sources
      .filter((src) => audioHook.selected.has(src.id))
      .map((src) => ({ id: src.id, pid: src.processId, volume: src.volume, muted: src.isMuted })),
    [audioHook.sources, audioHook.selected],
  );

  // ── Link fixo: o mesmo código em todas as transmissões, disponível antes de iniciar ──
  const [roomCode] = useState<string>(() => getOrCreatePermanentRoomCode());
  /** Origem pública do link: no app desktop vem do túnel; no navegador, do próprio site */
  const [linkOrigin, setLinkOrigin] = useState<string>(() => window.location.origin);
  const [copiedLink, setCopiedLink] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  // Preferência de retorno de tela: lida do localStorage na montagem
  const [previewAtivo, setPreviewAtivo] = useState<boolean>(() => {
    const salvo = localStorage.getItem('kiara:previewAtivo');
    return salvo === null ? true : salvo === 'true';
  });

  const togglePreview = () => {
    setPreviewAtivo((atual) => {
      const proximo = !atual;
      localStorage.setItem('kiara:previewAtivo', String(proximo));
      return proximo;
    });
  };

  // Miniplayer da própria transmissão: largura e visibilidade lembradas entre sessões
  const [miniWidth, setMiniWidth] = useState<number>(() =>
    parseStoredMiniWidth(localStorage.getItem('kiara:miniWidth')),
  );
  const [miniVisible, setMiniVisible] = useState<boolean>(
    () => localStorage.getItem('kiara:miniVisible') !== 'false',
  );

  const resizeMini = (delta: number) => {
    setMiniWidth((atual) => {
      const proximo = clampMiniWidth(atual + delta);
      localStorage.setItem('kiara:miniWidth', String(proximo));
      return proximo;
    });
  };

  const toggleMini = () => {
    setMiniVisible((atual) => {
      localStorage.setItem('kiara:miniVisible', String(!atual));
      return !atual;
    });
  };

  const [tunnelDown, setTunnelDown] = useState(false);
  useEffect(() => {
    const hostApp = window.screenShareHost?.app;
    if (!hostApp) return;
    let cancelled = false;
    hostApp.getPublicUrl()
      .then((publicUrl) => {
        if (cancelled) return;
        if (publicUrl === null) setTunnelDown(true);
        else setLinkOrigin(publicUrl);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const {
    state,
    startSharing,
    stopSharing,
    togglePause,
    changeCaptureSource,
    updateVideoConfig,
    respondJoin,
  } = useBroadcast(videoConfig, audioSelection, captureSourceId, createRoomOptions);

  const { socket } = useSocket();
  const reactions = useReactions();
  const copresenter = useCopresenterStream(socket, state.isSharing, state.iceServers);
  const copresenterStream = copresenter.stream;
  const hasCopresenterVideo = copresenterStream !== null;
  /** Retorno local vira miniplayer assim que há tela de co-apresentador no player principal */
  const hostIsMini = hasCopresenterVideo;
  const passwordValid = isRoomPasswordValid(roomOptions.password);
  const privacyIgnored = state.isSharing && roomOptions.privacyMode && !state.privacyMode;

  const captureSupported = isDisplayCaptureSupported() || window.screenShareHost !== undefined;

  const handleStart = () => {
    if (!passwordValid || !captureSupported) return;
    void startSharing();
  };

  const handleVideoConfigChange = (newConfig: VideoConfigType) => {
    setVideoConfig(newConfig);
    if (state.isSharing) {
      void updateVideoConfig(newConfig);
    }
  };

  const handleRoomOptionsChange = (newOptions: RoomOptionsValue) => {
    setRoomOptions(newOptions);
    if (state.isSharing && socket?.connected) {
      socket.emit('room:update-features', {
        reactionsEnabled: newOptions.reactionsEnabled,
      });
    }
  };

  const handleSelectSource = async (sourceId: string) => {
    setCaptureSourceId(sourceId);
    if (state.isSharing) {
      await changeCaptureSource(sourceId);
    }
  };

  const handleWebChangeScreen = async () => {
    if (state.isSharing) {
      await changeCaptureSource(null);
    }
  };

  useEffect(() => {
    setAudioPollingPaused(state.isSharing);
  }, [state.isSharing, setAudioPollingPaused]);

  // Se o mixer recusou uma troca de fonte, a interface volta ao que está de fato no ar
  const { replaceSelection } = audioHook;
  const { activeAudioIds, audioFailures } = state;
  const activeIdsRef = useRef(activeAudioIds);
  activeIdsRef.current = activeAudioIds;
  useEffect(() => {
    if (audioFailures > 0) replaceSelection(activeIdsRef.current);
  }, [audioFailures, replaceSelection]);

  // Conecta ou desconecta o srcObject do <video> conforme o estado do preview
  useEffect(() => {
    if (!previewRef.current) return;
    if (previewAtivo && state.stream) {
      previewRef.current.srcObject = state.stream;
    } else {
      previewRef.current.srcObject = null;
    }
  }, [state.stream, previewAtivo]);

  // Tela do co-apresentador no player principal
  useEffect(() => {
    if (copresenterVideoRef.current) {
      copresenterVideoRef.current.srcObject = copresenterStream;
    }
  }, [copresenterStream]);

  // Estado de tela cheia do palco
  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(getFullscreenElement(document as FullscreenDocument)));
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const fullscreenSupported = deviceSupportsFullscreen();
  const pipSupported = isPictureInPictureSupported();

  const handleToggleFullscreen = useCallback(async () => {
    if (!stageRef.current) return;
    try {
      const res = await toggleFullscreen(document as FullscreenDocument, stageRef.current as unknown as FullscreenTarget);
      if (res === 'entered') showHud('Tela cheia ativada');
      else if (res === 'exited') showHud('Tela cheia desativada');
    } catch (err) {
      console.warn('[KIARA] Erro ao alternar tela cheia:', err);
    }
  }, [showHud]);

  const handleToggleNativePip = useCallback(async () => {
    const targetVideo = copresenterVideoRef.current || previewRef.current;
    if (!targetVideo) return;
    try {
      const entered = await togglePictureInPicture(targetVideo);
      showHud(entered ? 'Picture-in-Picture ativado' : 'Picture-in-Picture fechado');
    } catch (err) {
      console.warn('[KIARA] Erro ao alternar Picture-in-Picture:', err);
    }
  }, [showHud]);

  const toggleSettings = useCallback(() => {
    setIsSettingsVisible((v) => {
      const next = !v;
      showHud(next ? 'Painéis de configuração exibidos' : 'Painéis ocultados (Foco na tela)');
      return next;
    });
  }, [showHud]);

  // Sincroniza estado de PiP para vídeos do host/coapresentador
  useEffect(() => {
    const v1 = previewRef.current;
    const v2 = copresenterVideoRef.current;
    const onEnterPip = () => setIsNativePip(true);
    const onLeavePip = () => setIsNativePip(false);

    v1?.addEventListener('enterpictureinpicture', onEnterPip);
    v1?.addEventListener('leavepictureinpicture', onLeavePip);
    v2?.addEventListener('enterpictureinpicture', onEnterPip);
    v2?.addEventListener('leavepictureinpicture', onLeavePip);

    return () => {
      v1?.removeEventListener('enterpictureinpicture', onEnterPip);
      v1?.removeEventListener('leavepictureinpicture', onLeavePip);
      v2?.removeEventListener('enterpictureinpicture', onEnterPip);
      v2?.removeEventListener('leavepictureinpicture', onLeavePip);
    };
  }, [hasCopresenterVideo, previewAtivo]);

  // Atalhos: F = tela cheia, S/C = ocultar/exibir abas laterais, P = Picture-in-Picture
  const shortcutsRef = useRef({
    fullscreen: handleToggleFullscreen,
    toggleSettings,
    togglePip: handleToggleNativePip,
  });
  shortcutsRef.current = {
    fullscreen: handleToggleFullscreen,
    toggleSettings,
    togglePip: handleToggleNativePip,
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
      } else if (key === 's' || key === 'c') {
        e.preventDefault();
        shortcutsRef.current.toggleSettings();
      } else if (key === 'p') {
        e.preventDefault();
        void shortcutsRef.current.togglePip();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // O servidor confirma o código; antes de transmitir vale o código fixo local
  const displayCode = state.roomCode ?? roomCode;
  const displayUrl = state.inviteUrl ?? buildPermanentLink(linkOrigin, displayCode);

  const handleCopyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayUrl);
    } catch {
      const el = document.createElement('textarea');
      el.value = displayUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedLink(true);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedLink(false), 2200);
  }, [displayUrl]);

  return (
    <div className={styles.studioLayout}>
      {/* ── HUD Flutuante de Feedback ─────────────────────────────────── */}
      {hudMessage && (
        <div className={viewerStyles.hudNotification} role="status" aria-live="polite">
          <span>{hudMessage}</span>
        </div>
      )}

      {/* ── Barra Superior de Estúdio ────────────────────────────────────── */}
      <header className={`${styles.topBar} ${state.isSharing ? styles.topBarLive : ''}`}>
        <div className={styles.topBarLeft}>
          <button
            type="button"
            className={styles.backBtn}
            onClick={() => navigate('/')}
            title="Voltar para a página inicial"
          >
            <IconArrowLeft size={16} />
            <span>Voltar</span>
          </button>
          <div className={styles.divider} />
          <KiaraLogo size={24} withText />
          <span className={styles.studioBadge}>Estúdio do Host</span>
        </div>

        {/* Durante a transmissão: Shih Tzu pedalando e alimentando o computador "LIVE ON" */}
        {state.isSharing && <LiveScene scale={2} className={styles.liveScene} />}

        <div className={styles.topBarRight}>
          <button
            type="button"
            className={`${styles.settingsToggle} ${!isSettingsVisible ? styles.settingsToggleOff : ''}`}
            onClick={toggleSettings}
            aria-expanded={isSettingsVisible}
            aria-controls="studio-room-panel studio-config-panel"
            title={isSettingsVisible ? 'Ocultar abas laterais (S)' : 'Exibir abas laterais (S)'}
          >
            <IconSettings size={15} />
            <span>{isSettingsVisible ? 'Ocultar Painéis' : 'Exibir Painéis'}</span>
          </button>

          <ConnectionBadge state={state.connectionState} />

          {state.isSharing && (
            <div className={styles.viewersCountPill}>
              <IconUsers size={15} />
              <span>
                <strong>{state.viewerCount}</strong>
                {state.maxViewers > 0 ? ` de ${state.maxViewers}` : ''}{' '}
                espectador{state.viewerCount !== 1 ? 'es' : ''}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ── Conteúdo Principal do Estúdio ───────────────────────────────── */}
      <div className={`${styles.bodyLayout} ${!isSettingsVisible ? styles.settingsHidden : ''}`}>

        {/* ── Painel Esquerdo: Acesso à Sala ─────────────────────────────── */}
        <aside
          id="studio-room-panel"
          className={styles.sidebarRoom}
          aria-label="Sala e transmissão"
        >
          <div className={styles.sidebarInner}>

          {/* Seção: Controles de transmissão */}
          <div className={styles.panelSection}>
            <StreamControls
              isSharing={state.isSharing}
              isPaused={state.isPaused}
              previewAtivo={previewAtivo}
              onStart={handleStart}
              startDisabled={!captureSupported}
              onStop={stopSharing}
              onTogglePause={togglePause}
              onTogglePreview={togglePreview}
            />

            {!captureSupported && (
              <div className={styles.errorBox} role="alert">
                <IconAlertTriangle size={16} className={styles.errorIcon} />
                <span>
                  Este aparelho não consegue compartilhar a tela pelo navegador. Para transmitir, use
                  um computador (Chrome, Edge ou Firefox) ou o app para Windows.
                </span>
              </div>
            )}

            {!passwordValid && !state.isSharing && (
              <div className={styles.errorBox} role="alert">
                <IconAlertTriangle size={16} className={styles.errorIcon} />
                <span>Corrija a senha da sala antes de iniciar.</span>
              </div>
            )}

            {state.error && (
              <div className={styles.errorBox} role="alert">
                <IconAlertTriangle size={16} className={styles.errorIcon} />
                <span>{state.error}</span>
              </div>
            )}
          </div>

          {/* Seção: Link Fixo da Sala (pré e pós-transmissão) */}
          <div className={styles.panelSection}>
            <div className={styles.sectionHeader}>
              <span className={styles.sectionTitle}>Acesso à Sala</span>
              {state.isSharing ? (
                <span className={styles.statusLive}>
                  <span className={styles.liveDotSmall} />
                  Ao Vivo
                </span>
              ) : (
                <span className={styles.statusOffline}>Aguardando</span>
              )}
            </div>

            <div className={styles.permanentLinkCard}>
              <div className={styles.permanentLinkMeta}>
                <span className={styles.permanentBadge}>Link Fixo</span>
              </div>

              <div className={styles.codeDisplay}>
                <span className={styles.codeDisplayText}>{displayCode}</span>
              </div>

              <div className={styles.urlCopyRow}>
                <span className={styles.urlDisplayShort} title={displayUrl}>
                  {displayUrl.replace(/^https?:\/\//, '')}
                </span>
                <button
                  type="button"
                  className={`${styles.copyLinkBtn} ${copiedLink ? styles.copyLinkBtnCopied : ''}`}
                  onClick={() => void handleCopyLink()}
                  aria-label="Copiar link da sala"
                >
                  {copiedLink ? <IconCheck size={14} /> : <IconCopy size={14} />}
                  <span>{copiedLink ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>

              {!state.isSharing && (
                <p className={styles.permanentNote}>
                  Este link é sempre o mesmo e já pode ser compartilhado. Os espectadores verão uma tela de espera até você iniciar.
                </p>
              )}
            </div>

            {/* Selos da sala e avisos (ao vivo) */}
            {state.isSharing && (
              <>
                <div className={styles.roomBadges}>
                  <span className={styles.roomBadge}>
                    {state.hasPassword ? 'Protegida por senha' : 'Sem senha'}
                  </span>
                  {state.requireApproval && <span className={styles.roomBadge}>Aprovação manual</span>}
                  {state.privacyMode && <span className={styles.roomBadge}>Modo privacidade</span>}
                </div>

                {privacyIgnored && (
                  <div className={styles.tunnelWarning} role="status">
                    <IconAlertTriangle size={16} />
                    <span>Modo privacidade não ativado: servidor sem TURN. IP pode ficar visível.</span>
                  </div>
                )}
                {tunnelDown && (
                  <div className={styles.tunnelWarning} role="status">
                    <IconAlertTriangle size={16} />
                    <span>Túnel público indisponível: link funciona apenas na mesma rede local.</span>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Seção: Contagem de espectadores + pedidos de entrada (ao vivo) */}
          {state.isSharing && (
            <div className={styles.panelSection}>
              <JoinRequestsPanel requests={state.pendingRequests} onRespond={respondJoin} />
            </div>
          )}

          {/* Seção: Configurações da Sala */}
          <RoomOptionsPanel
            value={roomOptions}
            onChange={handleRoomOptionsChange}
            disabled={state.isSharing}
          />

          </div>
        </aside>

        {/* ── Painel Direito: Configurações de Transmissão ──────────────── */}
        <aside
          id="studio-config-panel"
          className={styles.sidebarConfig}
          aria-label="Configurações de transmissão"
        >
          <div className={styles.sidebarInner}>

          {/* Configurações de Qualidade de Vídeo */}
          <VideoConfigPanel
            config={videoConfig}
            onChange={handleVideoConfigChange}
            isSharing={state.isSharing}
          />

          {/* Seletor de Tela/Janela (Desktop Electron) */}
          {audioHook.isDesktop && (
            <CaptureSourcePicker
              selectedId={captureSourceId}
              onSelect={handleSelectSource}
              isSharing={state.isSharing}
            />
          )}

          {/* Fontes de Áudio por Processo */}
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

        {/* ── Área Central: palco no padrão do player do espectador ─────── */}
        <main className={styles.mainArea}>
          <div ref={stageRef} className={styles.previewContainer}>
            {state.isSharing ? (
              <>
                {/* Player principal: tela do co-apresentador (quando existe) */}
                {hasCopresenterVideo && (
                  <video
                    ref={copresenterVideoRef}
                    autoPlay
                    playsInline
                    muted={copresenterMuted}
                    className={styles.mainVideo}
                  />
                )}

                {/* Retorno local: ocupa o palco todo ou vira miniplayer flutuante (PiP) */}
                <div
                  className={[
                    styles.hostFeed,
                    hostIsMini ? styles.hostFeedMini : '',
                    hostIsMini && !miniVisible ? styles.hostFeedHidden : '',
                  ].join(' ')}
                  style={hostIsMini ? ({ '--mini-w': `min(${miniWidth}px, 60vw)` } as React.CSSProperties) : undefined}
                  aria-label={hostIsMini ? 'Sua transmissão (miniplayer)' : 'Sua transmissão'}
                  aria-hidden={hostIsMini && !miniVisible}
                >
                  <video
                    ref={previewRef}
                    autoPlay
                    muted
                    playsInline
                    className={previewAtivo ? styles.previewVideo : styles.previewVideoOculto}
                  />
                  {!previewAtivo && (
                    <div className={styles.previewDesabilitado}>
                      <IconEyeOff size={hostIsMini ? 20 : 32} />
                      {!hostIsMini && <span>Retorno de tela desabilitado</span>}
                    </div>
                  )}
                  {hostIsMini && <span className={styles.miniLabel}>Você</span>}

                  {hostIsMini && (
                    <div className={styles.miniControls} role="group" aria-label="Miniplayer">
                      <button
                        type="button"
                        className={styles.miniBtn}
                        onClick={() => resizeMini(-MINI_STEP * 2)}
                        disabled={miniWidth <= MINI_MIN_WIDTH}
                        title="Diminuir miniplayer"
                        aria-label="Diminuir miniplayer"
                      >
                        <span aria-hidden="true">−</span>
                      </button>
                      <button
                        type="button"
                        className={styles.miniBtn}
                        onClick={() => resizeMini(MINI_STEP * 2)}
                        disabled={miniWidth >= MINI_MAX_WIDTH}
                        title="Aumentar miniplayer"
                        aria-label="Aumentar miniplayer"
                      >
                        <span aria-hidden="true">+</span>
                      </button>
                      <button
                        type="button"
                        className={styles.miniBtn}
                        onClick={toggleMini}
                        title="Ocultar miniplayer"
                        aria-label="Ocultar miniplayer"
                      >
                        <IconX size={14} />
                      </button>
                    </div>
                  )}
                </div>

                {/* Avisos flutuantes sobre o palco */}
                <div className={styles.previewOverlayTop}>
                  {state.isPaused && (
                    <div className={styles.pausedIndicator}>
                      <span>EM PAUSA</span>
                    </div>
                  )}
                  {copresenter.copresenter && (
                    <div className={styles.sourceChip} role="status">
                      <IconBroadcast size={13} />
                      <span>
                        {hasCopresenterVideo
                          ? `Tela de ${copresenter.copresenter.name}`
                          : `Conectando a tela de ${copresenter.copresenter.name}…`}
                      </span>
                    </div>
                  )}
                  {!isSettingsVisible && state.error && (
                    <div className={styles.stageError} role="alert">
                      <IconAlertTriangle size={14} />
                      <span>{state.error}</span>
                    </div>
                  )}
                </div>

                {showStats && state.stats && <StatsOverlay stats={state.stats} />}
                <ReactionOverlay
                  reactions={reactions.reactions}
                  enabled={roomOptions.reactionsEnabled}
                />

                {/* ── Barra flutuante: controles essenciais sempre acessíveis ── */}
                <footer className={`${viewerStyles.bottomBar} ${styles.hostBar}`}>
                  <div className={viewerStyles.bottomBarLeft}>
                    <div className={viewerStyles.liveIndicator}>
                      <span className={viewerStyles.liveDot} />
                      <span>AO VIVO</span>
                    </div>

                    <button
                      type="button"
                      className={`${viewerStyles.iconBtn} ${state.isPaused ? viewerStyles.activeBtn : ''}`}
                      onClick={togglePause}
                      title={state.isPaused ? 'Retomar transmissão de tela' : 'Pausar transmissão momentaneamente'}
                      aria-label={state.isPaused ? 'Retomar transmissão' : 'Pausar transmissão'}
                      aria-pressed={state.isPaused}
                    >
                      {state.isPaused ? <IconPlay size={18} /> : <IconPause size={18} />}
                    </button>

                    <button
                      type="button"
                      className={styles.stopBtn}
                      onClick={stopSharing}
                      title="Encerrar transmissão e fechar sala"
                      aria-label="Encerrar transmissão"
                    >
                      <IconStop size={16} />
                      <span>Encerrar</span>
                    </button>
                  </div>

                  <div className={viewerStyles.bottomBarRight}>
                    <button
                      type="button"
                      className={`${viewerStyles.iconBtn} ${copiedLink ? viewerStyles.activeBtn : ''}`}
                      onClick={() => void handleCopyLink()}
                      title="Copiar link fixo da sala"
                      aria-label="Copiar link da sala"
                    >
                      {copiedLink ? <IconCheck size={18} /> : <IconCopy size={18} />}
                    </button>

                    <button
                      type="button"
                      className={viewerStyles.iconBtn}
                      onClick={togglePreview}
                      title={previewAtivo ? 'Ocultar retorno de tela' : 'Exibir retorno de tela'}
                      aria-label={previewAtivo ? 'Ocultar retorno de tela' : 'Exibir retorno de tela'}
                      aria-pressed={!previewAtivo}
                    >
                      {previewAtivo ? <IconEyeOff size={18} /> : <IconEye size={18} />}
                    </button>

                    {!audioHook.isDesktop && (
                      <button
                        type="button"
                        className={viewerStyles.iconBtn}
                        onClick={() => { void handleWebChangeScreen(); }}
                        title="Alternar para outra tela ou janela sem parar a transmissão"
                        aria-label="Trocar tela ou janela"
                      >
                        <IconScreen size={18} />
                      </button>
                    )}

                    {hasCopresenterVideo && (
                      <button
                        type="button"
                        className={`${viewerStyles.iconBtn} ${miniVisible ? viewerStyles.activeBtn : ''}`}
                        onClick={toggleMini}
                        title={miniVisible ? 'Ocultar miniplayer da sua tela' : 'Exibir miniplayer da sua tela'}
                        aria-label={miniVisible ? 'Ocultar miniplayer da sua tela' : 'Exibir miniplayer da sua tela'}
                        aria-pressed={miniVisible}
                      >
                        <IconPictureInPicture size={18} />
                      </button>
                    )}

                    {pipSupported && (
                      <button
                        type="button"
                        className={`${viewerStyles.iconBtn} ${isNativePip ? viewerStyles.activeBtn : ''}`}
                        onClick={() => void handleToggleNativePip()}
                        title={isNativePip ? 'Sair de janela flutuante (PiP) (P)' : 'Assistir em janela flutuante (PiP) (P)'}
                        aria-label={isNativePip ? 'Sair do Picture-in-Picture' : 'Assistir em janela flutuante Picture-in-Picture'}
                        aria-keyshortcuts="P"
                        aria-pressed={isNativePip}
                      >
                        <IconPictureInPicture size={18} />
                      </button>
                    )}

                    {hasCopresenterVideo && (
                      <button
                        type="button"
                        className={viewerStyles.iconBtn}
                        onClick={() => setCopresenterMuted((m) => !m)}
                        title={copresenterMuted ? 'Ouvir o co-apresentador' : 'Silenciar o co-apresentador'}
                        aria-label={copresenterMuted ? 'Ouvir o co-apresentador' : 'Silenciar o co-apresentador'}
                        aria-pressed={!copresenterMuted}
                      >
                        {copresenterMuted ? <IconVolumeMute size={18} /> : <IconVolumeHigh size={18} />}
                      </button>
                    )}

                    <ReactionBar
                      onReact={reactions.sendReaction}
                      enabled={roomOptions.reactionsEnabled}
                    />

                    {state.stats && (
                      <button
                        type="button"
                        className={`${viewerStyles.iconBtn} ${showStats ? viewerStyles.activeBtn : ''}`}
                        onClick={() => setShowStats((v) => !v)}
                        title="Exibir telemetria e latência"
                        aria-label="Telemetria da transmissão"
                        aria-pressed={showStats}
                      >
                        <IconActivity size={18} />
                      </button>
                    )}

                    {fullscreenSupported && (
                      <button
                        type="button"
                        className={viewerStyles.iconBtn}
                        onClick={() => void handleToggleFullscreen()}
                        title={isFullscreen ? 'Sair de tela cheia (F)' : 'Tela cheia (F)'}
                        aria-label={isFullscreen ? 'Sair de tela cheia' : 'Tela cheia'}
                        aria-keyshortcuts="F"
                      >
                        {isFullscreen ? <IconExitFullscreen size={18} /> : <IconFullscreen size={18} />}
                      </button>
                    )}
                  </div>
                </footer>
              </>
            ) : (
              <div className={styles.placeholderState}>
                <PixelShihTzu pose="idle" scale={6} speech="Tudo pronto para entrar ao vivo! 🐾" />
                <h3>Pronto para transmitir</h3>
                <p>
                  Configure a qualidade no painel direito e clique em{' '}
                  <strong>Iniciar Transmissão</strong>.
                </p>
                <div className={styles.placeholderSteps}>
                  <div className={styles.step}>
                    <span className={styles.stepNum}>1</span>
                    <span>Escolha tela ou janela</span>
                  </div>
                  <div className={styles.step}>
                    <span className={styles.stepNum}>2</span>
                    <span>Defina a qualidade</span>
                  </div>
                  <div className={styles.step}>
                    <span className={styles.stepNum}>3</span>
                    <span>Compartilhe o link</span>
                  </div>
                </div>

                {/* Com os painéis ocultos, o início da transmissão continua à mão */}
                {!isSettingsVisible && (
                  <>
                    <button
                      type="button"
                      className={styles.placeholderStart}
                      onClick={handleStart}
                      disabled={!captureSupported || !passwordValid}
                    >
                      <IconBroadcast size={18} />
                      <span>Iniciar Transmissão</span>
                    </button>
                    {state.error && (
                      <div className={styles.errorBox} role="alert">
                        <IconAlertTriangle size={16} className={styles.errorIcon} />
                        <span>{state.error}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default BroadcastPage;
