import React, { useState } from 'react';
import type { CaptureSourceInfo, VideoConfig } from '@shared/index';
import type { useAudioSources } from '../../hooks/useAudioSources';
import VideoConfigPanel from '../Controls/VideoConfigPanel';
import AudioSourceList from '../Controls/AudioSourceList';
import SourcePickerModal from '../Controls/SourcePickerModal';
import { IconArrowRight, IconScreen, IconWindow } from '../UI/Icons';
import styles from '../../pages/BroadcastPage.module.css';

interface Props {
  videoConfig: VideoConfig;
  onVideoConfigChange: (config: VideoConfig) => void;
  isSharing: boolean;
  audio: ReturnType<typeof useAudioSources>;
  captureSourceId: string | null;
  onSelectSource: (sourceId: string) => Promise<void>;
}

/** Painel direito: o que transmitir (desktop), áudio e ajustes avançados */
const StudioConfigPanel: React.FC<Props> = ({
  videoConfig,
  onVideoConfigChange,
  isSharing,
  audio,
  captureSourceId,
  onSelectSource,
}) => {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [source, setSource] = useState<CaptureSourceInfo | null>(null);

  const handleConfirm = async (id: string, picked?: CaptureSourceInfo) => {
    setSource(picked ?? null);
    await onSelectSource(id);
  };

  const SourceIcon = source?.type === 'window' ? IconWindow : IconScreen;

  return (
    <aside
      id="studio-config-panel"
      className={styles.sidebarConfig}
      aria-label="Configurações de transmissão"
    >
      <div className={styles.sidebarInner}>
        {/* Escolha de tela/janela (Desktop Electron): abre o modal de seleção */}
        {audio.isDesktop && (
          <>
            <button
              type="button"
              className={styles.sourceTrigger}
              onClick={() => setPickerOpen(true)}
              aria-haspopup="dialog"
            >
              <SourceIcon size={18} />
              <span className={styles.sourceTriggerText}>
                <span className={styles.sourceTriggerLabel}>Fonte</span>
                <span className={styles.sourceTriggerName}>
                  {source?.name ?? (captureSourceId ? 'Fonte escolhida' : 'Escolher tela ou janela')}
                </span>
              </span>
              <IconArrowRight size={14} />
            </button>
            <SourcePickerModal
              open={pickerOpen}
              onClose={() => setPickerOpen(false)}
              selectedId={captureSourceId}
              isSharing={isSharing}
              onConfirm={handleConfirm}
              videoConfig={videoConfig}
              onVideoConfigChange={onVideoConfigChange}
            />
          </>
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

        {/* Avançado: bitrate (e resolução no navegador; no desktop ela vive no modal) */}
        <VideoConfigPanel
          config={videoConfig}
          onChange={onVideoConfigChange}
          isSharing={isSharing}
          hideResolution={audio.isDesktop}
        />
      </div>
    </aside>
  );
};

export default StudioConfigPanel;
