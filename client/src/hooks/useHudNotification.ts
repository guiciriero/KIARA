import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Hook reutilizável para exibição de avisos HUD (Head-Up Display) temporários
 * com timeout configurável e limpeza automática ao desmontar.
 */
export function useHudNotification(timeoutMs = 1800) {
  const [hudMessage, setHudMessage] = useState<string | null>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showHud = useCallback(
    (message: string) => {
      setHudMessage(message);
      if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
      hudTimerRef.current = setTimeout(() => {
        setHudMessage(null);
      }, timeoutMs);
    },
    [timeoutMs],
  );

  useEffect(() => () => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
  }, []);

  return { hudMessage, showHud };
}
