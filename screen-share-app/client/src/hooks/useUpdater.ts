import { useCallback, useEffect, useState } from 'react';
import type { UpdateState } from '@shared/index';

export interface UseUpdater {
  /** null enquanto o estado inicial não chegou do app desktop */
  state: UpdateState | null;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  /** false no navegador (sem app desktop) */
  supported: boolean;
}

function errorState(prev: UpdateState | null, err: unknown): UpdateState {
  const message = err instanceof Error && err.message ? err.message : 'Falha ao falar com o aplicativo.';
  return { status: 'error', currentVersion: prev?.currentVersion ?? '', message };
}

/** Acompanha a atualização do app desktop via `window.screenShareHost.updater`. */
export function useUpdater(): UseUpdater {
  const updater =
    typeof window !== 'undefined' ? window.screenShareHost?.updater : undefined;
  const supported = updater !== undefined;
  const [state, setState] = useState<UpdateState | null>(null);

  useEffect(() => {
    if (!updater) return undefined;
    let active = true;
    const unsubscribe = updater.onState((next) => {
      if (active) setState(next);
    });
    updater
      .getState()
      .then((initial) => {
        // Evento push que chegou antes da resposta é mais novo: não sobrescreve.
        if (active) setState((prev) => prev ?? initial);
      })
      .catch((err: unknown) => {
        if (active) setState((prev) => errorState(prev, err));
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [updater]);

  const run = useCallback(
    async (action: 'check' | 'download' | 'install') => {
      if (!updater) return;
      try {
        const next = await updater[action]();
        setState(next);
      } catch (err) {
        setState((prev) => errorState(prev, err));
      }
    },
    [updater],
  );

  const check = useCallback(() => run('check'), [run]);
  const download = useCallback(() => run('download'), [run]);
  const install = useCallback(() => run('install'), [run]);

  return { state, check, download, install, supported };
}
