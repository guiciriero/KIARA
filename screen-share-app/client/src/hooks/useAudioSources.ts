/**
 * useAudioSources.ts
 * Hook para listar e controlar fontes de áudio por aplicativo.
 *
 * - Modo desktop (Electron): `window.screenShareHost` está presente e a lista vem de
 *   `host.audio.listSources()`. A lista é atualizada periodicamente enquanto NÃO há
 *   transmissão, preservando volume e mute dos itens já existentes.
 *   O volume/mute é aplicado no renderer (GainNode do AppAudioMixer), não no nativo.
 * - Modo web: só existe a fonte única "áudio do sistema" (via getDisplayMedia).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AudioSource } from '@shared/index';

/** Intervalo da atualização automática da lista no modo desktop */
const AUTO_REFRESH_MS = 5000;

/** Plataforma do navegador, derivada de navigator.platform (sem inventar valores) */
function detectBrowserPlatform(): AudioSource['platform'] {
  const p = typeof navigator !== 'undefined' ? navigator.platform : '';
  if (/mac/i.test(p)) return 'macos';
  if (/linux|x11/i.test(p)) return 'linux';
  return 'windows';
}

/** Mescla a lista nova com a atual, preservando volume/mute dos itens que já existiam */
function mergeSources(prev: AudioSource[], next: AudioSource[]): AudioSource[] {
  const prevById = new Map(prev.map((s) => [s.id, s]));
  return next.map((s) => {
    const old = prevById.get(s.id);
    return old ? { ...s, volume: old.volume, isMuted: old.isMuted } : s;
  });
}

export function useAudioSources() {
  const [sources, setSources]   = useState<AudioSource[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  // Suspende a atualização periódica (ex.: durante a transmissão)
  const [paused, setPaused]     = useState(false);

  /** true quando rodando no app desktop com a ponte do preload disponível */
  const isDesktop = typeof window !== 'undefined' && window.screenShareHost !== undefined;

  const refreshingRef = useRef(false);

  /**
   * Busca a lista de aplicativos com áudio disponível para captura.
   * @param silent  não mostra o indicador de carregamento (usado no polling)
   */
  const load = useCallback(async (silent: boolean) => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    if (!silent) setLoading(true);
    setError(null);
    try {
      const host = window.screenShareHost;
      if (host) {
        const list = await host.audio.listSources();
        setSources((prev) => mergeSources(prev, list));
        // Remove da seleção apps que não existem mais
        setSelected((prev) => {
          const ids = new Set(list.map((s) => s.id));
          const next = new Set([...prev].filter((id) => ids.has(id)));
          return next.size === prev.size ? prev : next;
        });
      } else {
        // No navegador: apenas o áudio do sistema inteiro (getDisplayMedia).
        // Áudio por aplicativo exige o app desktop.
        const webSource: AudioSource = {
          id: 'web:system-audio',
          processId: 0,
          processName: 'system-audio',
          displayName: 'Áudio do Sistema (todos os apps)',
          volume: 1.0,
          isMuted: false,
          platform: detectBrowserPlatform(),
        };
        setSources((prev) => mergeSources(prev, [webSource]));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível listar as fontes de áudio.');
    } finally {
      refreshingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, []);

  /** Atualização manual (botão ↻) */
  const refreshSources = useCallback(() => { void load(false); }, [load]);

  useEffect(() => {
    void load(false);
  }, [load]);

  // Atualização periódica (apenas desktop e apenas fora da transmissão)
  useEffect(() => {
    if (!isDesktop || paused) return;
    const timer = setInterval(() => { void load(true); }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [isDesktop, paused, load]);

  /** Alterna seleção de uma fonte */
  const toggleSource = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Ajusta volume de uma fonte (0.0 - 1.0). O useBroadcast reflete no mixer ao vivo. */
  const setVolume = useCallback((id: string, volume: number) => {
    setSources((prev) =>
      prev.map((s) => (s.id === id ? { ...s, volume } : s)),
    );
  }, []);

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
    isDesktop,
    toggleSource,
    setVolume,
    toggleMute,
    refreshSources,
    setPaused,
  };
}
