import { AnimatePresence, motion } from "motion/react";
import { cardRowHeight, GameCard, WIDE_CARD_HEIGHT } from "@/components/game/GameCard";
import { VirtualGrid } from "@/components/ui/VirtualGrid";
import { useMotionPrefs } from "@/lib/motion";
import { useSettings } from "@/store/settings";
import type { CardGame } from "@/lib/types";
import { GameRowContent, ROW_CLASS } from "./GameRow";
import { useGridMetrics } from "./useGridMetrics";
import type { ViewMode } from "./ViewToggle";

const ROW_H = 84;
const ROW_GAP = 8;
/** Larger than any viewport so VirtualGrid always lays rows out in a single column. */
const SINGLE_COLUMN = 10_000;

/** Above this many items the grid is row-virtualized (no per-card exit/layout animation). */
export const VIRTUALIZE_AT = 60;

export interface GameGridProps<T extends CardGame> {
  items: T[];
  /** Always virtualize, regardless of item count (Discover). */
  alwaysVirtual?: boolean;
  /** `grid` (default) = cards; `list` = compact rows with the actions menu. */
  view?: ViewMode;
  /** Card style in `grid` view: `vertical` = poster cards, `horizontal` = wide icon-left tiles. */
  cards?: "vertical" | "horizontal";
}

/**
 * Poster-card grid (or compact row list). Small sets render as plain CSS with exit + layout animations (items
 * glide when the order changes and shrink out when removed); large sets use the row-virtualized VirtualGrid.
 */
export function GameGrid<T extends CardGame>({ items, alwaysVirtual, view = "grid", cards = "vertical" }: GameGridProps<T>) {
  const m = useMotionPrefs();
  // Re-render on change so VirtualGrid recomputes row heights (cardRowHeight reads the setting).
  useSettings((s) => s.values.cardShape);
  const { minWidth, gap } = useGridMetrics(cards);
  const variant = cards === "horizontal" ? "wide" : "poster";

  if (view === "list") {
    if (alwaysVirtual || items.length > VIRTUALIZE_AT) {
      return (
        <VirtualGrid
          items={items}
          minItemWidth={SINGLE_COLUMN}
          rowHeight={ROW_H}
          gap={ROW_GAP}
          getKey={(g) => g.placeId}
          renderItem={(g, i) => (
            <div className={`${ROW_CLASS} h-full`}>
              <GameRowContent game={g} index={i % 8} />
            </div>
          )}
        />
      );
    }
    return (
      <div className="relative flex flex-col" style={{ gap: ROW_GAP }}>
        <AnimatePresence mode="popLayout">
          {items.map((g, i) => (
            <motion.div key={g.placeId} layout transition={m.spring} exit={{ opacity: 0, scale: 0.96 }} className={ROW_CLASS}>
              <GameRowContent game={g} index={i} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    );
  }
  if (alwaysVirtual || items.length > VIRTUALIZE_AT) {
    return (
      <VirtualGrid
        items={items}
        minItemWidth={minWidth}
        gap={gap}
        rowHeight={(w) => cardRowHeight(variant, w)}
        getKey={(g) => g.placeId}
        renderItem={(g, i) => <GameCard game={g} variant={variant} index={i % 6} />}
      />
    );
  }

  return (
    <div className="relative grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap }}>
      <AnimatePresence mode="popLayout">
        {items.map((g, i) => (
          <motion.div
            key={g.placeId}
            layout
            transition={m.spring}
            exit={{ opacity: 0, scale: 0.9 }}
            style={{ minWidth: 0 }}
          >
            <GameCard game={g} variant={variant} index={i} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Placeholder card grid shown while loading. */
export function GridSkeleton({ count = 12, cards = "vertical" }: { count?: number; cards?: "vertical" | "horizontal" }) {
  const { minWidth, gap } = useGridMetrics(cards);
  const square = useSettings((s) => s.values.cardShape) === "square";
  if (cards === "horizontal") {
    return (
      <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap }}>
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="skeleton w-full rounded-card" style={{ height: WIDE_CARD_HEIGHT }} aria-hidden />
        ))}
      </div>
    );
  }
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))`, gap }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className={`skeleton ${square ? "aspect-square" : "aspect-[3/4]"} w-full rounded-card`} aria-hidden />
          <div className="skeleton h-4 w-3/4 rounded-md" aria-hidden />
        </div>
      ))}
    </div>
  );
}

/** Placeholder compact rows shown while loading. */
export function RowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton h-[84px] w-full rounded-card" aria-hidden />
      ))}
    </div>
  );
}
