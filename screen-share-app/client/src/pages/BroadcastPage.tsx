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

import React, { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBroadcast } from '../hooks/useBroadcast';
import { useAudioSources } from '../hooks/useAudioSources';
import StreamControls from '../components/Controls/StreamControls';
import AudioSourceList from '../components/Controls/AudioSourceList';
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

  // stream agora é reativo — vem de state.stream
  const { state, startSharing, stopSharing, togglePause } = useBroadcast(videoConfig);
  const audioHook = useAudioSources();

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

        {/* Lista de aplicativos com saída de áudio */}
        <AudioSourceList
          sources={audioHook.sources}
          selected={audioHook.selected}
          loading={audioHook.loading}
          onToggle={audioHook.toggleSource}
          onVolumeChange={audioHook.setVolume}
          onMuteToggle={audioHook.toggleMute}
          onRefresh={audioHook.refreshSources}
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
