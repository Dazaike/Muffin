import { describe, expect, it } from "vitest";
import { accentHex, hueOf, stripAlpha } from "./colour";

describe("colour helpers", () => {
  it("round-trips an accent hue through its hex", () => {
    for (const h of [20, 90, 150, 200, 265, 330]) {
      const back = hueOf(accentHex(h));
      expect(back).not.toBeNull();
      expect(Math.abs(((back as number) - h + 540) % 360 - 180)).toBeLessThanOrEqual(3);
    }
  });

  it("knows pure red sits near OKLCH hue 29", () => {
    expect(hueOf("#ff0000")).toBeGreaterThanOrEqual(28);
    expect(hueOf("#ff0000")).toBeLessThanOrEqual(30);
  });

  it("has no hue for greys or junk", () => {
    expect(hueOf("#808080")).toBeNull();
    expect(hueOf("nope")).toBeNull();
  });

  it("drops the alpha pair the picker adds", () => {
    expect(stripAlpha("#0B1220CC")).toBe("#0b1220");
    expect(stripAlpha("#0B1220")).toBe("#0b1220");
  });
});
