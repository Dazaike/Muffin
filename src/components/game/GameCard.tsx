import { useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { ThumbsUp } from "lucide-react";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { ContextMenu } from "@/components/ui/Menu";
import { SmartImage } from "@/components/ui/SmartImage";
import { cn } from "@/lib/cn";
import { percent } from "@/lib/format";
import { useMotionPrefs } from "@/lib/motion";
import { useCardGame } from "@/lib/roblox";
import type { CardGame } from "@/lib/types";
import { useSettings } from "@/store/settings";
import { FavoriteButton } from "./FavoriteButton";
import { PlayButton } from "./PlayButton";
import { useGameMenu, useOpenGame } from "./useGameMenu";

export type CardVariant = "hero" | "poster" | "wide" | "row";

/** The `wide` card is a fixed-height tile (square 96px icon on the left, text on the right). */
export const WIDE_CARD_HEIGHT = 96;

/** Row height in px for a VirtualGrid of cards of this variant at a given column width. */
export function cardRowHeight(variant: Exclude<CardVariant, "hero">, columnWidth: number): number {
  switch (variant) {
    case "poster":
      return Math.round(columnWidth * (useSettings.getState().values.cardShape === "square" ? 1 : 4 / 3)) + 62;
    case "wide":
      return WIDE_CARD_HEIGHT;
    case "row":
      return 84;
  }
}

export interface GameCardProps {
  game: CardGame;
  variant: CardVariant;
  /** Position in a list, for staggered entrance. */
  index?: number;
  /** Large banner art for `hero` (falls back to the icon). */
  heroUrl?: string;
  /** Keyboard-highlight ring (search results). */
  highlighted?: boolean;
  /** Override what clicking the card does (default: open details). */
  onOpen?: () => void;
  /** Extra trailing content for `row` (e.g. "launched 5 min ago"). */
  trailing?: ReactNode;
  /** Secondary line override (default: genre). */
  subtitle?: ReactNode;
  /** Render without the entrance / exit / hover-lift motion (for pages that must stay static). */
  plain?: boolean;
  className?: string;
}

function Players({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-1.5 rounded-full bg-success" />
      <AnimatedNumber value={n} />
      <span>playing</span>
    </span>
  );
}

/**
 * Game card in four compositions: hero (cinematic), poster (portrait), wide (16:9), row (compact).
 * Click/Enter opens details, right-click opens the context menu.
 */
export function GameCard({
  game: gameProp,
  variant,
  index = 0,
  heroUrl,
  highlighted,
  onOpen,
  trailing,
  subtitle,
  plain,
  className,
}: GameCardProps) {
  const m = useMotionPrefs();
  // Games saved without a picture (older launches) get theirs looked up, wherever the card is shown.
  const game = useCardGame(gameProp);
  const square = useSettings((s) => s.values.cardShape) === "square";
  const open = useOpenGame();
  const menu = useGameMenu(game);
  // The card's first picture is what morphs into the details hero.
  const handleOpen = (root?: HTMLElement) =>
    onOpen ? onOpen() : open(game, root?.querySelector("img")?.parentElement);
  const rating = game.upVotes !== undefined && game.downVotes !== undefined ? percent(game.upVotes, game.downVotes) : null;
  const sub = subtitle ?? game.genre;
  // The hover Play pill is built on first hover; mounting one per card up front made big pages hitch.
  const [armed, setArmed] = useState(false);
  // Only the first few cards animate in; entrance animation on dozens of cards at once is what stalls a page.
  const still = plain || index >= 8;

  const common = {
    role: "link" as const,
    tabIndex: 0,
    "aria-label": game.name,
    // Lets the details page's Back button find this card to morph the hero back into it.
    "data-game-card": game.placeId,
    onClick: (e: React.MouseEvent) => handleOpen(e.currentTarget as HTMLElement),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter") {
        e.preventDefault();
        handleOpen(e.currentTarget as HTMLElement);
      }
    },
    initial: still ? (false as const) : { opacity: 0, y: 12 },
    animate: still ? undefined : { opacity: 1, y: 0 },
    exit: still ? undefined : { opacity: 0, scale: 0.9 },
  };

  let body: ReactNode;
  let cardClass: string;

  if (variant === "hero") {
    cardClass = "relative isolate overflow-hidden rounded-hero min-h-[340px] md:min-h-[420px]";
    body = (
      <>
        <SmartImage src={heroUrl ?? game.iconUrl} name={game.name} className="absolute inset-0" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent" />
        <div className="relative flex h-full min-h-[inherit] flex-col justify-end gap-3 p-6 md:p-10">
          <div className="text-sm text-white/75">{[game.creator, game.genre].filter(Boolean).join(" · ")}</div>
          <h3 className="max-w-3xl text-3xl font-semibold tracking-tight md:text-5xl">{game.name}</h3>
          <div className="flex items-center gap-4 text-sm text-white/85">
            {game.playerCount !== undefined && <Players n={game.playerCount} />}
            {rating !== null && <span>{rating}% liked</span>}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <PlayButton game={game} size="lg" />
            <FavoriteButton game={game} withLabel />
          </div>
        </div>
      </>
    );
  } else if (variant === "row") {
    cardClass = "surface group flex items-center gap-4 rounded-card p-2.5 pr-4";
    body = (
      <>
        <SmartImage src={game.iconUrl} name={game.name} className="size-[60px] shrink-0 rounded-[12px]" />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{game.name}</div>
          {game.description ? (
            <p className="line-clamp-2 text-xs leading-snug text-muted">{game.description}</p>
          ) : (
            sub && <div className="truncate text-xs text-muted">{sub}</div>
          )}
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-0.5 text-xs text-muted sm:flex">
          {game.playerCount !== undefined && <Players n={game.playerCount} />}
          {game.description && sub && <span className="max-w-32 truncate">{sub}</span>}
          {trailing}
        </div>
        <PlayButton game={game} size="icon" />
      </>
    );
  } else {
    const wide = variant === "wide";
    cardClass = cn("surface group relative flex rounded-card transition-shadow duration-300 hover:z-20 hover:shadow-[0_28px_56px_-10px_rgba(0,0,0,0.9)] focus-within:z-20", wide ? "flex-row items-stretch" : "flex-col");
    body = (
      <>
        <div className={cn("relative shrink-0 overflow-hidden", wide ? "aspect-square w-24 rounded-l-card" : cn("w-full rounded-t-card", square ? "aspect-square" : "aspect-[3/4]"))}>
          <SmartImage src={game.iconUrl} name={game.name} className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-110 group-focus-within:scale-110" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
          <div className="absolute top-2 right-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <FavoriteButton game={game} size={16} />
          </div>
          {/* No panel behind it: the Play pill just rises into the bottom of the picture on hover. */}
          <div className="pointer-events-none absolute inset-x-2.5 bottom-2.5 z-10 translate-y-2 opacity-0 transition-[opacity,translate] duration-200 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100">
            {armed && <PlayButton game={game} size="sm" className="w-full" />}
          </div>
        </div>
        <div className={cn("flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2", !wide && "min-h-[62px]")}>
          <div className="truncate text-sm font-medium">{game.name}</div>
          <div className="flex items-center gap-3 truncate text-xs text-muted">
            {game.playerCount !== undefined ? <Players n={game.playerCount} /> : sub && <span className="truncate">{sub}</span>}
            {rating !== null && (
              <span className="inline-flex items-center gap-1">
                <ThumbsUp size={12} strokeWidth={1.75} />
                {rating}%
              </span>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <ContextMenu entries={menu}>
      <motion.div
        {...common}
        transition={still ? { duration: 0 } : { ...m.spring, ...m.stagger(index) }}
        onPointerEnter={() => setArmed(true)}
        onFocus={() => setArmed(true)}
        whileHover={m.full && !plain && variant !== "hero" ? { y: -10, scale: 1.08 } : undefined}
        className={cn(
          "focus-ring relative cursor-pointer outline-none",
          cardClass,
          highlighted && "outline-2 outline-offset-2 outline-accent",
          className,
        )}
      >
        {body}
      </motion.div>
    </ContextMenu>
  );
}
