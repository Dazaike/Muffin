import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ipc } from "@/lib/ipc";

/** Resets every query under `[prefix]` when the active Roblox account changes (switch/remove). */
export function useResetOnAccountChange(prefix: string) {
  const qc = useQueryClient();
  useEffect(() => {
    let dead = false;
    let off: (() => void) | undefined;
    void ipc
      .onAccountChanged(() => void qc.resetQueries({ queryKey: [prefix] }))
      .then((un) => {
        if (dead) un();
        else off = un;
      })
      .catch(() => {
        /* event bridge unavailable: queries simply refetch on next mount */
      });
    return () => {
      dead = true;
      off?.();
    };
  }, [qc, prefix]);
}
