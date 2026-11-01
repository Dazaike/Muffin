import { useCallback, useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient, type UseInfiniteQueryResult, type UseQueryResult } from "@tanstack/react-query";
import { ipc, toAppError } from "@/lib/ipc";
import type { FollowKind, FriendAction, FriendsList, PersonPage, Presence, SocialUser } from "@/lib/socialTypes";
import type { AppError } from "@/lib/types";
import { useAccount } from "@/store/account";
import { useLibrary } from "@/store/library";
import { toast } from "@/store/ui";

/** Presence is refreshed this often while the window is visible and focused. */
export const PRESENCE_REFRESH_MS = 30_000;
const REQUEST_COUNT_REFRESH_MS = 60_000;
/** Friend data is personal: drop it from memory shortly after the page stops using it. */
const SENSITIVE_GC_MS = 30_000;

/** Every friends query is keyed by the signed-in user, so switching accounts never shows stale people. */
export const friendsKey = (userId: number | null, ...rest: (string | undefined)[]) => ["friends", userId, ...rest] as const;

export type PeopleSource = "requests" | FollowKind | "search";

export interface SocialSession {
  /** Account status has been read from Rust. */
  loaded: boolean;
  signedIn: boolean;
  /** The active account's session was rejected by Roblox. */
  expired: boolean;
  userId: number | null;
}

export function useSocialSession(): SocialSession {
  const status = useAccount((s) => s.status);
  const signedIn = !!status?.signedIn && !status.expired;
  return { loaded: status !== null, signedIn, expired: !!status?.expired, userId: signedIn ? (status?.user?.id ?? null) : null };
}

export function useFriendsList(userId: number | null): UseQueryResult<FriendsList, AppError> {
  return useQuery<FriendsList, AppError>({
    queryKey: friendsKey(userId, "list"),
    enabled: userId !== null,
    staleTime: 15_000,
    retry: false,
    gcTime: SENSITIVE_GC_MS,
    queryFn: () => ipc.friendsList(),
  });
}

/** Online-friend count for the top-nav badge. Keeps the shared friends list loaded and fresh while signed in. */
export function useOnlineFriendCount(pollPresence: boolean): number {
  const { userId } = useSocialSession();
  const list = useFriendsList(userId);
  usePresencePolling(userId, pollPresence);
  return list.data?.friends.filter((f) => f.presence.status !== "offline").length ?? 0;
}

export function useRequestCount(userId: number | null): UseQueryResult<number, AppError> {
  return useQuery<number, AppError>({
    queryKey: friendsKey(userId, "requestCount"),
    enabled: userId !== null,
    staleTime: 30_000,
    retry: false,
    gcTime: SENSITIVE_GC_MS,
    refetchInterval: REQUEST_COUNT_REFRESH_MS,
    refetchIntervalInBackground: false,
    queryFn: () => ipc.friendRequestsCount(),
  });
}

export function usePeople(
  userId: number | null,
  source: PeopleSource,
  keyword = "",
  enabled = true,
): UseInfiniteQueryResult<{ pages: PersonPage[]; pageParams: (string | null)[] }, AppError> {
  return useInfiniteQuery<PersonPage, AppError, { pages: PersonPage[]; pageParams: (string | null)[] }, readonly unknown[], string | null>({
    queryKey: friendsKey(userId, source, source === "search" ? keyword : undefined),
    enabled: enabled && userId !== null,
    staleTime: 15_000,
    retry: false,
    gcTime: SENSITIVE_GC_MS,
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor || undefined,
    queryFn: ({ pageParam }) => {
      if (source === "requests") return ipc.friendRequests(pageParam);
      if (source === "search") return ipc.userSearch(keyword, pageParam);
      return ipc.followList(source, pageParam);
    },
  });
}

/**
 * Presence-only refresh every 30 s, only while the document is visible and focused (plus one catch-up
 * when the window comes back). Merges into the cached friends list; nothing is persisted.
 * Returns `stale` when the last refresh failed, so the page can say live status is paused.
 */
