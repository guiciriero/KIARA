/**
 * Lista e controla as fontes de áudio selecionáveis.
 *
 * - Desktop (Electron): a lista vem de `host.audio.listSources()` e é atualizada a cada
 *   5 s enquanto não há transmissão (durante a live, só pelo botão ↻), preservando
 *   volume e mute dos itens existentes.
 * - Web: só existe a fonte "áudio do sistema" (getDisplayMedia), já marcada por padrão.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AudioSource } from '@shared/index';
import { WEB_SYSTEM_AUDIO_ID } from '../services/broadcastAudio';

/** Intervalo da atualização automática da lista no modo desktop */
const AUTO_REFRESH_MS = 5000;

/** Plataforma do navegador, derivada de navigator.platform */
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
  const webDefaultAppliedRef = useRef(false);

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
          id: WEB_SYSTEM_AUDIO_ID,
          processId: 0,
          processName: 'system-audio',
          displayName: 'Áudio do Sistema (todos os apps)',
          volume: 1.0,
          isMuted: false,
          platform: detectBrowserPlatform(),
        };
        setSources((prev) => mergeSources(prev, [webSource]));
        // Antes de existir o botão de seleção na web, o áudio sempre ia junto: mantém o padrão
        if (!webDefaultAppliedRef.current) {
          webDefaultAppliedRef.current = true;
          setSelected(new Set([WEB_SYSTEM_AUDIO_ID]));
        }
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

  /** Alinha a seleção da interface ao que o mixer realmente roteia (após falha de sincronização) */
  const replaceSelection = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const same = prev.size === ids.length && ids.every((id) => prev.has(id));
      return same ? prev : new Set(ids);
    });
  }, []);

  /** Ajusta volume de uma fonte (0.0 - 1.0), refletido ao vivo no mixer. */
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
    replaceSelection,
    setVolume,
    toggleMute,
    refreshSources,
    setPaused,
  };
}
