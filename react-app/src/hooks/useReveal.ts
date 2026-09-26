import { useEffect, useRef, useState } from 'react';

/**
 * Reveal-on-scroll via Intersection Observer (zero dependencies).
 * Default: toggles BOTH ways — elements appear scrolling down and
 * gracefully leave scrolling up (rootMargin keeps them visible while read).
 * Pass once=true to animate a single time.
 * Respects prefers-reduced-motion (reveals instantly, CSS kills motion).
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>(
  threshold = 0.15,
  once = false
) {
  const ref = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (
      typeof IntersectionObserver === 'undefined' ||
      (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
    ) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setVisible(true);
            if (once) io.disconnect();
          } else if (!once) {
            setVisible(false);
          }
        });
      },
      { threshold, rootMargin: '-6% 0px -6% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold, once]);

  return { ref, visible };
}

/** Ease-out count-up. Runs ONCE when first activated. */
export function useCountUp(target: number, active: boolean, duration = 1400) {
  const [value, setValue] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (!active || done.current || Number.isNaN(target)) return;
    done.current = true;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);

  return value;
}
