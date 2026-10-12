import React, { useRef, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBroadcast } from '../hooks/useBroadcast';
import { useAudioSources } from '../hooks/useAudioSources';
import {
  KiaraLogo,
  IconArrowLeft,
  IconUsers,
  IconScreen,
  IconAlertTriangle,
} from '../components/UI/Icons';
import StreamControls from '../components/Controls/StreamControls';
import AudioSourceList from '../components/Controls/AudioSourceList';
import CaptureSourcePicker from '../components/Controls/CaptureSourcePicker';
import VideoConfigPanel from '../components/Controls/VideoConfigPanel';
import StatsOverlay from '../components/UI/StatsOverlay';
import ConnectionBadge from '../components/UI/ConnectionBadge';
import InviteCode from '../components/UI/InviteCode';
import styles from './BroadcastPage.module.css';
import type { VideoConfig as VideoConfigType } from '@shared/index';

const BroadcastPage: React.FC = () => {
  const navigate = useNavigate();
  const previewRef = useRef<HTMLVideoElement>(null);

  const [videoConfig, setVideoConfig] = useState<VideoConfigType>({
    width: 1920,
    height: 1080,
    frameRate: 60,
    codec: 'H264',
    bitrate: 5000,
    quality: 'high',
  });

  const audioHook = useAudioSources();
  const { setPaused: setAudioPollingPaused } = audioHook;
  const [captureSourceId, setCaptureSourceId] = useState<string | null>(null);

  const audioSelection = useMemo(() => {
    const pids: number[] = [];
    const volumes: Record<number, number> = {};
    const muted: Record<number, boolean> = {};
    for (const src of audioHook.sources) {
      if (!audioHook.selected.has(src.id)) continue;
      pids.push(src.processId);
      volumes[src.processId] = src.volume;
      muted[src.processId] = src.isMuted;
    }
    return { pids, volumes, muted };
  }, [audioHook.sources, audioHook.selected]);

  const [tunnelDown, setTunnelDown] = useState(false);
  useEffect(() => {
    const hostApp = window.screenShareHost?.app;
    if (!hostApp) return;
    let cancelled = false;
    hostApp.getPublicUrl()
      .then((publicUrl) => {
        if (!cancelled && publicUrl === null) setTunnelDown(true);
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
  } = useBroadcast(videoConfig, undefined, audioSelection, captureSourceId);

  const handleVideoConfigChange = (newConfig: VideoConfigType) => {
    setVideoConfig(newConfig);
    if (state.isSharing) {
      void updateVideoConfig(newConfig);
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

  useEffect(() => {
    if (previewRef.current && state.stream) {
      previewRef.current.srcObject = state.stream;
    }
  }, [state.stream]);

  return (
    <div className={styles.studioLayout}>
      {/* ── Barra Superior de Estúdio ────────────────────────────────────── */}
      <header className={styles.topBar}>
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

        <div className={styles.topBarRight}>
          <ConnectionBadge state={state.connectionState} />

          {state.isSharing && (
            <div className={styles.viewersCountPill}>
              <IconUsers size={15} />
              <span>
                <strong>{state.viewerCount}</strong> espectador{state.viewerCount !== 1 ? 'es' : ''}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ── Conteúdo Principal do Estúdio ───────────────────────────────── */}
      <div className={styles.bodyLayout}>
        {/* Painel Lateral Esquerdo (Controles e Configurações) */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarSection}>
            <StreamControls
              isSharing={state.isSharing}
              isPaused={state.isPaused}
              onStart={startSharing}
              onStop={stopSharing}
              onTogglePause={togglePause}
            />

            {state.error && (
              <div className={styles.errorBox} role="alert">
                <IconAlertTriangle size={16} className={styles.errorIcon} />
                <span>{state.error}</span>
              </div>
            )}
          </div>

          {/* Configurações de Qualidade */}
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
        </aside>

        {/* Área Central: Preview da Transmissão e Informações da Sala */}
        <main className={styles.mainArea}>
          <div className={styles.previewContainer}>
            {state.isSharing ? (
              <>
                <video
                  ref={previewRef}
                  autoPlay
                  muted
                  playsInline
                  className={styles.previewVideo}
                />
                
                {/* Header Flutuante do Preview */}
                <div className={styles.previewOverlayTop}>
                  <div className={styles.liveIndicator}>
                    <span className={styles.liveDot} />
                    <span>AO VIVO (60 FPS)</span>
                  </div>
                  {state.isPaused && (
                    <div className={styles.pausedIndicator}>
                      <span>EM PAUSA</span>
                    </div>
                  )}

                  {/* Botão de Troca Rápida de Tela / Janela no Web Mode ou Desktop */}
                  {!audioHook.isDesktop && (
                    <button
                      type="button"
                      className={styles.switchScreenBtn}
                      onClick={() => { void handleWebChangeScreen(); }}
                      title="Alternar para outra tela ou janela sem parar a transmissão"
                    >
                      <IconScreen size={14} />
                      <span>Trocar Tela / Janela</span>
                    </button>
                  )}
                </div>

                {state.stats && <StatsOverlay stats={state.stats} />}
              </>
            ) : (
              <div className={styles.placeholderState}>
                <div className={styles.placeholderIconBox}>
                  <IconScreen size={44} />
                </div>
                <h3>Pronto para transmitir</h3>
                <p>
                  Ajuste a resolução e os canais de áudio na barra lateral e clique em{' '}
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
                    <span>Compartilhe o código</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Card de Compartilhamento da Sala */}
          {state.isSharing && state.roomCode && (
            <div className={styles.roomShareSection}>
              {tunnelDown && (
                <div className={styles.tunnelWarning} role="status">
                  <IconAlertTriangle size={16} />
                  <span>
                    Túnel público indisponível: o link gerado funcionará apenas em computadores da
                    mesma rede local.
                  </span>
                </div>
              )}
              <InviteCode code={state.roomCode} url={state.inviteUrl ?? ''} />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default BroadcastPage;
