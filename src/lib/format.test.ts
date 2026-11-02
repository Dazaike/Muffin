import { describe, expect, it } from "vitest";
import { dayBucket, formatBytes, formatCompact, formatDate, formatDuration, percent, relativeTime } from "./format";

describe("formatCompact", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1K"],
    [1234, "1.2K"],
    [999_999, "999.9K"],
    [1_000_000, "1M"],
    [3_400_000, "3.4M"],
    [1_100_000_000, "1.1B"],
    [65_204_750_625, "65.2B"],
  ])("%d → %s", (n, expected) => {
    expect(formatCompact(n)).toBe(expected);
  });

  it("handles non-finite input", () => {
    expect(formatCompact(Number.NaN)).toBe("0");
  });
});

describe("relativeTime", () => {
  const now = 1_700_000_000_000;
  it.each([
    [0, "just now"],
    [44_000, "just now"],
    [45_000, "1 min ago"],
    [59 * 60_000, "59 min ago"],
    [60 * 60_000, "1 h ago"],
    [23 * 3_600_000, "23 h ago"],
    [24 * 3_600_000, "yesterday"],
    [3 * 86_400_000, "3 d ago"],
    [45 * 86_400_000, "1 mo ago"],
    [400 * 86_400_000, "1 y ago"],
  ])("%d ms ago → %s", (delta, expected) => {
    expect(relativeTime(now - delta, now)).toBe(expected);
  });

  it("treats future timestamps as just now", () => {
    expect(relativeTime(now + 10_000, now)).toBe("just now");
  });
});

describe("percent", () => {
  it("returns null with no votes", () => {
    expect(percent(0, 0)).toBeNull();
  });
  it("rounds approval", () => {
    expect(percent(1, 2)).toBe(33);
    expect(percent(9, 1)).toBe(90);
    expect(percent(5, 0)).toBe(100);
    expect(percent(0, 5)).toBe(0);
  });
});

describe("dayBucket", () => {
  const now = new Date(2026, 9, 31, 15, 0, 0).getTime();
  it("groups by local day", () => {
    expect(dayBucket(new Date(2026, 9, 31, 0, 0, 1).getTime(), now)).toBe("Today");
    expect(dayBucket(new Date(2026, 9, 30, 23, 59, 0).getTime(), now)).toBe("Yesterday");
    expect(dayBucket(new Date(2026, 9, 29, 12, 0, 0).getTime(), now)).toBe("Earlier");
  });
});

describe("formatDuration", () => {
  it.each([
    [-5, "0 min"],
    [0, "0 min"],
    [Number.NaN, "0 min"],
    [59_999, "<1 min"],
    [60_000, "1 min"],
    [59 * 60_000 + 59_999, "59 min"],
    [60 * 60_000, "1h"],
    [(3 * 60 + 20) * 60_000, "3h 20m"],
    [(99 * 60 + 30) * 60_000, "99h 30m"],
    [(100 * 60 + 30) * 60_000, "100h"],
  ])("%d ms → %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("formatDate", () => {
  it("formats Roblox ISO timestamps as a UTC calendar day", () => {
    expect(formatDate("2017-07-14T19:26:21.347Z")).toBe("Jul 14, 2017");
    expect(formatDate("2026-10-31T23:59:59.000Z")).toBe("Oct 31, 2026");
    expect(formatDate("2026-01-01T00:00:00+00:00")).toBe("Jan 1, 2026");
  });
  it("returns null for missing or invalid input", () => {
    expect(formatDate(undefined)).toBeNull();
    expect(formatDate(null)).toBeNull();
    expect(formatDate("")).toBeNull();
    expect(formatDate("not a date")).toBeNull();
  });
});

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [2048, "2.0 KB"],
    [5 * 1024 * 1024, "5.0 MB"],
    [3 * 1024 ** 3, "3.00 GB"],
  ])("%d → %s", (n, out) => {
    expect(formatBytes(n)).toBe(out);
  });
});
