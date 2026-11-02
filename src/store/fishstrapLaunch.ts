import { create } from "zustand";
import { ipc } from "@/lib/ipc";
import type { FishstrapLaunchProgress } from "@/lib/types";

interface LaunchState {
  progress: FishstrapLaunchProgress | null;
  /** The floating card was closed (or auto-closed after success); the settings page still shows the last run. */
  dismissed: boolean;
  dismiss: () => void;
}

export const useFishstrapLaunch = create<LaunchState>((set) => ({
  progress: null,
  dismissed: true,
  dismiss: () => set({ dismissed: true }),
}));

/** Follows Rust's `fishstrap-launch` events; returns the unsubscribe function. */
export async function startFishstrapLaunchSync(): Promise<() => void> {
  const apply = (p: FishstrapLaunchProgress) =>
    useFishstrapLaunch.setState((s) => ({
      progress: p,
      // A new launch re-opens the card; updates within the same launch keep the user's choice.
      dismissed: p.phase === "cancelled" ? true : p.phase === "running" && s.progress?.phase !== "running" ? false : s.dismissed,
    }));
  // Catch up when the window opens mid-launch (e.g. restored from the tray).
  const latest = await ipc.fishstrapLaunchProgress().catch(() => null);
  if (latest && !useFishstrapLaunch.getState().progress) {
    useFishstrapLaunch.setState({ progress: latest, dismissed: latest.phase !== "running" });
  }
  return ipc.onFishstrapLaunch(apply);
}
