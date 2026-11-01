import type { ReactNode } from "react";
import { Ellipsis } from "lucide-react";
import { GameCard } from "@/components/game/GameCard";
import { useGameMenu } from "@/components/game/useGameMenu";
import { Menu } from "@/components/ui/Menu";
import type { CardGame } from "@/lib/types";

/** "⋯" button opening the same actions as the card's right-click menu. */
export function GameRowMenu({ game }: { game: CardGame }) {
  const entries = useGameMenu(game);
  return (
    <Menu
      entries={entries}
      trigger={(props) => (
        <button
          type="button"
          {...props}
          aria-label={`More actions for ${game.name}`}
          className="focus-ring flex size-9 cursor-pointer items-center justify-center rounded-full text-muted transition-colors hover:bg-white/8 hover:text-fg"
        >
          <Ellipsis size={18} strokeWidth={1.75} />
        </button>
      )}
    />
  );
}

/**
 * Compact row: optional leading slot (drag grip), the row card, and the actions menu.
 * Render it inside a container with `relative focus-within:z-20` so the open menu paints above later rows.
 */
export function GameRowContent({
  game,
  index,
  subtitle,
  trailing,
  leading,
  highlighted,
}: {
  game: CardGame;
  index?: number;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  leading?: ReactNode;
  highlighted?: boolean;
}) {
  return (
    <>
      {leading}
      <GameCard
        game={game}
        variant="row"
        index={index}
        subtitle={subtitle}
        trailing={trailing}
        highlighted={highlighted}
        className="min-w-0 flex-1"
      />
      <GameRowMenu game={game} />
    </>
  );
}

export const ROW_CLASS = "relative flex items-center gap-2 focus-within:z-20";
