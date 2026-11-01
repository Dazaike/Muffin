import { describe, expect, it } from "vitest";
import type { Friend, Presence } from "@/lib/socialTypes";
import { matchesFriend, presenceText, sortFriends } from "./presence";

const NOW = Date.parse("2025-06-01T12:00:00Z");

function friend(id: number, displayName: string, p: Partial<Presence>): Friend {
  return {
    id,
    name: displayName.toLowerCase(),
    displayName,
    verified: false,
    presence: { userId: id, status: "offline", joinable: false, ...p },
  };
}

describe("sortFriends", () => {
  it("puts in-game, then online, then Studio, then offline; offline by most recent, unknown last", () => {
    const list = [
      friend(1, "Zed", { status: "offline", lastOnline: "2025-05-01T00:00:00Z" }),
      friend(2, "Amy", { status: "offline", lastOnline: "2025-05-30T00:00:00Z" }),
      friend(3, "Bob", { status: "offline", lastOnline: "not a date" }),
      friend(4, "Cat", { status: "inStudio" }),
      friend(5, "Dan", { status: "online" }),
      friend(6, "Eve", { status: "inGame" }),
      friend(7, "abe", { status: "online" }),
    ];
    expect(sortFriends(list).map((f) => f.id)).toEqual([6, 7, 5, 4, 2, 1, 3]);
  });

  it("does not mutate its input", () => {
    const list = [friend(1, "B", { status: "offline" }), friend(2, "A", { status: "online" })];
    sortFriends(list);
    expect(list.map((f) => f.id)).toEqual([1, 2]);
  });
});

describe("presenceText", () => {
  it("describes each status and tolerates missing data", () => {
    expect(presenceText(friend(1, "A", { status: "inGame", lastLocation: "Blox Fruits" }).presence, NOW)).toBe("Playing Blox Fruits");
    expect(presenceText(friend(1, "A", { status: "inGame" }).presence, NOW)).toBe("In a game");
    expect(presenceText(friend(1, "A", { status: "online" }).presence, NOW)).toBe("Online");
    expect(presenceText(friend(1, "A", { status: "inStudio" }).presence, NOW)).toBe("In Roblox Studio");
    expect(presenceText(friend(1, "A", { status: "offline" }).presence, NOW)).toBe("Offline");
    expect(presenceText(friend(1, "A", { status: "offline", lastOnline: "garbage" }).presence, NOW)).toBe("Offline");
    expect(presenceText(friend(1, "A", { status: "offline", lastOnline: "2025-06-01T09:00:00Z" }).presence, NOW)).toBe("Last online 3 h ago");
  });
});

describe("matchesFriend", () => {
  it("matches display name or username, ignoring case and surrounding space", () => {
    const f = { displayName: "Cool Bob", name: "bob123" };
    expect(matchesFriend(f, "  COOL ")).toBe(true);
    expect(matchesFriend(f, "bo123")).toBe(false);
    expect(matchesFriend(f, "bob12")).toBe(true);
    expect(matchesFriend(f, "")).toBe(true);
    expect(matchesFriend(f, "zzz")).toBe(false);
  });
});
