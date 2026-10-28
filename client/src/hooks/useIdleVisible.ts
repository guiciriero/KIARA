import { useEffect, useState, type RefObject } from 'react';

/**
 * Controles que somem após `delay` ms sem o mouse se mexer sobre o elemento.
 * Mouse, toque e teclado trazem os controles de volta; foco dentro da barra
 * (elemento com `data-idle-keep`) a mantém visível.
 */
export function useIdleVisible(
  targetRef: RefObject<HTMLElement | null>,
  active: boolean,
  delay = 3000,
): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = targetRef.current;
    if (!active || !el) {
      setVisible(true);
      return undefined;
    }
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!document.activeElement?.closest('[data-idle-keep]')) setVisible(false);
      }, delay);
    };
    const wake = () => {
      setVisible(true);
      arm();
    };
    arm();
    el.addEventListener('pointermove', wake);
    el.addEventListener('pointerdown', wake);
    el.addEventListener('keydown', wake);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('pointermove', wake);
      el.removeEventListener('pointerdown', wake);
      el.removeEventListener('keydown', wake);
    };
  }, [targetRef, active, delay]);

  return visible;
}
