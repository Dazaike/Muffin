import type { ContinueGame } from "./dataTypes";
import type { CardGame, HistoryEntry } from "./types";

/** Newest local launches shown before Roblox-only games. */
export const LOCAL_CONTINUE_LIMIT = 10;
/** Total cap of the merged row. */
export const CONTINUE_LIMIT = 24;

export interface ContinueItem {
  game: CardGame;
  /** Set for Muffin launches only: Roblox's list carries no timestamps, so none is invented. */
  lastLaunchedAt?: number;
  /** True for games that came only from the Roblox Continue row. */
  onRoblox: boolean;
}

/**
 * Muffin's own history first (newest first, as given), then the games from Roblox's Continue row
 * that Muffin doesn't already show, in Roblox's order. A game counts as already shown when its
 * place id OR universe id matches.
 */
export function mergeContinue(history: readonly HistoryEntry[], roblox: readonly ContinueGame[] | undefined): ContinueItem[] {
  const local = history.slice(0, LOCAL_CONTINUE_LIMIT);
  const items: ContinueItem[] = local.map((h) => ({ game: h, lastLaunchedAt: h.lastLaunchedAt, onRoblox: false }));
  if (!roblox?.length) return items;

  const places = new Set(local.map((h) => h.placeId));
  const universes = new Set(local.flatMap((h) => (h.universeId ? [h.universeId] : [])));
  for (const g of roblox) {
    if (items.length >= CONTINUE_LIMIT) break;
    if (places.has(g.placeId) || universes.has(g.universeId)) continue;
    places.add(g.placeId);
    universes.add(g.universeId);
    items.push({
      game: {
        placeId: g.placeId,
        universeId: g.universeId,
        name: g.name,
        iconUrl: g.iconUrl,
        genre: g.genre,
        playerCount: g.playerCount ?? undefined,
        upVotes: g.upVotes ?? undefined,
        downVotes: g.downVotes ?? undefined,
      },
      onRoblox: true,
    });
  }
  return items;
}
