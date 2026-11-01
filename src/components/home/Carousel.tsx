import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMotionPrefs } from "@/lib/motion";

/** Fixed-width slot inside a Carousel. */
export function CarouselItem({ width, children }: { width: string; children: ReactNode }) {
  return (
    <div className="shrink-0 snap-start" style={{ width }}>
      {children}
    </div>
  );
}

/** Horizontal scroll-snap strip with prev/next arrows that appear only when there is more to scroll. */
export function Carousel({ children, label }: { children: ReactNode; label: string }) {
  const m = useMotionPrefs();
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ prev: false, next: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const prev = el.scrollLeft > 4;
    const next = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setEdge((p) => (p.prev === prev && p.next === next ? p : { prev, next }));
  }, []);

  // Content may change between renders; the setter bails out when nothing changed.
  useLayoutEffect(update);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update]);

  const scroll = (dir: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.85), behavior: m.off ? "auto" : "smooth" });
  };

  const arrow = (dir: -1 | 1, visible: boolean) => (
    <AnimatePresence>
      {visible && (
        <motion.button
          key={dir}
          type="button"
          aria-label={dir < 0 ? `Scroll ${label} left` : `Scroll ${label} right`}
          onClick={() => scroll(dir)}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          transition={m.fast}
          whileTap={{ scale: 0.92 }}
          className={`glass focus-ring absolute top-[calc(50%-31px)] z-20 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-white ${
            dir < 0 ? "-left-3" : "-right-3"
          }`}
        >
          {dir < 0 ? <ChevronLeft size={20} strokeWidth={1.75} /> : <ChevronRight size={20} strokeWidth={1.75} />}
        </motion.button>
      )}
    </AnimatePresence>
  );

  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={update}
        role="list"
        aria-label={label}
        className="no-scrollbar -mx-1 -mt-3 -mb-16 flex snap-x snap-mandatory gap-[var(--card-gap)] overflow-x-auto px-1 pt-3 pb-16"
      >
        {children}
      </div>
      {arrow(-1, edge.prev)}
      {arrow(1, edge.next)}
    </div>
  );
}
