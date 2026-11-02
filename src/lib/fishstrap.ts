import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ipc } from "./ipc";
import type { AppError, FastFlag, FishstrapSetting, FishstrapStatus, ModsInfo } from "./types";

export const FISHSTRAP_KEYS = {
  status: ["fishstrapStatus"],
  latest: ["robloxLatest"],
  flags: ["fastflags"],
  mods: ["fishstrapMods"],
  settings: ["fishstrapSettings"],
} as const;

export function useFishstrapStatus(): UseQueryResult<FishstrapStatus, AppError> {
  return useQuery<FishstrapStatus, AppError>({
    queryKey: FISHSTRAP_KEYS.status,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => ipc.fishstrapStatus(),
  });
}

export function useFishstrapSettings(enabled: boolean): UseQueryResult<FishstrapSetting[], AppError> {
  return useQuery<FishstrapSetting[], AppError>({
    queryKey: FISHSTRAP_KEYS.settings,
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => ipc.fishstrapSettingsGet(),
  });
}

export function useLatestRobloxVersion(
  channel: string | null | undefined,
  enabled: boolean,
): UseQueryResult<string | null, AppError> {
  return useQuery<string | null, AppError>({
    queryKey: [...FISHSTRAP_KEYS.latest, channel ?? "production"],
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => ipc.robloxLatestVersion(channel ?? undefined),
  });
}

export function useFastFlags(enabled: boolean): UseQueryResult<FastFlag[], AppError> {
  return useQuery<FastFlag[], AppError>({
    queryKey: FISHSTRAP_KEYS.flags,
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => ipc.fastflagsGet(),
  });
}

export function useFishstrapMods(enabled: boolean): UseQueryResult<ModsInfo, AppError> {
  return useQuery<ModsInfo, AppError>({
    queryKey: FISHSTRAP_KEYS.mods,
    enabled,
    staleTime: 0,
    gcTime: 0,
    queryFn: () => ipc.fishstrapMods(),
  });
}
