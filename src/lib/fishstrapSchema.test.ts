import { describe, expect, it } from "vitest";
import { isDisabled, KNOWN_KEYS, SCHEMA_PAGES, searchItems } from "./fishstrapSchema";

const items = SCHEMA_PAGES.flatMap((p) => p.groups.flatMap((g) => g.items));

describe("schema", () => {
  it("only requires keys that are themselves in the schema", () => {
    for (const i of items) if (i.requires) expect(KNOWN_KEYS.has(i.requires.key)).toBe(true);
  });

  it("select options have unique values", () => {
    for (const i of items) {
      if (i.kind !== "select") continue;
      const vals = i.options.map((o) => o.value);
      // Fishstrap's bootstrapper icon enum has two entries both labelled "Fishstrap"; values stay unique.
      expect(new Set(vals).size).toBe(vals.length);
    }
  });

  it("greys out dependants until their parent switch is on", () => {
    const joining = items.find((i) => i.title === "Allow activity joining")!;
    expect(isDisabled(joining, { UseDiscordRichPresence: false })).toBe(true);
    expect(isDisabled(joining, { UseDiscordRichPresence: true })).toBe(false);
  });

  it("searches titles and descriptions case-insensitively", () => {
    const hits = searchItems("DISCORD");
    expect(hits.length).toBeGreaterThan(1);
    expect(searchItems("   ")).toEqual([]);
  });
});
