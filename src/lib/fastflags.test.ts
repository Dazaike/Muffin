import { describe, expect, it } from "vitest";
import { mergeFlags, parseFlagJson } from "./fastflags";

describe("parseFlagJson", () => {
  it("normalises booleans, numbers and strings", () => {
    expect(parseFlagJson('{"FFlagA":true,"DFIntB":5,"FStringC":"x","FFlagD":false}')).toEqual({
      flags: [
        { name: "FFlagA", value: "True" },
        { name: "DFIntB", value: "5" },
        { name: "FStringC", value: "x" },
        { name: "FFlagD", value: "False" },
      ],
    });
  });

  it("names the offending key for non-scalar values", () => {
    for (const bad of ['{"A":[1]}', '{"A":null}', '{"A":{}}']) {
      const r = parseFlagJson(bad);
      expect("error" in r && r.error.startsWith("A:")).toBe(true);
    }
  });

  it.each(["", "{oops", "[1]", "5", "null"])("rejects %j", (t) => {
    expect("error" in parseFlagJson(t)).toBe(true);
  });
});

describe("mergeFlags", () => {
  it("overrides by name and sorts", () => {
    const out = mergeFlags(
      [{ name: "B", value: "1" }, { name: "A", value: "1" }],
      [{ name: "B", value: "2" }, { name: "C", value: "3" }],
    );
    expect(out).toEqual([
      { name: "A", value: "1" },
      { name: "B", value: "2" },
      { name: "C", value: "3" },
    ]);
  });
});
