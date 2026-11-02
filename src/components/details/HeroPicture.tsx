import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SmartImage } from "@/components/ui/SmartImage";
import { HERO_VT_NAME } from "@/lib/gameTransition";
import { useMotionPrefs } from "@/lib/motion";
import type { GameDetails } from "@/lib/types";

/**
 * The game's big picture: cycles through its screenshots with a crossfade, pauses on hover, and can be
 * dragged or swiped. It is also the target a game card's picture morphs into (see lib/gameTransition.ts).
 */
export function HeroPicture({ game }: { game: GameDetails }) {
  const m = useMotionPrefs();
  const main = game.heroUrl ?? game.iconUrl;
  const images = useMemo(() => [...new Set([main, ...game.screenshots].filter((u): u is string => !!u))], [main, game.screenshots]);
  const [shown, setShown] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = Math.max(images.length, 1);
  const current = ((shown % n) + n) % n;
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Warm the cache so the next picture is ready when it crossfades in.
  useEffect(() => {
    for (const u of images) new Image().src = u;
  }, [images]);

  useEffect(() => {
    if (images.length < 2 || paused || !m.full) return;
    const t = setInterval(() => {
      if (!document.hidden) setShown((i) => i + 1);
    }, 6000);
    return () => clearInterval(t);
  }, [images.length, paused, m.full]);

  // A drag that starts on a control is left to that control.
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = (e.target as HTMLElement).closest("button,a,input") ? null : { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = drag.current;
    drag.current = null;
    if (!start || images.length < 2) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(e.clientY - start.y)) return;
    setShown(current + (dx < 0 ? 1 : -1));
  };

  return (
    <div
      data-vt-target=""
      style={{ viewTransitionName: HERO_VT_NAME }}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => {
        setPaused(false);
        drag.current = null;
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className="relative isolate aspect-video w-full touch-pan-y overflow-hidden rounded-hero ring-1 ring-white/10"
    >
      {/* Pictures crossfade with a slow settle; every layer is absolute so they overlap instead of jumping. */}
      <AnimatePresence initial={false}>
        <motion.div
          key={images[current] ?? "none"}
          className="absolute inset-0"
          initial={{ opacity: 0, scale: m.full ? 1.05 : 1 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={m.full ? { duration: 0.8, ease: [0.22, 1, 0.36, 1] } : m.fast}
        >
          <SmartImage src={images[current]} name={game.name} fade={false} className="absolute inset-0" />
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-black/60 to-transparent" />

      {images.length > 1 && (
        <div className="absolute right-5 bottom-4 z-10 flex gap-1.5" role="tablist" aria-label="Game pictures">
          {images.map((u, i) => (
            <button
              key={u}
              type="button"
              role="tab"
              aria-selected={i === current}
              aria-label={`Show picture ${i + 1}`}
              onClick={() => setShown(i)}
              className="focus-ring h-2 w-5 cursor-pointer rounded-full bg-white/30 aria-selected:bg-white"
            />
          ))}
        </div>
      )}
    </div>
  );
}
