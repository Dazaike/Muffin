import { Check, Circle, CircleAlert, LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";
import type { FishstrapLaunchProgress } from "@/lib/types";

/** The launch steps Fishstrap would show in its own window, rendered natively. */
export function LaunchSteps({ progress }: { progress: FishstrapLaunchProgress }) {
  const failed = progress.phase === "failed";
  return (
    <div className="flex flex-col gap-2.5">
      <div className={cn("text-sm font-medium", failed && "text-danger")}>{progress.message}</div>
      <ol className="flex flex-col gap-1.5">
        {progress.steps.map((s) => (
          <li
            key={s.label}
            className={cn("flex items-center gap-2.5 text-[13px]", s.state === "pending" ? "text-muted" : "text-fg")}
          >
            {s.state === "done" ? (
              <Check size={15} strokeWidth={2} className="shrink-0 text-success" />
            ) : s.state === "active" ? (
              <LoaderCircle size={15} strokeWidth={2} className="spin shrink-0 text-accent" />
            ) : failed && progress.steps.find((x) => x.state === "pending") === s ? (
              <CircleAlert size={15} strokeWidth={2} className="shrink-0 text-danger" />
            ) : (
              <Circle size={15} strokeWidth={1.75} className="shrink-0 opacity-50" />
            )}
            <span>{s.label}</span>
            {s.label === "Downloading Roblox" && progress.packagesDownloaded > 0 && (
              <span className="text-muted">
                {progress.packagesDownloaded} {progress.packagesDownloaded === 1 ? "package" : "packages"} ·{" "}
                {formatBytes(progress.downloadedBytes)}
              </span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
