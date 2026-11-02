import { useMemo } from "react";
import { StatusIsland, type IslandTask } from "@/components/ui/StatusIsland";
import { formatBytes } from "@/lib/format";
import { ipc } from "@/lib/ipc";
import type { FishstrapLaunchProgress } from "@/lib/types";
import { useFishstrapLaunch } from "@/store/fishstrapLaunch";

const DOWNLOAD_STEP = "Downloading Roblox";

/** One island task per launch step that has started; the newest (active) one shows in the pill. */
export function launchTasks(p: FishstrapLaunchProgress, dismiss: () => void, cancel: () => void): IslandTask[] {
  const tasks: IslandTask[] = p.steps
    .filter((s) => s.state !== "pending")
    .map((s) => ({
      id: s.label,
      // While running the message is the active step, or "Updating Fishstrap" during a self-update.
      label: s.state === "active" ? p.message : s.label,
      detail:
        s.label === DOWNLOAD_STEP && p.packagesDownloaded > 0
          ? `${p.packagesDownloaded} ${p.packagesDownloaded === 1 ? "package" : "packages"} · ${formatBytes(p.downloadedBytes)}`
          : undefined,
      status: s.state === "active" ? "running" : "done",
    }));
  if (p.phase === "done") {
    const last = tasks.at(-1);
    if (last) last.label = p.message;
  } else if (p.phase === "failed") {
    tasks.push({
      id: "failed",
      label: p.message,
      status: "error",
      action: { label: "Dismiss", onClick: dismiss },
    });
  } else if (tasks.length === 0) {
    tasks.push({ id: "starting", label: p.message, status: "running" });
  }
  // Only a launch still in progress can be cancelled; the pill shows the action on the newest step.
  const last = tasks.at(-1);
  if (p.phase === "running" && last) last.action = { label: "Cancel", onClick: cancel, stop: true };
  return tasks;
}

/** Launch status shown as a Status Island while Fishstrap runs hidden. */
export function LaunchCard() {
  const progress = useFishstrapLaunch((s) => s.progress);
  const dismissed = useFishstrapLaunch((s) => s.dismissed);
  const dismiss = useFishstrapLaunch((s) => s.dismiss);
  const tasks = useMemo(
    () => (progress && !dismissed ? launchTasks(progress, dismiss, () => void ipc.fishstrapLaunchCancel()) : []),
    [progress, dismissed, dismiss],
  );
  const lastId = tasks.at(-1)?.id;

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[79] -translate-x-1/2">
      <div className="pointer-events-auto">
        {/* Only the newest task ending closes the island; earlier steps finishing is just progress. */}
        <StatusIsland tasks={tasks} onDismiss={(id) => id === lastId && dismiss()} />
      </div>
    </div>
  );
}
