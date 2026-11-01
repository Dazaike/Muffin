import { useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { GameCard } from "@/components/game/GameCard";
import { useRecommendedGames } from "@/lib/roblox";

/**
 * "Recommended / more like this": Roblox's own list as a plain horizontal strip of cards, below the tabs. Roblox
 * returns nothing to guests, so the section is simply absent without a session, on failure, or when empty.
 */
export function RecommendedStrip({ universeId }: { universeId: number | null }) {
  const query = useRecommendedGames(universeId);
  const ref = useRef<HTMLDivElement>(null);
  const games = query.data ?? [];
  if (games.length === 0) return null;

  const scroll = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.85) });
  };

  return (
    <section aria-label="Recommended games">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">More like this</h2>
        <div className="flex gap-1.5">
          <button
            type="button"
            aria-label="Scroll recommended games left"
            onClick={() => scroll(-1)}
            className="focus-ring glass flex size-8 cursor-pointer items-center justify-center rounded-full"
          >
            <ChevronLeft size={18} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Scroll recommended games right"
            onClick={() => scroll(1)}
            className="focus-ring glass flex size-8 cursor-pointer items-center justify-center rounded-full"
          >
            <ChevronRight size={18} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div
        ref={ref}
        role="list"
        className="no-scrollbar -mx-1 -mt-3 -mb-16 flex snap-x snap-mandatory gap-[var(--card-gap)] overflow-x-auto px-1 pt-3 pb-16"
      >
        {games.map((g) => (
          <div key={g.placeId} role="listitem" className="w-[168px] shrink-0 snap-start">
            <GameCard game={g} variant="poster" plain />
          </div>
        ))}
      </div>
    </section>
  );
}
