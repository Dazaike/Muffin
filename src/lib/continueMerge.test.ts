import { describe, expect, it } from "vitest";
import { CONTINUE_LIMIT, LOCAL_CONTINUE_LIMIT, mergeContinue } from "./continueMerge";
import type { ContinueGame } from "./dataTypes";
import type { HistoryEntry } from "./types";

const hist = (placeId: number, lastLaunchedAt: number, universeId: number | null = null): HistoryEntry => ({
  placeId,
  universeId,
  name: `H${placeId}`,
  lastLaunchedAt,
  launchCount: 1,
});

const rbx = (placeId: number, universeId = placeId * 10): ContinueGame => ({
  placeId,
  universeId,
  name: `R${placeId}`,
  iconUrl: null,
  genre: null,
  playerCount: null,
  upVotes: null,
  downVotes: null,
});

describe("mergeContinue", () => {
  it("without Roblox data shows local history only, with timestamps", () => {
    const out = mergeContinue([hist(1, 500), hist(2, 400)], undefined);
    expect(out.map((i) => [i.game.placeId, i.lastLaunchedAt, i.onRoblox])).toEqual([
      [1, 500, false],
      [2, 400, false],
    ]);
  });

  it("appends Roblox-only games after local ones, in Roblox order, without invented times", () => {
    const out = mergeContinue([hist(1, 500)], [rbx(7), rbx(8)]);
    expect(out.map((i) => i.game.placeId)).toEqual([1, 7, 8]);
    expect(out[1]?.onRoblox).toBe(true);
    expect(out[1]?.lastLaunchedAt).toBeUndefined();
    expect(out[0]?.onRoblox).toBe(false);
  });

  it("skips Roblox games already shown, matching by place id or universe id", () => {
    const out = mergeContinue([hist(1, 500), hist(2, 400, 555)], [rbx(1), rbx(99, 555), rbx(3), rbx(3)]);
    expect(out.map((i) => i.game.placeId)).toEqual([1, 2, 3]);
  });

  it("maps nullable Roblox stats to optional card fields", () => {
    const g: ContinueGame = { ...rbx(5), iconUrl: "https://t.rbxcdn.com/x", genre: "Obby", playerCount: 3, upVotes: 9, downVotes: 1 };
    const [item] = mergeContinue([], [g]);
    expect(item?.game).toMatchObject({ iconUrl: "https://t.rbxcdn.com/x", genre: "Obby", playerCount: 3, upVotes: 9, downVotes: 1 });
    expect(mergeContinue([], [rbx(6)])[0]?.game.playerCount).toBeUndefined();
  });

  it("caps local at 10 and the whole row at 24", () => {
    const local = Array.from({ length: 15 }, (_, i) => hist(i + 1, 1000 - i));
    const remote = Array.from({ length: 40 }, (_, i) => rbx(100 + i));
    const out = mergeContinue(local, remote);
    expect(out.filter((i) => !i.onRoblox)).toHaveLength(LOCAL_CONTINUE_LIMIT);
    expect(out).toHaveLength(CONTINUE_LIMIT);
  });
});
