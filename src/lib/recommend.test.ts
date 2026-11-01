import { describe, expect, it } from "vitest";
import { recommend } from "./recommend";
import type { GameSummary, HistoryEntry, LibraryEntry } from "./types";

const game = (placeId: number, genre: string | undefined, playerCount = 0): GameSummary => ({
  placeId,
  universeId: placeId * 10,
  name: `G${placeId}`,
  genre,
  playerCount,
});

const lib = (placeId: number, genre: string | null, favorite = false): LibraryEntry => ({
  placeId,
  name: `L${placeId}`,
  genre,
  favorite,
  pinned: false,
  addedAt: 0,
  position: placeId,
});

const hist = (placeId: number, genre: string | null, launchCount: number): HistoryEntry => ({
  placeId,
  name: `H${placeId}`,
  genre,
  launchCount,
  lastLaunchedAt: 0,
});

describe("recommend", () => {
  const pool = [game(1, "RPG", 100), game(2, "Obby", 500), game(3, "RPG", 900), game(4, undefined, 9999)];

  it("returns nothing without a signal", () => {
    expect(recommend(pool, [], [])).toEqual([]);
  });

  it("returns nothing when no candidate shares a signalled genre", () => {
    expect(recommend(pool, [lib(100, "Horror", true)], [])).toEqual([]);
  });

  it("biases toward the favorited genre and ignores genre-less games", () => {
    const out = recommend(pool, [lib(100, "Obby", true), lib(101, "RPG", false)], []);
    expect(out.map((g) => g.placeId)).toEqual([2, 3, 1]);
  });

  it("weights launches (capped at 5) into the genre score", () => {
    // RPG: 1 (library) ; Obby: 2·min(9,5)=10 from history → Obby first despite fewer players.
    const out = recommend(pool, [lib(101, "RPG")], [hist(200, "Obby", 9)]);
    expect(out.map((g) => g.placeId)).toEqual([2, 3, 1]);
  });

  it("excludes games already in the library", () => {
    const out = recommend(pool, [lib(3, "RPG", true)], []);
    expect(out.map((g) => g.placeId)).toEqual([1]);
  });

  it("breaks score ties by player count, descending", () => {
    const out = recommend(pool, [lib(100, "RPG", true)], []);
    expect(out.map((g) => g.placeId)).toEqual([3, 1]);
  });

  it("dedupes the pool by placeId", () => {
    const dup = [game(1, "RPG", 1), game(1, "RPG", 1)];
    expect(recommend(dup, [lib(100, "RPG", true)], [])).toHaveLength(1);
  });

  it("honours the limit", () => {
    const many = Array.from({ length: 30 }, (_, i) => game(i + 1, "RPG", i));
    expect(recommend(many, [lib(999, "RPG", true)], [], 5)).toHaveLength(5);
    expect(recommend(many, [lib(999, "RPG", true)], [])).toHaveLength(12);
  });
});
