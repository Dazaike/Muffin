import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ipc", () => ({
  ipc: {},
  autostart: {},
  toAppError: (e: unknown) => e,
}));

import { applySettingsToDom, DEFAULT_SETTINGS, mergeSettings } from "./settings";

describe("mergeSettings accent hue", () => {
  it("accepts integers 0–359", () => {
    expect(mergeSettings({ accentHue: 0 }).accentHue).toBe(0);
    expect(mergeSettings({ accentHue: 359 }).accentHue).toBe(359);
  });

  it("falls back to the default for out-of-range, fractional or mistyped values", () => {
    for (const bad of [360, -1, 12.5, "265", null]) {
      expect(mergeSettings({ accentHue: bad }).accentHue).toBe(DEFAULT_SETTINGS.accentHue);
    }
  });

  it("ignores a legacy `accent` row", () => {
    const s = mergeSettings({ accent: "rose" });
    expect(s).not.toHaveProperty("accent");
    expect(s.accentHue).toBe(265);
  });

  it("drives --accent-h from accentHue", () => {
    const props = new Map<string, string>();
    const root = { dataset: {}, style: { setProperty: (k: string, v: string) => props.set(k, v) } } as unknown as HTMLElement;
    applySettingsToDom({ ...DEFAULT_SETTINGS, accentHue: 123 }, root);
    expect(props.get("--accent-h")).toBe("123");
  });
});

describe("mergeSettings discoverCards", () => {
  it("defaults to vertical and accepts both layouts", () => {
    expect(DEFAULT_SETTINGS.discoverCards).toBe("vertical");
    expect(mergeSettings({ discoverCards: "horizontal" }).discoverCards).toBe("horizontal");
    expect(mergeSettings({ discoverCards: "vertical" }).discoverCards).toBe("vertical");
  });

  it("rejects unknown values", () => {
    expect(mergeSettings({ discoverCards: "wide" }).discoverCards).toBe("vertical");
    expect(mergeSettings({ discoverCards: true }).discoverCards).toBe("vertical");
  });
});
