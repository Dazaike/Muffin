import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ipc, toAppError } from "@/lib/ipc";
import type { AppError, WatchKind, WatchList } from "@/lib/types";
import { toast } from "@/store/ui";

export const WATCH_KEY = ["watchList"] as const;

const EMPTY: WatchList = { friends: [], games: [] };

/**
 * The bell-button watch list: friends (user ids) and games (universe ids) Muffin notifies about in
 * the background (see notifier.rs). The list lives in Muffin's database, so it survives restarts and
 * is independent of the notification master switches: a bell can be on while a switch is off.
 */
export function useWatch() {
  const qc = useQueryClient();
  const query = useQuery<WatchList, AppError>({
    queryKey: WATCH_KEY,
    queryFn: () => ipc.watchList(),
    staleTime: Infinity,
  });
  const list = query.data ?? EMPTY;
  const friends = useMemo(() => new Set(list.friends), [list.friends]);
  const games = useMemo(() => new Set(list.games), [list.games]);

  const isWatching = useCallback(
    (kind: WatchKind, id: number) => (kind === "friend" ? friends : games).has(id),
    [friends, games],
  );

  const toggle = useCallback(
    async (kind: WatchKind, id: number, on: boolean) => {
      const field = kind === "friend" ? "friends" : "games";
      qc.setQueryData<WatchList>(WATCH_KEY, (prev) => {
        const cur = prev ?? EMPTY;
        const rest = cur[field].filter((x) => x !== id);
        return { ...cur, [field]: on ? [...rest, id] : rest };
      });
      try {
        await ipc.watchSet(kind, id, on);
      } catch (e) {
        toast.error(toAppError(e).message);
      } finally {
        // Re-read the truth (also reverts the optimistic change on failure).
        void qc.invalidateQueries({ queryKey: WATCH_KEY });
      }
    },
    [qc],
  );

  return { friends, games, isWatching, toggle, loaded: query.data !== undefined };
}
