import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBroadcast, getPermanentRoomCode, clearPermanentRoomCode } from '../hooks/useBroadcast';
import { useAudioSources } from '../hooks/useAudioSources';
import { useChat } from '../hooks/useChat';
import { useSocket } from '../services/SocketContext';
import { isDisplayCaptureSupported } from '../services/captureService';
import {
  KiaraLogo,
  IconArrowLeft,
  IconUsers,
  IconScreen,
  IconAlertTriangle,
  IconEyeOff,
  IconCopy,
  IconCheck,
  IconRefresh,
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
import InviteCode from '../components/UI/InviteCode';
import JoinRequestsPanel from '../components/UI/JoinRequestsPanel';
import UploadEstimate from '../components/UI/UploadEstimate';
import ChatPanel, { ReactionOverlay } from '../components/UI/ChatPanel';
import styles from './BroadcastPage.module.css';
import type { VideoConfig as VideoConfigType, CreateRoomPayload } from '@shared/index';

/** Monta a URL de preview a partir do código permanente (ou de sessão) */
function buildPreviewUrl(code: string): string {
  return `${window.location.origin}/view/${code}`;
}

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

  const [roomOptions, setRoomOptions] = useState<RoomOptionsValue>({
    password: '',
    requireApproval: false,
    privacyMode: false,
    chatEnabled: true,
    reactionsEnabled: true,
  });
  const createRoomOptions = useMemo<CreateRoomPayload>(() => {
    const options: CreateRoomPayload = {
      chatEnabled: roomOptions.chatEnabled,
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

  // ── Sala Permanente: link fixo pré-transmissão ──────────────────────────────
  const [permanentCode, setPermanentCode] = useState<string | null>(() => getPermanentRoomCode());
  const [copiedPreLink, setCopiedPreLink] = useState(false);

  const handleResetPermanentCode = useCallback(() => {
    clearPermanentRoomCode();
    setPermanentCode(null);
  }, []);

  const handleCopyPreLink = useCallback(async () => {
    if (!permanentCode) return;
    const url = buildPreviewUrl(permanentCode);
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
    setCopiedPreLink(true);
    setTimeout(() => setCopiedPreLink(false), 2200);
  }, [permanentCode]);

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
    respondJoin,
  } = useBroadcast(videoConfig, audioSelection, captureSourceId, createRoomOptions);

  // Após obter o código real, sincroniza o estado local de permanentCode
  useEffect(() => {
    if (state.roomCode) {
      setPermanentCode(state.roomCode);
    }
  }, [state.roomCode]);

  const { socket } = useSocket();
  const chat = useChat();
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
        chatEnabled: newOptions.chatEnabled,
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

  // Código efetivo a exibir (ao vivo ou permanente/pré-sessão)
  const displayCode = state.roomCode ?? permanentCode;
  const displayUrl = state.inviteUrl ?? (permanentCode ? buildPreviewUrl(permanentCode) : null);

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
                <strong>{state.viewerCount}</strong>
                {state.maxViewers > 0 ? ` de ${state.maxViewers}` : ''}{' '}
                espectador{state.viewerCount !== 1 ? 'es' : ''}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* ── Conteúdo Principal do Estúdio ───────────────────────────────── */}
      <div className={styles.bodyLayout}>

        {/* ── Painel Esquerdo: Acesso à Sala ─────────────────────────────── */}
        <aside className={styles.sidebarRoom}>

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

            {displayCode && displayUrl ? (
              <div className={styles.permanentLinkCard}>
                {/* Indicação de link fixo */}
                <div className={styles.permanentLinkMeta}>
                  <span className={styles.permanentBadge}>Link Fixo</span>
                  {!state.isSharing && (
                    <button
                      type="button"
                      className={styles.resetCodeBtn}
                      onClick={handleResetPermanentCode}
                      title="Gerar novo código de sala na próxima transmissão"
                    >
                      <IconRefresh size={13} />
                      <span>Novo código</span>
                    </button>
                  )}
                </div>

                {/* Código grande */}
                <div className={styles.codeDisplay}>
                  <span className={styles.codeDisplayText}>{displayCode}</span>
                </div>

                {/* URL copiável */}
                <div className={styles.urlCopyRow}>
                  <span className={styles.urlDisplayShort} title={displayUrl}>
                    {displayUrl.replace(/^https?:\/\//, '').substring(0, 42)}
                    {displayUrl.replace(/^https?:\/\//, '').length > 42 ? '…' : ''}
                  </span>
                  <button
                    type="button"
                    className={`${styles.copyLinkBtn} ${copiedPreLink ? styles.copyLinkBtnCopied : ''}`}
                    onClick={() => void handleCopyPreLink()}
                    aria-label="Copiar link da sala"
                  >
                    {copiedPreLink ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    <span>{copiedPreLink ? 'Copiado!' : 'Copiar'}</span>
                  </button>
                </div>

                {/* Status e avisos */}
                {!state.isSharing && (
                  <p className={styles.permanentNote}>
                    Este link já pode ser compartilhado. Os espectadores verão uma tela de espera até você iniciar.
                  </p>
                )}
              </div>
            ) : (
              <div className={styles.permanentLinkEmpty}>
                <p>O link fixo aparecerá aqui após a primeira transmissão.</p>
              </div>
            )}

            {/* Selos da sala e avisos (ao vivo) */}
            {state.isSharing && state.roomCode && (
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

                {/* Link completo ao vivo */}
                <InviteCode code={state.roomCode} url={state.inviteUrl ?? ''} />
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

          {/* Seção: Estimativa de upload */}
          <UploadEstimate
            bitrateKbps={videoConfig.bitrate}
            viewers={state.isSharing ? state.viewerCount : 1}
            maxViewers={state.isSharing ? state.maxViewers : 0}
          />
        </aside>

        {/* ── Painel Direito: Configurações de Transmissão + Preview ──────── */}
        <aside className={styles.sidebarConfig}>

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
        </aside>

        {/* ── Área Central: Preview da Transmissão ───────────────────────── */}
        <main className={styles.mainArea}>
          <div className={styles.previewContainer}>
            {state.isSharing ? (
              <>
                <video
                  ref={previewRef}
                  autoPlay
                  muted
                  playsInline
                  className={previewAtivo ? styles.previewVideo : styles.previewVideoOculto}
                />

                {/* Tela de fundo quando o preview está desabilitado */}
                {!previewAtivo && (
                  <div className={styles.previewDesabilitado}>
                    <IconEyeOff size={32} />
                    <span>Retorno de tela desabilitado</span>
                  </div>
                )}

                {/* Header Flutuante do Preview */}
                <div className={styles.previewOverlayTop}>
                  <div className={styles.liveIndicator}>
                    <span className={styles.liveDot} />
                    <span>AO VIVO ({videoConfig.frameRate} FPS)</span>
                  </div>
                  {state.isPaused && (
                    <div className={styles.pausedIndicator}>
                      <span>EM PAUSA</span>
                    </div>
                  )}

                  {/* Botão de Troca Rápida de Tela / Janela no Web Mode */}
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
                <ReactionOverlay
                  reactions={chat.reactions}
                  enabled={roomOptions.reactionsEnabled}
                />
              </>
            ) : (
              <div className={styles.placeholderState}>
                <div className={styles.placeholderIconBox}>
                  <IconScreen size={44} />
                </div>
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
              </div>
            )}
          </div>

          {/* Chat Dock (ao vivo) */}
          {state.isSharing && (
            <div className={styles.chatDock}>
              <ChatPanel
                messages={chat.messages}
                reactions={chat.reactions}
                unreadCount={chat.unreadCount}
                onSend={chat.sendMessage}
                onReact={chat.sendReaction}
                onMarkRead={chat.markRead}
                selfId={socket?.id}
                chatEnabled={roomOptions.chatEnabled}
                reactionsEnabled={roomOptions.reactionsEnabled}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default BroadcastPage;
