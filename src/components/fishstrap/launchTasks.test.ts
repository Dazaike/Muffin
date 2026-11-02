import { describe, expect, it } from "vitest";
import type { FishstrapLaunchProgress } from "@/lib/types";
import { launchTasks } from "./LaunchCard";

const LABELS = ["Connecting to Roblox", "Checking for updates", "Downloading Roblox", "Applying modifications", "Starting Roblox"];

function progress(over: Partial<FishstrapLaunchProgress>, active: number): FishstrapLaunchProgress {
  return {
    phase: "running",
    message: LABELS[active] ?? "",
    packagesDownloaded: 0,
    downloadedBytes: 0,
    steps: LABELS.map((label, i) => ({
      label,
      state: i < active ? "done" : i === active ? "active" : "pending",
    })),
    ...over,
  };
}

describe("launchTasks", () => {
  it("shows started steps only, with the newest running", () => {
    const t = launchTasks(progress({}, 2), () => {}, () => {});
    expect(t.map((x) => [x.id, x.status])).toEqual([
      ["Connecting to Roblox", "done"],
      ["Checking for updates", "done"],
      ["Downloading Roblox", "running"],
    ]);
  });

  it("uses the message for the active step and adds download counts", () => {
    const t = launchTasks(progress({ message: "Updating Fishstrap" }, 1), () => {}, () => {});
    expect(t.at(-1)?.label).toBe("Updating Fishstrap");
    const d = launchTasks(progress({ packagesDownloaded: 2, downloadedBytes: 3 * 1024 * 1024 }, 2), () => {}, () => {});
    expect(d.at(-1)?.detail).toBe("2 packages · 3.0 MB");
  });

  it("ends with the final message when done, and an error task with Dismiss when failed", () => {
    const done = launchTasks(progress({ phase: "done", message: "Roblox started" }, 5), () => {}, () => {});
    expect(done.every((x) => x.status === "done")).toBe(true);
    expect(done.at(-1)?.label).toBe("Roblox started");

    let dismissed = false;
    const failed = launchTasks(progress({ phase: "failed", message: "Nope" }, 1), () => (dismissed = true), () => {});
    const last = failed.at(-1);
    expect([last?.status, last?.label]).toEqual(["error", "Nope"]);
    last?.action?.onClick();
    expect(dismissed).toBe(true);
  });
});

describe("launchTasks cancel", () => {
  it("offers Cancel on the newest step while running, never once finished", () => {
    let cancelled = false;
    const running = launchTasks(progress({}, 2), () => {}, () => (cancelled = true));
    expect(running.at(-1)?.action?.label).toBe("Cancel");
    expect(running.slice(0, -1).every((t) => !t.action)).toBe(true);
    running.at(-1)?.action?.onClick();
    expect(cancelled).toBe(true);

    const done = launchTasks(progress({ phase: "done", message: "Roblox started" }, 5), () => {}, () => {});
    expect(done.some((t) => t.action)).toBe(false);
  });
});
