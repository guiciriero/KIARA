import React from 'react';
import {
  IconScreen,
  IconEye,
  IconEyeOff,
  IconCopy,
  IconCheck,
  IconPause,
  IconPlay,
  IconStop,
  IconActivity,
  IconFullscreen,
  IconExitFullscreen,
  IconVolumeHigh,
  IconVolumeMute,
  IconPictureInPicture,
  IconUsers,
} from '../UI/Icons';
import { formatElapsed } from '../../hooks/useRecorder';
import styles from '../../pages/BroadcastPage.module.css';
// Barra flutuante e botões do player: as mesmas classes do espectador, para os dois ficarem idênticos
import viewerStyles from '../../pages/ViewerPage.module.css';

interface Props {
  /** Barra visível (some após 3 s sem mexer o mouse) */
  visible: boolean;
  /** Tempo de transmissão em segundos */
  streamElapsed: number;
  viewerCount: number;
  maxViewers: number;
  isPaused: boolean;
  isRecording: boolean;
  elapsed: number;
  recorderError: string | null;
  copiedLink: boolean;
  previewAtivo: boolean;
  /** No app desktop a troca de tela é feita pelo seletor lateral */
  isDesktop: boolean;
  hasCopresenterVideo: boolean;
  miniVisible: boolean;
  pipSupported: boolean;
  isNativePip: boolean;
  copresenterMuted: boolean;
  hasStats: boolean;
  showStats: boolean;
  fullscreenSupported: boolean;
  isFullscreen: boolean;
  onTogglePause: () => void;
  onToggleRecording: () => void;
  onStop: () => void;
  onCopyLink: () => void;
  onTogglePreview: () => void;
  onChangeScreen: () => void;
  onToggleMini: () => void;
  onTogglePip: () => void;
  onToggleCopresenterMuted: () => void;
  onToggleStats: () => void;
  onToggleFullscreen: () => void;
}

/** Barra flutuante do palco: controles essenciais sempre acessíveis durante a transmissão */
const HostControlBar: React.FC<Props> = ({
  visible,
  streamElapsed,
  viewerCount,
  maxViewers,
  isPaused,
  isRecording,
  elapsed,
  recorderError,
  copiedLink,
  previewAtivo,
  isDesktop,
  hasCopresenterVideo,
  miniVisible,
  pipSupported,
  isNativePip,
  copresenterMuted,
  hasStats,
  showStats,
  fullscreenSupported,
  isFullscreen,
  onTogglePause,
  onToggleRecording,
  onStop,
  onCopyLink,
  onTogglePreview,
  onChangeScreen,
  onToggleMini,
  onTogglePip,
  onToggleCopresenterMuted,
  onToggleStats,
  onToggleFullscreen,
}) => (
  <footer
    className={`${viewerStyles.bottomBar} ${styles.hostBar} ${visible ? '' : viewerStyles.hidden}`}
    data-idle-keep
  >
    <div className={viewerStyles.bottomBarLeft}>
      {/* Único indicador "ao vivo" do app */}
      <div className={viewerStyles.liveIndicator} role="status">
        <span className={viewerStyles.liveDot} aria-hidden="true" />
        <span>Ao vivo</span>
      </div>
      <span className={styles.hostStat} title="Tempo no ar">{formatElapsed(streamElapsed)}</span>
      <span className={styles.hostStat} title="Espectadores" aria-label={` espectadores`}>
        <IconUsers size={14} />
        {viewerCount}
        {maxViewers > 0 ? `/` : ''}
      </span>

      <button
        type="button"
        className={`${viewerStyles.iconBtn} ${isPaused ? viewerStyles.activeBtn : ''}`}
        onClick={onTogglePause}
        title={isPaused ? 'Retomar' : 'Pausar'}
        aria-label={isPaused ? 'Retomar transmissão' : 'Pausar transmissão'}
        aria-pressed={isPaused}
      >
        {isPaused ? <IconPlay size={18} /> : <IconPause size={18} />}
      </button>

      <button
        type="button"
        className={`${viewerStyles.iconBtn} ${isRecording ? viewerStyles.activeBtn : ''}`}
        onClick={onToggleRecording}
        title="Gravar (fica só neste computador)"
        aria-label={isRecording ? 'Parar gravação' : 'Gravar transmissão'}
        aria-pressed={isRecording}
      >
        <span>{isRecording ? `Gravando ${formatElapsed(elapsed)}` : 'Gravar'}</span>
      </button>
      {recorderError && <span role="alert">{recorderError}</span>}

      <button
        type="button"
        className={styles.stopBtn}
        onClick={onStop}
        title="Parar e fechar a sala"
        aria-label="Parar transmissão"
      >
        <IconStop size={16} />
        <span>Parar</span>
      </button>
    </div>

    <div className={viewerStyles.bottomBarRight}>
      <button
        type="button"
        className={`${viewerStyles.iconBtn} ${copiedLink ? viewerStyles.activeBtn : ''}`}
        onClick={onCopyLink}
        title={copiedLink ? 'Copiado' : 'Copiar link'}
        aria-label={copiedLink ? 'Link copiado' : 'Copiar link da sala'}
      >
        {copiedLink ? <IconCheck size={18} /> : <IconCopy size={18} />}
      </button>

      <button
        type="button"
        className={viewerStyles.iconBtn}
        onClick={onTogglePreview}
        title={previewAtivo ? 'Ocultar retorno' : 'Mostrar retorno'}
        aria-label={previewAtivo ? 'Ocultar retorno' : 'Mostrar retorno'}
        aria-pressed={!previewAtivo}
      >
        {previewAtivo ? <IconEyeOff size={18} /> : <IconEye size={18} />}
      </button>

      {!isDesktop && (
        <button
          type="button"
          className={viewerStyles.iconBtn}
          onClick={onChangeScreen}
          title="Trocar tela ou janela"
          aria-label="Trocar tela ou janela"
        >
          <IconScreen size={18} />
        </button>
      )}

      {hasCopresenterVideo && (
        <button
          type="button"
          className={`${viewerStyles.iconBtn} ${miniVisible ? viewerStyles.activeBtn : ''}`}
          onClick={onToggleMini}
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
          onClick={onTogglePip}
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
          onClick={onToggleCopresenterMuted}
          title={copresenterMuted ? 'Ouvir o co-apresentador' : 'Silenciar o co-apresentador'}
          aria-label={copresenterMuted ? 'Ouvir o co-apresentador' : 'Silenciar o co-apresentador'}
          aria-pressed={!copresenterMuted}
        >
          {copresenterMuted ? <IconVolumeMute size={18} /> : <IconVolumeHigh size={18} />}
        </button>
      )}

      {hasStats && (
        <button
          type="button"
          className={`${viewerStyles.iconBtn} ${showStats ? viewerStyles.activeBtn : ''}`}
          onClick={onToggleStats}
          title="Telemetria"
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
          onClick={onToggleFullscreen}
          title={isFullscreen ? 'Sair de tela cheia (F)' : 'Tela cheia (F)'}
          aria-label={isFullscreen ? 'Sair de tela cheia' : 'Tela cheia'}
          aria-keyshortcuts="F"
        >
          {isFullscreen ? <IconExitFullscreen size={18} /> : <IconFullscreen size={18} />}
        </button>
      )}
    </div>
  </footer>
);

export default HostControlBar;
