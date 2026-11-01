import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BadgeCheck, Copy, ExternalLink } from "lucide-react";
import { FavoriteButton } from "@/components/game/FavoriteButton";
import { PlayButton } from "@/components/game/PlayButton";
import { Button } from "@/components/ui/Button";
import { SmartImage } from "@/components/ui/SmartImage";
import { formatDuration } from "@/lib/format";
import { copyText, gamePageUrl, openLink } from "./links";
import { useMotionPrefs } from "@/lib/motion";
import { usePlayedMs } from "@/lib/playtime";
import type { GameDetails, GameRef } from "@/lib/types";
import { CREATOR_SECTION_ID } from "./CreatorSection";
import { VoteButtons } from "./VoteButtons";

export interface DetailsHeroProps {
  game: GameDetails;
  gameRef: GameRef;
  loading: boolean;
  onBack: () => void;
}

/** Full-width banner showing the game's pictures. */
export function DetailsHero({ game, gameRef, loading, onBack }: DetailsHeroProps) {
  const m = useMotionPrefs();
  const playedMs = usePlayedMs(game.placeId);
  const main = game.heroUrl ?? game.iconUrl;
  const images = useMemo(() => [...new Set([main, ...game.screenshots].filter((u): u is string => !!u))], [main, game.screenshots]);
  const [shown, setShown] = useState(0);
  const [paused, setPaused] = useState(false);
  const n = Math.max(images.length, 1);
  const current = ((shown % n) + n) % n;
  const drag = useRef<{ x: number; y: number } | null>(null);

  // Cycle every game picture behind the text; pause while hovered or the window is hidden.
  useEffect(() => {
    if (images.length < 2 || paused || !m.full) return;
    const t = setInterval(() => {
      if (!document.hidden) setShown((i) => i + 1);
    }, 6000);
    return () => clearInterval(t);
  }, [images.length, paused, m.full]);

  // Drag or swipe horizontally to change picture; a drag that starts on a control is left to that control.
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
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => {
        setPaused(false);
        drag.current = null;
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      className="relative isolate aspect-video max-h-[calc(100vh-160px)] min-h-[420px] w-full touch-pan-y overflow-hidden rounded-hero"
    >
      <SmartImage src={images[current]} name={game.name} fade={false} className="absolute inset-0" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />

      {images.length > 1 && (
        <div className="absolute right-5 bottom-5 z-10 flex gap-1.5" role="tablist" aria-label="Game pictures">
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
      <div className="absolute top-4 left-4 z-10">
        <Button variant="glass" size="sm" icon={<ArrowLeft size={16} strokeWidth={1.75} />} onClick={onBack}>
          Back
        </Button>
      </div>

      <div className="absolute inset-x-0 bottom-0 flex items-end gap-5 p-6 md:p-10">
        <div className="hidden shrink-0 sm:block">
          <SmartImage
            fade={false}
            src={game.iconUrl}
            name={game.name}
            className="size-24 rounded-[22px] shadow-[0_12px_32px_-8px_#000c] md:size-28"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-white/80">
            {game.creator ? (
              <button
                type="button"
                onClick={() => document.getElementById(CREATOR_SECTION_ID)?.scrollIntoView({ block: "center" })}
                className="focus-ring inline-flex cursor-pointer items-center gap-1 rounded hover:underline"
              >
                by {game.creator}
                {game.creatorVerified && <BadgeCheck size={15} strokeWidth={2} aria-label="Verified" />}
              </button>
            ) : loading ? (
              <span className="skeleton h-4 w-24 rounded" />
            ) : null}
            {game.creatorType && (
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white">
                {game.creatorType === "Group" ? "Group" : "User"}
              </span>
            )}
            {game.genre && (
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white">{game.genre}</span>
            )}
            {playedMs !== undefined && playedMs > 0 && (
              <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white">
                You played {formatDuration(playedMs)}
              </span>
            )}
          </div>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight md:text-5xl">
            {game.name}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <PlayButton game={gameRef} size="lg" />
            <FavoriteButton game={gameRef} withLabel />
            {!loading && game.universeId > 0 && <VoteButtons game={game} />}
            <Button
              variant="glass"
              size="md"
              icon={<Copy size={15} strokeWidth={1.75} />}
              onClick={() => void copyText(gamePageUrl(gameRef.placeId), "Link copied")}
            >
              Copy link
            </Button>
            <Button
              variant="glass"
              size="md"
              icon={<ExternalLink size={15} strokeWidth={1.75} />}
              onClick={() => openLink(gamePageUrl(gameRef.placeId))}
            >
              Open on roblox.com
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
