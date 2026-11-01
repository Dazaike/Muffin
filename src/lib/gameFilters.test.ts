import { describe, expect, it } from "vitest";
import { applyResultFilters, isFiltering, NO_FILTERS, viewServers } from "./gameFilters";
import type { GameSummary } from "./types";

const g = (placeId: number, playerCount?: number, up?: number, down?: number): GameSummary => ({
  placeId,
  universeId: placeId,
  name: `g${placeId}`,
  playerCount,
  upVotes: up,
  downVotes: down,
});

const ids = (l: GameSummary[]) => l.map((x) => x.placeId);

describe("applyResultFilters", () => {
  const list = [g(1, 50, 9, 1), g(2, 5000, 1, 1), g(3, undefined), g(4, 500, 99, 1), g(5, 5000, 3, 1)];

  it("default keeps Roblox's order and does not mutate the input", () => {
    const before = ids(list);
    expect(ids(applyResultFilters(list, NO_FILTERS))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(list)).toEqual(before);
  });

  it("min players drops lower and unknown counts, inclusive at the boundary", () => {
    expect(ids(applyResultFilters(list, { minPlayers: 500, sort: "default" }))).toEqual([2, 4, 5]);
    expect(ids(applyResultFilters(list, { minPlayers: 5000, sort: "default" }))).toEqual([2, 5]);
  });

  it("sorts by players desc, unknown last, stable on ties", () => {
    expect(ids(applyResultFilters(list, { minPlayers: 0, sort: "players" }))).toEqual([2, 5, 4, 1, 3]);
  });

  it("sorts by rating desc with unvoted games last", () => {
    expect(ids(applyResultFilters(list, { minPlayers: 0, sort: "rating" }))).toEqual([4, 1, 5, 2, 3]);
  });

  it("filter and sort compose", () => {
    expect(ids(applyResultFilters(list, { minPlayers: 500, sort: "rating" }))).toEqual([4, 5, 2]);
  });

  it("isFiltering reflects any active option", () => {
    expect(isFiltering(NO_FILTERS)).toBe(false);
    expect(isFiltering({ minPlayers: 100, sort: "default" })).toBe(true);
    expect(isFiltering({ minPlayers: 0, sort: "players" })).toBe(true);
  });
});

describe("viewServers", () => {
  const servers = [
    { id: "a", playing: 35, maxPlayers: 35, ping: 40 },
    { id: "b", playing: 10, maxPlayers: 35, ping: 120 },
    { id: "c", playing: 20, maxPlayers: 35 },
    { id: "d", playing: 30, maxPlayers: 35, ping: 80 },
  ];
  const sid = (l: { id: string }[]) => l.map((s) => s.id);

  it("keeps Roblox order by default and hides only full servers on request", () => {
    expect(sid(viewServers(servers, false, "default"))).toEqual(["a", "b", "c", "d"]);
    expect(sid(viewServers(servers, true, "default"))).toEqual(["b", "c", "d"]);
  });

  it("sorts by ping with unknown ping last, and by players desc", () => {
    expect(sid(viewServers(servers, false, "ping"))).toEqual(["a", "d", "b", "c"]);
    expect(sid(viewServers(servers, true, "players"))).toEqual(["d", "c", "b"]);
  });

  it("does not mutate its input", () => {
    viewServers(servers, false, "players");
    expect(sid(servers)).toEqual(["a", "b", "c", "d"]);
  });
});
