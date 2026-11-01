import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PlayerState, PlaytimeRange, PlaytimeSession, PlaytimeSummary } from "./dataTypes";
import { ipc } from "./ipc";
import type { AppError } from "./types";

const ROOT = ["playtime"] as const;
const STATE_KEY = [...ROOT, "state"] as const;

const IDLE: PlayerState = { running: false, placeId: null };

/** While a session is running its duration grows, so summary/session queries re-read every 15 s (visible window only). */
const LIVE_REFETCH_MS = 15_000;

/**
 * Live "is the Roblox player running" state. Subscribes to Rust's `player-state` event and
 * refreshes every playtime query when it flips, so totals stay current without polling.
 */
export function usePlayerState(): PlayerState {
  const qc = useQueryClient();
  const { data } = useQuery<PlayerState, AppError>({
    queryKey: STATE_KEY,
    queryFn: () => ipc.playtimeState(),
    staleTime: Infinity,
  });
  useEffect(() => {
    let cancelled = false;
    let off: (() => void) | undefined;
    void ipc
      .onPlayerState((s) => {
        qc.setQueryData(STATE_KEY, s);
        void qc.invalidateQueries({ queryKey: ROOT });
      })
      .then((u) => {
        if (cancelled) u();
        else off = u;
      })
      .catch(() => {
        /* events unavailable: totals refresh on next mount */
      });
    return () => {
      cancelled = true;
      off?.();
    };
  }, [qc]);
  return data ?? IDLE;
}

export function usePlaytimeSummary(range: PlaytimeRange) {
  const { running } = usePlayerState();
  return useQuery<PlaytimeSummary, AppError>({
    queryKey: [...ROOT, "summary", range],
    queryFn: () => ipc.playtimeSummary(range),
    staleTime: 30_000,
    refetchInterval: running ? LIVE_REFETCH_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function usePlaytimeSessions(limit = 50) {
  const { running } = usePlayerState();
  return useQuery<PlaytimeSession[], AppError>({
    queryKey: [...ROOT, "sessions", limit],
    queryFn: () => ipc.playtimeSessions(limit),
    staleTime: 30_000,
    refetchInterval: running ? LIVE_REFETCH_MS : false,
    refetchIntervalInBackground: false,
  });
}

/** Total tracked time for one game (all time), or undefined while loading / never tracked. */
export function usePlayedMs(placeId: number | undefined): number | undefined {
  const { data } = usePlaytimeSummary("all");
  if (placeId === undefined || !data) return undefined;
  return data.games.find((g) => g.placeId === placeId)?.totalMs;
}
