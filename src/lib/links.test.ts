import { describe, expect, it } from "vitest";
import { gamePath, parsePlaceIdParam } from "./links";

describe("parsePlaceIdParam", () => {
  it("accepts positive integers", () => {
    expect(parsePlaceIdParam("2753915549")).toBe(2753915549);
    expect(parsePlaceIdParam("1")).toBe(1);
  });

  it.each([undefined, null, "", "0", "00", "-5", "12 34", "abc", "12abc", "1.5", "1e3", "٣"])("rejects %j", (v) => {
    expect(parsePlaceIdParam(v)).toBeNull();
  });

  it("rejects values beyond the safe integer range", () => {
    expect(parsePlaceIdParam("9007199254740993")).toBeNull();
    expect(parsePlaceIdParam("99999999999999999999")).toBeNull();
  });
});

describe("gamePath", () => {
  it("builds the details route", () => {
    expect(gamePath(42)).toBe("/game/42");
  });
});
