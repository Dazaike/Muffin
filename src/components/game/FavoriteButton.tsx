import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/cn";
import { toGameRef } from "@/lib/launch";
import { useMotionPrefs } from "@/lib/motion";
import type { GameRef } from "@/lib/types";
import { useLibrary } from "@/store/library";

const BURST = Array.from({ length: 6 }, (_, i) => (i / 6) * Math.PI * 2);

export interface FavoriteButtonProps {
  game: GameRef;
  size?: number;
  /** Show a text label ("Save"/"Saved") next to the heart. */
  withLabel?: boolean;
  /** A square glass tile like the other action buttons on the details page. */
  tile?: boolean;
  className?: string;
}

/** Heart toggle bound to the library store, with a burst on favorite. */
export function FavoriteButton({ game, size = 18, withLabel, tile, className }: FavoriteButtonProps) {
  const m = useMotionPrefs();
  const favorite = useLibrary((s) => s.entries.some((e) => e.placeId === game.placeId && e.favorite));
  const toggle = useLibrary((s) => s.toggleFavorite);
  const [burst, setBurst] = useState(0);

  return (
    <motion.button
      type="button"
      aria-pressed={favorite}
      aria-label={favorite ? `Remove ${game.name} from favorites` : `Add ${game.name} to favorites`}
      whileTap={{ scale: 0.88 }}
      onClick={(e) => {
        e.stopPropagation();
        if (!favorite && m.full) setBurst((b) => b + 1);
        void toggle(toGameRef(game));
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "focus-ring relative inline-flex cursor-pointer items-center justify-center gap-2 transition-colors",
        withLabel
          ? "glass h-10 rounded-full px-4 text-sm font-medium"
          : tile
            ? "glass size-13 rounded-[14px]"
            : "size-9 rounded-full bg-black/45 hover:bg-black/65",
        favorite ? "text-rose-400" : "text-white/85 hover:text-white",
        className,
      )}
    >
      <AnimatePresence>
        {burst > 0 &&
          BURST.map((a) => (
            <motion.span
              key={`${burst}-${a}`}
              aria-hidden
              initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
              animate={{ opacity: 0, x: Math.cos(a) * 18, y: Math.sin(a) * 18, scale: 0.4 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="pointer-events-none absolute size-1.5 rounded-full bg-rose-400"
            />
          ))}
      </AnimatePresence>
      <motion.span animate={favorite && m.full ? { scale: [1, 1.35, 1] } : { scale: 1 }} transition={{ duration: 0.3 }} className="flex">
        <Heart size={size} strokeWidth={1.75} fill={favorite ? "currentColor" : "none"} />
      </motion.span>
      {withLabel && <span>{favorite ? "Saved" : "Save"}</span>}
    </motion.button>
  );
}
