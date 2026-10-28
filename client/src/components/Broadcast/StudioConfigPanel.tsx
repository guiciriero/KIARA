import React from 'react';
import type { VideoConfig } from '@shared/index';
import type { useAudioSources } from '../../hooks/useAudioSources';
import VideoConfigPanel from '../Controls/VideoConfigPanel';
import AudioSourceList from '../Controls/AudioSourceList';
import SourcePicker from '../Controls/SourcePicker';
import styles from '../../pages/BroadcastPage.module.css';

interface Props {
  videoConfig: VideoConfig;
  onVideoConfigChange: (config: VideoConfig) => void;
  isSharing: boolean;
  audio: ReturnType<typeof useAudioSources>;
  captureSourceId: string | null;
  onSelectSource: (sourceId: string) => Promise<void>;
}

/** Painel direito: fonte (desktop), áudio e ajustes avançados */
const StudioConfigPanel: React.FC<Props> = ({
  videoConfig,
  onVideoConfigChange,
  isSharing,
  audio,
  captureSourceId,
  onSelectSource,
}) => (
  <aside
    id="studio-config-panel"
    className={styles.sidebarConfig}
    aria-label="Configurações de transmissão"
  >
    <div className={styles.sidebarInner}>
      {/* Telas e janelas direto no painel (Desktop Electron) */}
      {audio.isDesktop && (
        <SourcePicker
          selectedId={captureSourceId}
          isSharing={isSharing}
          onConfirm={(id) => onSelectSource(id)}
          videoConfig={videoConfig}
          onVideoConfigChange={onVideoConfigChange}
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

      {/* Avançado: bitrate (e resolução no navegador; no desktop ela vive na seção Fonte) */}
      <VideoConfigPanel
        config={videoConfig}
        onChange={onVideoConfigChange}
        isSharing={isSharing}
        hideResolution={audio.isDesktop}
      />
    </div>
  </aside>
);

export default StudioConfigPanel;