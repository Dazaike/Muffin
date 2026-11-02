import { useEffect, useRef, useState } from "react";

/** Runs `fn` when the browser is idle (or soon after, where `requestIdleCallback` is missing). */
function whenIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn, { timeout: 200 });
    return () => cancelIdleCallback(id);
  }
  const id = window.setTimeout(fn, 32);
  return () => window.clearTimeout(id);
}

/**
 * How many of `total` items to mount right now. Starts at `first` so a page paints at once, then adds
 * `step` more each time the browser is idle, instead of mounting every card in one long frame.
 */
export function useProgressiveCount(total: number, first = 5, step = 4): number {
  const [count, setCount] = useState(first);
  useEffect(() => {
    if (count >= total) return;
    return whenIdle(() => setCount((c) => Math.min(total, c + step)));
  }, [count, total, step]);
  return Math.min(count, total);
}

/** True once the element has come within `margin` px of the viewport (and stays true). */
export function useNearViewport<T extends Element>(margin = 600, disabled = false): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(disabled);
  useEffect(() => {
    if (near) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: `${margin}px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near];
}
