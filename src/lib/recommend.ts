import type { GameSummary, HistoryEntry, LibraryEntry } from "./types";

/**
 * Genre-affinity recommendations.
 * genreScore = 3·favorites + 1·other library entries + 2·min(launchCount, 5) per genre.
 * Candidates are pool games not already in the library, scored by their genre; zero scores are dropped,
 * unless `fill` is set, in which case they follow the matches ordered by player count.
 */
export function recommend(
  pool: GameSummary[],
  library: LibraryEntry[],
  history: HistoryEntry[],
  limit = 12,
  fill = false,
): GameSummary[] {
  const genreScore: Record<string, number> = {};
  const add = (genre: string | null | undefined, n: number) => {
    if (!genre) return;
    genreScore[genre] = (genreScore[genre] ?? 0) + n;
  };
  for (const e of library) add(e.genre, e.favorite ? 3 : 1);
  for (const h of history) add(h.genre, 2 * Math.min(h.launchCount, 5));

  const owned = new Set(library.map((e) => e.placeId));
  const seen = new Set<number>();
  const scored: { game: GameSummary; score: number }[] = [];
  for (const game of pool) {
    if (owned.has(game.placeId) || seen.has(game.placeId)) continue;
    seen.add(game.placeId);
    const score = game.genre ? (genreScore[game.genre] ?? 0) : 0;
    if (score > 0 || fill) scored.push({ game, score });
  }
  scored.sort((a, b) => b.score - a.score || (b.game.playerCount ?? 0) - (a.game.playerCount ?? 0));
  return scored.slice(0, limit).map((s) => s.game);
}
