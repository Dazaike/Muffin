import { useEffect, useRef } from "react";

/** Invisible marker that calls `onVisible` each time it scrolls within 600 px of the viewport. */
export function InfiniteSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onVisible(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [onVisible]);
  return <div ref={ref} aria-hidden className="h-px" />;
}