export function usePresencePolling(userId: number | null, enabled: boolean): { stale: boolean } {
  const qc = useQueryClient();
  const [stale, setStale] = useState(false);
  const lastRun = useRef(Date.now());

  useEffect(() => {
    if (!enabled || userId === null) return;
    const key = friendsKey(userId, "list");
    let running = false;
    let cancelled = false;

    const tick = async () => {
      if (running || document.visibilityState !== "visible" || !document.hasFocus()) return;
      const current = qc.getQueryData<FriendsList>(key);
      if (!current || current.friends.length === 0 || qc.isFetching({ queryKey: key }) > 0) return;
      running = true;
      try {
        const fresh = await ipc.friendsPresence(current.friends.map((f) => f.id));
        if (cancelled) return;
        const byId = new Map<number, Presence>(fresh.map((p) => [p.userId, p]));
        qc.setQueryData<FriendsList>(key, (old) =>
          old ? { ...old, presenceError: null, friends: old.friends.map((f) => ({ ...f, presence: byId.get(f.id) ?? f.presence })) } : old,
        );
        lastRun.current = Date.now();
        setStale(false);
      } catch {
        if (!cancelled) setStale(true);
      } finally {
        running = false;
      }
    };

    const catchUp = () => {
      if (Date.now() - lastRun.current >= PRESENCE_REFRESH_MS) void tick();
    };
    const timer = setInterval(() => void tick(), PRESENCE_REFRESH_MS);
    window.addEventListener("focus", catchUp);
    document.addEventListener("visibilitychange", catchUp);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", catchUp);
      document.removeEventListener("visibilitychange", catchUp);
    };
  }, [qc, userId, enabled]);

  return { stale };
}

const DONE: Record<FriendAction, (name: string) => string> = {
  send: (n) => `Friend request sent to ${n}`,
  accept: (n) => `You and ${n} are now friends`,
  decline: (n) => `Declined ${n}'s request`,
  cancel: (n) => `Cancelled your request to ${n}`,
  unfriend: (n) => `Removed ${n} from your friends`,
  follow: (n) => `Now following ${n}`,
  unfollow: (n) => `Unfollowed ${n}`,
};

export interface FriendActions {
  /** User ids with an action in flight. */
  pending: ReadonlySet<number>;
  run: (user: SocialUser, action: FriendAction) => Promise<void>;
}

/** Runs friend/follow actions, toasts the outcome and refetches whatever is on screen. */
export function useFriendActions(userId: number | null): FriendActions {
  const qc = useQueryClient();
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const inFlight = useRef(new Set<number>());

  const run = useCallback(
    async (user: SocialUser, action: FriendAction) => {
      if (inFlight.current.has(user.id)) return;
      inFlight.current.add(user.id);
      setPending(new Set(inFlight.current));
      try {
        await ipc.friendAction(user.id, action);
        toast.success(DONE[action](user.displayName));
      } catch (e) {
        toast.error(toAppError(e).message);
      }
      // Roblox is the source of truth: refetch even after a failure (the state may have moved on).
      await qc.invalidateQueries({ queryKey: friendsKey(userId) }).catch(() => undefined);
      inFlight.current.delete(user.id);
      setPending(new Set(inFlight.current));
    },
    [qc, userId],
  );

  return { pending, run };
}

export interface JoinFriend {
  /** User id currently being joined. */
  joining: number | null;
  join: (user: SocialUser) => Promise<void>;
}

/** `join_friend`: Rust re-reads presence and builds the launch URI; this only reports the outcome. */
export function useJoinFriend(userId: number | null): JoinFriend {
  const qc = useQueryClient();
  const [joining, setJoining] = useState<number | null>(null);
  const busy = useRef(false);

  const join = useCallback(
    async (user: SocialUser) => {
      if (busy.current) return;
      busy.current = true;
      setJoining(user.id);
      try {
        await ipc.joinFriend(user.id);
        toast.success(`Handed off to Roblox — joining ${user.displayName}`);
        void useLibrary.getState().refreshHistory();
      } catch (e) {
        const err = toAppError(e);
        if (err.code === "launch_busy") toast.info("A launch is already in progress");
        else toast.error(err.message);
        // Their status probably changed under us; show the truth.
        if (err.code === "invalid_input") void qc.invalidateQueries({ queryKey: friendsKey(userId, "list") });
      } finally {
        busy.current = false;
        setJoining(null);
      }
    },
    [qc, userId],
  );

  return { joining, join };
}
