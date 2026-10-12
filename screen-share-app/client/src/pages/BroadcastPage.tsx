/**
 * BroadcastPage.tsx
 *
 * Página do modo apresentador.
 * Organizada em duas colunas: sidebar de configurações à esquerda
 * e área de preview + informações da sala à direita.
 *
 * Correção: stream agora vem de state.stream (reativo) em vez de
 * streamRef.current retornado pelo hook (não reativo).
 */

import React, { useRef, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBroadcast } from '../hooks/useBroadcast';
import { useAudioSources } from '../hooks/useAudioSources';
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
  const navigate   = useNavigate();
  const previewRef = useRef<HTMLVideoElement>(null);

  const [videoConfig, setVideoConfig] = useState<VideoConfigType>({
    width: 1920, height: 1080, frameRate: 30,
    codec: 'H264', bitrate: 4000, quality: 'high',
  });

  const audioHook = useAudioSources();
  const { setPaused: setAudioPollingPaused } = audioHook;
  // (desktop) tela/janela escolhida no CaptureSourcePicker
  const [captureSourceId, setCaptureSourceId] = useState<string | null>(null);

  // Seleção de áudio por aplicativo (PIDs marcados + volume/mute individuais).
  // Os PIDs valem ao iniciar a transmissão; volume/mute refletem ao vivo.
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

  // App instalado: avisa se o túnel público não está disponível (link só local)
  const [tunnelDown, setTunnelDown] = useState(false);
  useEffect(() => {
    const hostApp = window.screenShareHost?.app;
    if (!hostApp) return;
    let cancelled = false;
    hostApp.getPublicUrl()
      .then((publicUrl) => { if (!cancelled && publicUrl === null) setTunnelDown(true); })
      .catch(() => { /* sem aviso: não quebra a página */ });
    return () => { cancelled = true; };
  }, []);

  // stream agora é reativo — vem de state.stream
  const { state, startSharing, stopSharing, togglePause } =
    useBroadcast(videoConfig, undefined, audioSelection, captureSourceId);

  // Pausa a atualização periódica da lista de apps enquanto transmite
  useEffect(() => {
    setAudioPollingPaused(state.isSharing);
  }, [state.isSharing, setAudioPollingPaused]);

  // Conecta o stream local ao elemento <video> de preview sempre que ele mudar
  useEffect(() => {
    if (previewRef.current && state.stream) {
      previewRef.current.srcObject = state.stream;
    }
  }, [state.stream]);

  return (
    <div className={styles.layout}>
      {/* ── Painel lateral de controles ───────────────────────────────────── */}
      <aside className={styles.sidebar}>
        <button className={styles.backBtn} onClick={() => navigate('/')}>
          ← Voltar
        </button>

        <h2 className={styles.sidebarTitle}>Compartilhar Tela</h2>

        <ConnectionBadge state={state.connectionState} />

        {/* Configurações de qualidade do vídeo */}
        <VideoConfigPanel
          config={videoConfig}
          onChange={setVideoConfig}
          disabled={state.isSharing}
        />

        {/* Seletor de tela/janela — só aparece no app desktop */}
        {audioHook.isDesktop && (
          <CaptureSourcePicker
            selectedId={captureSourceId}
            onSelect={setCaptureSourceId}
            disabled={state.isSharing}
          />
        )}

        {/* Lista de aplicativos com saída de áudio */}
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

        {/* Botões de iniciar, pausar e encerrar */}
        <StreamControls
          isSharing={state.isSharing}
          isPaused={state.isPaused}
          onStart={startSharing}
          onStop={stopSharing}
          onTogglePause={togglePause}
        />

        {/* Mensagem de erro amigável */}
        {state.error && (
          <div className={styles.errorBox}>{state.error}</div>
        )}
      </aside>

      {/* ── Área principal: preview + info da sala ────────────────────────── */}
      <main className={styles.main}>
        <div className={styles.previewContainer}>
          {state.isSharing ? (
            <>
              <video
                ref={previewRef}
                autoPlay
                muted
                playsInline
                className={styles.preview}
              />
              {state.stats && <StatsOverlay stats={state.stats} />}
            </>
          ) : (
            <div className={styles.placeholder}>
              <span>🖥️</span>
              <p>Clique em "Iniciar Compartilhamento" para começar</p>
            </div>
          )}
        </div>

        {/* Código de convite — aparece só enquanto estiver compartilhando */}
        {state.isSharing && state.roomCode && (
          <div className={styles.roomInfo}>
            {tunnelDown && (
              <p className={styles.tunnelWarning} role="status">
                Sem conexão com a internet segura: o link só funciona neste computador.
              </p>
            )}
            <InviteCode code={state.roomCode} url={state.inviteUrl ?? ''} />
            <div className={styles.viewers}>
              <span>👥</span>
              <strong>{state.viewerCount}</strong>
              {' '}espectador{state.viewerCount !== 1 ? 'es' : ''}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default BroadcastPage;
