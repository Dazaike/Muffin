import { create } from "zustand";
import { ipc, notify, toAppError, windowControls } from "@/lib/ipc";
import type { AppError, GameRef } from "@/lib/types";
import { useUi } from "./ui";
import { useLibrary } from "./library";
import { useSettings } from "./settings";

export type LaunchPhase = "idle" | "launching" | "error";

export interface LaunchState {
  phase: LaunchPhase;
  placeId?: number;
  game?: GameRef;
  error?: AppError;
}

interface LaunchStore {
  state: LaunchState;
  /** Launch a public experience. Ignored unless phase === "idle". */
  launch: (game: GameRef) => Promise<void>;
  /** Launch a saved private server of `game`. Ignored unless phase === "idle". */
  launchPrivate: (serverId: number, game: GameRef) => Promise<void>;
  /** Join one specific public server of `game`. Ignored unless phase === "idle". */
  launchInstance: (instanceId: string, game: GameRef) => Promise<void>;
  dismiss: () => void;
}

const MIN_LAUNCHING_MS = 900;
const ERROR_AUTO_DISMISS_MS = 3000;
const IDLE: LaunchState = { phase: "idle" };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let errorTimer: ReturnType<typeof setTimeout> | undefined;

export const useLaunch = create<LaunchStore>((set, get) => {
  const run = async (game: GameRef, start: () => Promise<unknown>) => {
    if (get().state.phase !== "idle") return;
    clearTimeout(errorTimer);
    set({ state: { phase: "launching", placeId: game.placeId, game } });
    const minDelay = sleep(MIN_LAUNCHING_MS);
    try {
      await Promise.all([start(), minDelay]);
    } catch (e) {
      await minDelay;
      const err = toAppError(e);
      if (err.code === "launch_busy") {
        set({ state: IDLE });
        return;
      }
      set({ state: { phase: "error", placeId: game.placeId, game, error: err } });
      errorTimer = setTimeout(() => get().dismiss(), ERROR_AUTO_DISMISS_MS);
      useUi.getState().pushToast({
        kind: "error",
        message: err.message,
        action: err.code === "not_installed" ? { label: "Open Settings", onClick: () => (window.location.hash = "#/settings?tab=roblox") } : undefined,
      });
      if (useSettings.getState().values.notifications && !(await windowControls.isFocused().catch(() => true))) {
        void notify.send("Launch failed", err.message);
      }
      return;
    }
    set({ state: IDLE });
    void useLibrary.getState().refreshHistory();
  };

  return {
    state: IDLE,
    launch: (game) =>
      run(game, () =>
        ipc.launchExperience({
          placeId: game.placeId,
          universeId: game.universeId ?? null,
          name: game.name,
          iconUrl: game.iconUrl ?? null,
          genre: game.genre ?? null,
        }),
      ),
    launchPrivate: (serverId, game) => run(game, () => ipc.launchPrivateServer(serverId)),
    launchInstance: (instanceId, game) =>
      run(game, () =>
        ipc.launchInstance({
          placeId: game.placeId,
          instanceId,
          universeId: game.universeId ?? null,
          name: game.name,
          iconUrl: game.iconUrl ?? null,
          genre: game.genre ?? null,
        }),
      ),
    dismiss: () => {
      clearTimeout(errorTimer);
      if (get().state.phase === "error") set({ state: IDLE });
    },
  };
});
