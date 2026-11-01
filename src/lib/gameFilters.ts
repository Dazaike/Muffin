import { percent } from "./format";
import type { PublicServer } from "./gameExtras";
import type { GameSummary } from "./types";

/** `default` keeps Roblox's order (no client re-ranking). */
export type ResultSort = "default" | "players" | "rating";

export interface ResultFilters {
  /** Hide games with fewer live players than this (0 = off). */
  minPlayers: number;
  sort: ResultSort;
}

export const NO_FILTERS: ResultFilters = { minPlayers: 0, sort: "default" };

export const MIN_PLAYER_STEPS = [0, 100, 1_000, 10_000, 100_000] as const;

export function isFiltering(f: ResultFilters): boolean {
  return f.minPlayers > 0 || f.sort !== "default";
}

function rating(g: GameSummary): number {
  if (g.upVotes === undefined || g.downVotes === undefined) return -1;
  return percent(g.upVotes, g.downVotes) ?? -1;
}

/**
 * Client-side min-players filter and sort over data Roblox already returned. Games without a known
 * player count don't pass a min-players filter; games without votes sort last by rating. Stable.
 */
export function applyResultFilters<T extends GameSummary>(list: readonly T[], f: ResultFilters): T[] {
  const kept = f.minPlayers > 0 ? list.filter((g) => (g.playerCount ?? 0) >= f.minPlayers) : [...list];
  if (f.sort === "players") return kept.sort((a, b) => (b.playerCount ?? -1) - (a.playerCount ?? -1));
  if (f.sort === "rating") return kept.sort((a, b) => rating(b) - rating(a));
  return kept;
}

export type ServerSort = "default" | "ping" | "players";

/** Server-browser view over loaded servers: optional "hide full" and a client-side sort. */
export function viewServers(list: readonly PublicServer[], hideFull: boolean, sort: ServerSort): PublicServer[] {
  const kept = hideFull ? list.filter((s) => s.playing < s.maxPlayers) : [...list];
  if (sort === "ping") return kept.sort((a, b) => (a.ping ?? Infinity) - (b.ping ?? Infinity));
  if (sort === "players") return kept.sort((a, b) => b.playing - a.playing);
  return kept;
}
