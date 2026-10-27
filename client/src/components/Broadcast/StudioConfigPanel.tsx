import React, { useState } from 'react';
import type { VideoConfig } from '@shared/index';
import type { useAudioSources } from '../../hooks/useAudioSources';
import VideoConfigPanel from '../Controls/VideoConfigPanel';
import AudioSourceList from '../Controls/AudioSourceList';
import CaptureSourceModal from '../Controls/CaptureSourceModal';
import { IconScreen } from '../UI/Icons';
import styles from '../../pages/BroadcastPage.module.css';

interface Props {
  videoConfig: VideoConfig;
  onVideoConfigChange: (config: VideoConfig) => void;
  isSharing: boolean;
  audio: ReturnType<typeof useAudioSources>;
  captureSourceId: string | null;
  onSelectSource: (sourceId: string) => Promise<void>;
}

/** Painel direito: qualidade de vídeo, fonte de captura (desktop) e fontes de áudio */
const StudioConfigPanel: React.FC<Props> = ({
  videoConfig,
  onVideoConfigChange,
  isSharing,
  audio,
  captureSourceId,
  onSelectSource,
}) => {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <aside
      id="studio-config-panel"
      className={styles.sidebarConfig}
      aria-label="Configurações de transmissão"
    >
      <div className={styles.sidebarInner}>

        {/* Configurações de Qualidade de Vídeo */}
        <VideoConfigPanel
          config={videoConfig}
          onChange={onVideoConfigChange}
          isSharing={isSharing}
        />

        {/* Seletor de Tela/Janela — abre como modal (Desktop Electron) */}
        {audio.isDesktop && (
          <div className={styles.captureSourceSection}>
            <button
              type="button"
              className={`${styles.captureSourceTrigger} ${captureSourceId ? styles.captureSourceTriggerActive : ''}`}
              onClick={() => setModalOpen(true)}
              aria-haspopup="dialog"
            >
              <IconScreen size={15} />
              <span className={styles.captureSourceTriggerText}>
                {captureSourceId
                  ? isSharing
                    ? 'Trocar tela transmitida'
                    : 'Tela selecionada'
                  : 'Selecionar tela ou janela'}
              </span>
              {captureSourceId && isSharing && (
                <span className={styles.captureSourceLivePill}>no ar</span>
              )}
            </button>
          </div>
        )}

        {/* Fontes de Áudio por Processo */}
        <AudioSourceList
          sources={audio.sources}
          selected={audio.selected}
          loading={audio.loading}
          onToggle={audio.toggleSource}
          onVolumeChange={audio.setVolume}
          onMuteToggle={audio.toggleMute}
          onRefresh={audio.refreshSources}
          webMode={!audio.isDesktop}
        />
      </div>

      {/* Modal de seleção de tela */}
      {modalOpen && (
        <CaptureSourceModal
          selectedId={captureSourceId}
          isSharing={isSharing}
          videoConfig={videoConfig}
          onVideoConfigChange={onVideoConfigChange}
          onConfirm={(id) => { void onSelectSource(id); }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </aside>
  );
};

export default StudioConfigPanel;
