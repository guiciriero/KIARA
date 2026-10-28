import React from 'react';
import type { VideoConfig } from '@shared/index';
import type { useAudioSources } from '../../hooks/useAudioSources';
import VideoConfigPanel from '../Controls/VideoConfigPanel';
import AudioSourceList from '../Controls/AudioSourceList';
import CaptureSourcePicker from '../Controls/CaptureSourcePicker';
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

        {/* Seletor Inline de Tela/Janela (Desktop Electron) */}
        {audio.isDesktop && (
          <CaptureSourcePicker
            selectedId={captureSourceId}
            onSelect={(id) => void onSelectSource(id)}
            isSharing={isSharing}
          />
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
    </aside>
  );
};

export default StudioConfigPanel;
