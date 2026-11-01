import { describe, expect, it } from "vitest";
import { adjustVotes } from "./votes";

describe("adjustVotes", () => {
  it("a first vote adds one on that side only", () => {
    expect(adjustVotes(10, 4, null, true)).toEqual({ up: 11, down: 4 });
    expect(adjustVotes(10, 4, null, false)).toEqual({ up: 10, down: 5 });
  });

  it("switching sides moves one vote across", () => {
    expect(adjustVotes(10, 4, false, true)).toEqual({ up: 11, down: 3 });
    expect(adjustVotes(10, 4, true, false)).toEqual({ up: 9, down: 5 });
  });

  it("repeating the same vote changes nothing", () => {
    expect(adjustVotes(10, 4, true, true)).toEqual({ up: 10, down: 4 });
    expect(adjustVotes(10, 4, false, false)).toEqual({ up: 10, down: 4 });
  });
});
