import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Heart, HeartOff, Info, Pin, PinOff, Play, Plus, Trash2 } from "lucide-react";
import type { MenuEntry } from "@/components/ui/Menu";
import { toGameRef } from "@/lib/launch";
import { gamePath, type GameRouteState } from "@/lib/links";
import type { CardGame } from "@/lib/types";
import { useLaunch } from "@/store/launch";
import { useLibrary } from "@/store/library";

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/** Opens a game's details page, seeding the route so the page paints instantly. */
export function useOpenGame(): (game: CardGame) => void {
  const navigate = useNavigate();
  return useCallback(
    (game: CardGame) => navigate(gamePath(game.placeId), { state: { seed: game } satisfies GameRouteState }),
    [navigate],
  );
}

/**
 * Context-menu entries for a game: Play, Details, Favorite/Unfavorite, Pin to Quick Launch,
 * Add to Library, Remove. Returns a builder to pass straight to <ContextMenu entries=…/>.
 */
export function useGameMenu(game: CardGame): () => MenuEntry[] {
  const open = useOpenGame();
  return useCallback(() => {
    const lib = useLibrary.getState();
    const entry = lib.entries.find((e) => e.placeId === game.placeId);
    const ref = toGameRef(game);
    const busy = useLaunch.getState().state.phase !== "idle";
    const items: MenuEntry[] = [
      {
        label: "Play",
        icon: <Play {...ICON} />,
        disabled: busy,
        onSelect: () => void useLaunch.getState().launch(ref),
      },
      { label: "Details", icon: <Info {...ICON} />, onSelect: () => open(game) },
      { type: "separator" },
      entry?.favorite
        ? { label: "Unfavorite", icon: <HeartOff {...ICON} />, onSelect: () => void lib.toggleFavorite(ref) }
        : { label: "Favorite", icon: <Heart {...ICON} />, onSelect: () => void lib.toggleFavorite(ref) },
      entry?.pinned
        ? { label: "Unpin from Quick Launch", icon: <PinOff {...ICON} />, onSelect: () => void lib.togglePin(ref) }
        : { label: "Pin to Quick Launch", icon: <Pin {...ICON} />, onSelect: () => void lib.togglePin(ref) },
    ];
    if (entry) {
      items.push(
        { type: "separator" },
        { label: "Remove from Library", icon: <Trash2 {...ICON} />, danger: true, onSelect: () => void lib.removeFromLibrary(game.placeId) },
      );
    } else {
      items.push({ label: "Add to Library", icon: <Plus {...ICON} />, onSelect: () => void lib.addToLibrary(ref) });
    }
    return items;
  }, [game, open]);
}
