import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Hook reutilizável para copiar texto para a área de transferência com fallback
 * e estado temporário de feedback visual.
 */
export function useCopyToClipboard(timeoutMs = 2200) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      let success: boolean;
      try {
        await navigator.clipboard.writeText(text);
        success = true;
      } catch {
        try {
          const el = document.createElement('textarea');
          el.value = text;
          el.setAttribute('readonly', '');
          el.style.position = 'absolute';
          el.style.left = '-9999px';
          document.body.appendChild(el);
          el.select();
          success = document.execCommand('copy');
          document.body.removeChild(el);
        } catch {
          success = false;
        }
      }

      if (success) {
        setCopied(true);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), timeoutMs);
      }
      return success;
    },
    [timeoutMs],
  );

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { copied, copy };
}
