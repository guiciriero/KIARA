/**
 * useAudioSources.ts
 * Hook para listar e controlar fontes de áudio por aplicativo.
 * Em modo web: usa os áudios capturados via getDisplayMedia.
 * Em modo Electron: acessa o módulo nativo para listagem por processo.
 */

import { useState, useEffect, useCallback } from 'react';
import type { AudioSource } from '@shared/index';

// Verifica se estamos rodando em ambiente Electron com módulo nativo disponível
const isElectron = typeof window !== 'undefined' &&
  typeof (window as unknown as { __nativeCapture?: unknown }).__nativeCapture !== 'undefined';

export function useAudioSources() {
  const [sources, setSources]   = useState<AudioSource[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  /** Busca a lista de aplicativos com áudio disponível para captura */
  const refreshSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (isElectron) {
        // Em modo Electron: usa o módulo nativo exposto pelo preload script
        const native = (window as unknown as { __nativeCapture: {
          listAudioSources: () => AudioSource[]
        } }).__nativeCapture;
        const list = native.listAudioSources();
        setSources(list);
      } else {
        // No navegador web: apenas o áudio do sistema está disponível via getDisplayMedia.
        // Captura de áudio por aplicativo individual requer o modo Electron + módulo nativo.
        const webSource: AudioSource = {
          id: 'web:system-audio',
          processId: 0,
          processName: 'system-audio',
          displayName: 'Áudio do Sistema (todos os apps)',
          volume: 1.0,
          isMuted: false,
          platform: 'linux',
        };
        setSources([webSource]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível listar as fontes de áudio.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSources();
  }, [refreshSources]);

  /** Alterna seleção de uma fonte */
  const toggleSource = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  /** Ajusta volume de uma fonte (0.0 - 1.0) */
  const setVolume = useCallback((id: string, volume: number) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, volume } : s)),
    );

    if (isElectron) {
      const source = sources.find((s) => s.id === id);
      if (source) {
        const native = (window as unknown as { __nativeCapture: {
          setSourceVolume: (pid: number, vol: number) => void
        } }).__nativeCapture;
        native.setSourceVolume(source.processId, volume);
      }
    }
  }, [sources]);

  /** Muta/desmuta uma fonte */
  const toggleMute = useCallback((id: string) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, isMuted: !s.isMuted } : s)),
    );
  }, []);

  return {
    sources,
    selected,
    loading,
    error,
    toggleSource,
    setVolume,
    toggleMute,
    refreshSources,
  };
}
