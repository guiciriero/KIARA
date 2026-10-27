import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBroadcast } from '../hooks/useBroadcast';
import { useCopresenterStream } from '../hooks/useCopresenterStream';
import { useAudioSources } from '../hooks/useAudioSources';
import { useSocket } from '../services/SocketContext';
import { isDisplayCaptureSupported } from '../services/captureService';
import { useCopyToClipboard } from '../hooks/useCopyToClipboard';
import { useHudNotification } from '../hooks/useHudNotification';
import { DEFAULT_VIDEO_CONFIG } from '../services/rtcConfig';
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
import { IconAlertTriangle, IconBroadcast } from '../components/UI/Icons';
import BroadcastTopBar from '../components/Broadcast/BroadcastTopBar';
import RoomAccessPanel from '../components/Broadcast/RoomAccessPanel';
import StudioConfigPanel from '../components/Broadcast/StudioConfigPanel';
import HostFeed from '../components/Broadcast/HostFeed';
import HostControlBar from '../components/Broadcast/HostControlBar';
import StagePlaceholder from '../components/Broadcast/StagePlaceholder';
import { isRoomPasswordValid, isRoomE2eeValid, type RoomOptionsValue } from '../components/Controls/RoomOptionsPanel';
import StatsOverlay from '../components/UI/StatsOverlay';
import { useStatsHistory } from '../hooks/useStatsHistory';
import QrCode from '../components/UI/QrCode';
import { useRecorder } from '../hooks/useRecorder';
import { buildPermanentLink, getOrCreatePermanentRoomCode } from '../utils/permanentRoom';
import { clampMiniWidth, parseStoredMiniWidth } from '../utils/miniPlayer';
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
  const { hudMessage, showHud } = useHudNotification();
  /** O som do co-apresentador começa mudo para evitar eco com o áudio que ele recebe */
  const [copresenterMuted, setCopresenterMuted] = useState(true);

  const [videoConfig, setVideoConfig] = useState<VideoConfigType>(DEFAULT_VIDEO_CONFIG);

  const [roomOptions, setRoomOptions] = useState<RoomOptionsValue>({
    password: '',
    requireApproval: false,
    privacyMode: false,
    e2ee: false,
  });
  const createRoomOptions = useMemo<CreateRoomPayload>(() => {
    const options: CreateRoomPayload = {};
    if (roomOptions.password) options.password = roomOptions.password;
    if (roomOptions.requireApproval) options.requireApproval = true;
    if (roomOptions.privacyMode) options.privacyMode = true;
    if (roomOptions.e2ee) options.e2ee = true;
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
  const { copied: copiedLink, copy: copyLink } = useCopyToClipboard();

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
    kickViewer,
    getCombinedStream,
  } = useBroadcast(videoConfig, audioSelection, captureSourceId, createRoomOptions);
  const statsHistory = useStatsHistory(state.stats);
  const [showQr, setShowQr] = useState(false);
  const recorder = useRecorder(getCombinedStream, state.isSharing);

  const { socket } = useSocket();
  const copresenter = useCopresenterStream(socket, state.isSharing, state.iceServers, state.e2ee);
  const copresenterStream = copresenter.stream;
  const hasCopresenterVideo = copresenterStream !== null;
  /** Retorno local vira miniplayer assim que há tela de co-apresentador no player principal */
  const hostIsMini = hasCopresenterVideo;
  const passwordValid = isRoomPasswordValid(roomOptions.password) && isRoomE2eeValid(roomOptions);
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
    await copyLink(displayUrl);
  }, [copyLink, displayUrl]);

  return (
    <div className={styles.studioLayout}>
      {/* ── HUD Flutuante de Feedback ─────────────────────────────────── */}
      {hudMessage && (
        <div className={`${viewerStyles.hudNotification} ${styles.hudBelowTopBar}`} role="status" aria-live="polite">
          <span>{hudMessage}</span>
        </div>
      )}

      {/* ── Barra Superior de Estúdio ────────────────────────────────────── */}
      <BroadcastTopBar
        isSharing={state.isSharing}
        connectionState={state.connectionState}
        viewerCount={state.viewerCount}
        maxViewers={state.maxViewers}
        isSettingsVisible={isSettingsVisible}
        onToggleSettings={toggleSettings}
        onBack={() => navigate('/')}
        hasTitleBar={Boolean(window.screenShareHost?.window)}
      />

      {/* ── Conteúdo Principal do Estúdio ───────────────────────────────── */}
      <div className={`${styles.bodyLayout} ${!isSettingsVisible ? styles.settingsHidden : ''}`}>

        {/* ── Painel Esquerdo: Acesso à Sala ─────────────────────────────── */}
        <RoomAccessPanel
          state={state}
          previewAtivo={previewAtivo}
          captureSupported={captureSupported}
          passwordValid={passwordValid}
          privacyIgnored={privacyIgnored}
          tunnelDown={tunnelDown}
          displayCode={displayCode}
          displayUrl={displayUrl}
          copiedLink={copiedLink}
          roomOptions={roomOptions}
          onRoomOptionsChange={handleRoomOptionsChange}
          onStart={handleStart}
          onStop={stopSharing}
          onTogglePause={togglePause}
          onTogglePreview={togglePreview}
          onCopyLink={() => void handleCopyLink()}
          onShowQr={() => setShowQr(true)}
          onRespondJoin={respondJoin}
          onKickViewer={kickViewer}
        />
        {showQr && <QrCode value={displayUrl} onClose={() => setShowQr(false)} />}

        {/* ── Painel Direito: Configurações de Transmissão ──────────────── */}
        <StudioConfigPanel
          videoConfig={videoConfig}
          onVideoConfigChange={handleVideoConfigChange}
          isSharing={state.isSharing}
          audio={audioHook}
          captureSourceId={captureSourceId}
          onSelectSource={handleSelectSource}
        />

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
                <HostFeed
                  previewRef={previewRef}
                  previewAtivo={previewAtivo}
                  isMini={hostIsMini}
                  miniVisible={miniVisible}
                  miniWidth={miniWidth}
                  onResizeMini={resizeMini}
                  onToggleMini={toggleMini}
                />

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

                {showStats && state.stats && <StatsOverlay stats={state.stats} targetFps={videoConfig.frameRate} history={statsHistory} />}

                {/* ── Barra flutuante: controles essenciais sempre acessíveis ── */}
                <HostControlBar
                  isPaused={state.isPaused}
                  isRecording={recorder.isRecording}
                  elapsed={recorder.elapsed}
                  recorderError={recorder.error}
                  copiedLink={copiedLink}
                  previewAtivo={previewAtivo}
                  isDesktop={audioHook.isDesktop}
                  hasCopresenterVideo={hasCopresenterVideo}
                  miniVisible={miniVisible}
                  pipSupported={pipSupported}
                  isNativePip={isNativePip}
                  copresenterMuted={copresenterMuted}
                  hasStats={Boolean(state.stats)}
                  showStats={showStats}
                  fullscreenSupported={fullscreenSupported}
                  isFullscreen={isFullscreen}
                  onTogglePause={togglePause}
                  onToggleRecording={() => (recorder.isRecording ? void recorder.stop() : recorder.start())}
                  onStop={stopSharing}
                  onCopyLink={() => void handleCopyLink()}
                  onTogglePreview={togglePreview}
                  onChangeScreen={() => { void handleWebChangeScreen(); }}
                  onToggleMini={toggleMini}
                  onTogglePip={() => void handleToggleNativePip()}
                  onToggleCopresenterMuted={() => setCopresenterMuted((m) => !m)}
                  onToggleStats={() => setShowStats((v) => !v)}
                  onToggleFullscreen={() => void handleToggleFullscreen()}
                />
              </>
            ) : (
              <StagePlaceholder
                isSettingsVisible={isSettingsVisible}
                startDisabled={!captureSupported || !passwordValid}
                error={state.error}
                onStart={handleStart}
              />
            )}
          </div>
        </main>
      </div>
    </div>
  );
};

export default BroadcastPage;
