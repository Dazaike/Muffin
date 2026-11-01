import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Info } from "lucide-react";
import { FavoriteButton } from "@/components/game/FavoriteButton";
import { PlayButton } from "@/components/game/PlayButton";
import { useOpenGame } from "@/components/game/useGameMenu";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Button } from "@/components/ui/Button";
import { SmartImage } from "@/components/ui/SmartImage";
import { toGameRef } from "@/lib/launch";
import { useMotionPrefs } from "@/lib/motion";
import { useGameDetails } from "@/lib/roblox";
import type { GameSummary } from "@/lib/types";

const ROTATE_MS = 8000;

/** Keeps a slide's details query warm so the crossfade never lands on a half-loaded slide. */
function WarmDetails({ game }: { game: GameSummary }) {
  useGameDetails(game.placeId, game);
  return null;
}

function Slide({ game }: { game: GameSummary }) {
  const m = useMotionPrefs();
  const open = useOpenGame();
  const { data: d } = useGameDetails(game.placeId, game);

  const iconUrl = d?.iconUrl ?? game.iconUrl;
  const heroUrl = d?.heroUrl ?? iconUrl;
  // Only a real thumbnail can fill the banner; a 256px icon is shown as a tile on the plain backdrop.
  const banner = !!heroUrl && heroUrl !== iconUrl;
  const players = d?.playerCount ?? game.playerCount;
  const creator = d?.creator || game.creator;
  const genre = d?.genre ?? game.genre;
  const full = { ...game, iconUrl, creator, genre };

  return (
    <div className="absolute inset-0">
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0, filter: m.full ? "blur(8px)" : "blur(0px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0 }}
        transition={{ duration: m.off ? 0 : m.full ? 0.7 : 0.2, ease: "easeOut" }}
      >
        {banner ? (
          <SmartImage src={heroUrl} name={game.name} className="absolute inset-0" />
        ) : (
          <>
            <div className="absolute inset-0 hidden items-center justify-end pr-[8%] min-[900px]:flex">
              <SmartImage
                src={iconUrl}
                name={game.name}
                className="size-56 rounded-[28px] shadow-2xl lg:size-64"
              />
            </div>
          </>
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/5" />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/55 via-transparent to-transparent" />
      </motion.div>

      <motion.div
        className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-3 p-6 pb-14 md:p-10 md:pb-16"
        initial={{ opacity: 0, y: m.full ? 14 : 0 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={m.off ? { duration: 0 } : { duration: 0.45, ease: [0.2, 0.8, 0.2, 1], delay: 0.1 }}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
          {genre && (
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium backdrop-blur-sm">{genre}</span>
          )}
          {creator && <span>by {creator}</span>}
        </div>
        <h2 className="max-w-3xl text-3xl leading-[1.05] font-semibold tracking-tight text-balance md:text-5xl">
          {game.name}
        </h2>
        {players !== undefined && (
          <div className="flex items-center gap-2 text-sm text-white/90">
            <span className="size-2 rounded-full bg-success" />
            <AnimatedNumber value={players} format={(n) => n.toLocaleString("en-US")} />
            <span>playing now</span>
          </div>
        )}
        <div className="pointer-events-auto mt-1 flex flex-wrap items-center gap-2.5">
          <PlayButton game={toGameRef(full)} size="lg" />
          <Button
            variant="glass"
            size="lg"
            className="rounded-full"
            icon={<Info size={18} strokeWidth={1.75} />}
            onClick={() => open({ ...full, description: d?.description || game.description })}
          >
            Details
          </Button>
          <FavoriteButton game={toGameRef(full)} withLabel className="h-12 px-5" />
        </div>
      </motion.div>
    </div>
  );
}

/**
 * Cinematic hero cycling through `games` every 8 s (paused while hovered or the window is hidden).
 * The incoming slide crossfades with an 8 px blur→0 on its art only.
 */
export function FeaturedHero({ games }: { games: GameSummary[] }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const [hidden, setHidden] = useState(() => document.hidden);
  const count = games.length;

  useEffect(() => {
    const onVis = () => setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Re-armed on every index change, so picking a dot restarts the 8 s countdown.
  useEffect(() => {
    if (count < 2 || hovered || hidden) return;
    const t = setTimeout(() => setIndex((i) => (i + 1) % count), ROTATE_MS);
    return () => clearTimeout(t);
  }, [index, count, hovered, hidden]);

  const active = games[index % count];
  if (!active) return null;
  const activeIndex = index % count;

  // Horizontal drag/swipe switches slide; a drag that starts on a control is left to that control.
  const onPointerDown = (e: React.PointerEvent) => {
    swiped.current = false;
    drag.current = (e.target as HTMLElement).closest("button,a") ? null : { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = drag.current;
    drag.current = null;
    if (!start || count < 2) return;
    const dx = e.clientX - start.x;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(e.clientY - start.y)) return;
    swiped.current = true;
    setIndex((i) => (i + (dx < 0 ? 1 : -1) + count) % count);
  };

  return (
    <section
      aria-label="Featured games"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false);
        drag.current = null;
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClickCapture={(e) => {
        // A swipe ends in a click on the slide; don't let it open the game.
        if (swiped.current) {
          e.stopPropagation();
          swiped.current = false;
        }
      }}
      className="surface relative isolate min-h-[400px] touch-pan-y overflow-hidden rounded-hero md:min-h-[460px]"
    >
      {games.map((g) => (
        <WarmDetails key={g.placeId} game={g} />
      ))}
      <AnimatePresence initial={false}>
        <Slide key={active.placeId} game={active} />
      </AnimatePresence>

      {count > 1 && (
        <div className="absolute bottom-5 left-6 z-10 flex items-center gap-1.5 md:left-10" role="tablist" aria-label="Featured game">
          {games.map((g, i) => (
            <button
              key={g.placeId}
              type="button"
              role="tab"
              aria-selected={i === activeIndex}
              aria-label={`Show ${g.name}`}
              onClick={() => setIndex(i)}
              className="focus-ring relative h-2 w-6 cursor-pointer rounded-full bg-white/25"
            >
              {i === activeIndex && (
                <motion.span layoutId="hero-dot" className="absolute inset-0 rounded-full bg-white" />
              )}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
