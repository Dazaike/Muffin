import { useQuery } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";
import type { AppError } from "@/lib/types";
import { useResetOnAccountChange } from "./useResetOnAccountChange";

const REFRESH_MS = 60_000;

/**
 * Robux balance of the active Roblox account. Refetches every 60 s while the window is visible and
 * resets on `account-changed`. Shared by the Wallet page and the top-bar badge (same query key).
 */
export function useRobuxBalance(enabled: boolean) {
  useResetOnAccountChange("economy");
  return useQuery<number, AppError>({
    queryKey: ["economy", "balance"],
    queryFn: ipc.economyBalance,
    enabled,
    staleTime: 30_000,
    retry: false,
    refetchInterval: () => (document.visibilityState === "visible" ? REFRESH_MS : false),
  });
}
