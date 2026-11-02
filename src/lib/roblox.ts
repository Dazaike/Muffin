import { useEffect, useMemo, useSyncExternalStore } from "react";
import { keepPreviousData, useInfiniteQuery, useQuery, type InfiniteData, type UseQueryResult } from "@tanstack/react-query";
import { ipc, type RbxRequest } from "./ipc";
import type { Badge, CreatorGroup, GamePass, Paged, PublicServer, SubPlace, UserHit } from "./gameExtras";
import type { AppError, GameDetails, GameSummary, ProtocolStatus } from "./types";
import type { ContinueGame } from "./dataTypes";
import { useAccount, useActiveAccountId } from "@/store/account";
import { useSettings } from "@/store/settings";

/** Sorts shown in Discover. `fun-with-friends` is excluded: it is friend-based and needs auth. */
export const DISCOVER_SORT_IDS = ["top-trending", "up-and-coming", "top-playing-now", "top-revisited"] as const;

export interface Sort {
  id: string;
  name: string;
}

const REFRESH_MS = 60_000;
const refetchWhileVisible = () => (document.visibilityState === "visible" ? REFRESH_MS : false);

// ---- raw response shapes (only the fields we read) -------------------------------------------

interface RawGame {
  universeId?: number;
  rootPlaceId?: number;
  name?: string;
  description?: string;
  playerCount?: number;
  totalUpVotes?: number;
  totalDownVotes?: number;
  genreL1?: string;
  creatorName?: string;
  contentType?: string;
  /** e.g. "Maturity: Minimal" (explore + omni-search rows only; `games.roblox.com/v1/games` has no age data). */
  ageRecommendationDisplayName?: string;
}
interface RawSearch {
  searchResults?: { contents?: RawGame[] }[];
}
interface RawSorts {
  sorts?: { sortId?: string; sortDisplayName?: string; contentType?: string }[];
}
interface RawSortContent {
  games?: RawGame[];
}
interface RawIcons {
  data?: { targetId: number; imageUrl?: string | null; state?: string }[];
}
// Verified live (games.roblox.com/v1/games?universeIds=383310974): every field below is present, e.g.
// created "2017-07-14T19:26:21.347Z", updated "2026-10-31T17:00:06.826Z", favoritedCount 29829680,
// genre_l1 "Roleplay & Avatar Sim", genre_l2 "Pet Care", maxPlayers 35,
// creator {id:295182, name:"Uplift Games", type:"Group", hasVerifiedBadge:true}.
interface RawDetails {
  data?: {
    id: number;
    rootPlaceId?: number;
    name?: string;
    description?: string | null;
    playing?: number;
    visits?: number;
    maxPlayers?: number;
    genre?: string;
    genre_l1?: string;
    genre_l2?: string;
    created?: string;
    updated?: string;
    favoritedCount?: number;
    creator?: { id?: number; name?: string; type?: string; hasVerifiedBadge?: boolean };
  }[];
}
interface RawThumbs {
  data?: { universeId: number; thumbnails?: { imageUrl?: string | null; state?: string }[] }[];
}
interface RawVotes {
  data?: { id: number; upVotes?: number; downVotes?: number }[];
}

function toSummary(g: RawGame): GameSummary | null {
  if (!g.universeId || !g.rootPlaceId || !g.name) return null;
  return {
    placeId: g.rootPlaceId,
    universeId: g.universeId,
    name: g.name,
    playerCount: g.playerCount,
    genre: g.genreL1 || undefined,
    upVotes: g.totalUpVotes,
    downVotes: g.totalDownVotes,
    description: g.description,
    creator: g.creatorName,
    maturity: g.ageRecommendationDisplayName || undefined,
  };
}

function dedupe(list: GameSummary[]): GameSummary[] {
  const seen = new Set<number>();
  return list.filter((g) => (seen.has(g.placeId) ? false : (seen.add(g.placeId), true)));
}

/** Icon URL by universeId; failures degrade to "no icon" (SmartImage placeholder) rather than failing the list. */
async function iconMap(universeIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const ids = [...new Set(universeIds)];
  for (let i = 0; i < ids.length; i += 50) {
    try {
      const res = await ipc.rbxGet<RawIcons>({ kind: "gameIcons", universeIds: ids.slice(i, i + 50) });
      for (const d of res.data ?? []) if (d.imageUrl && d.state === "Completed") out.set(d.targetId, d.imageUrl);
    } catch {
      /* icons are decoration */
    }
  }
  return out;
}

async function withIcons(games: GameSummary[]): Promise<GameSummary[]> {
  if (games.length === 0) return games;
  const icons = await iconMap(games.map((g) => g.universeId));
  return games.map((g) => ({ ...g, iconUrl: icons.get(g.universeId) }));
}

// ---- hooks ------------------------------------------------------------------------------------

/** Search experiences. Enabled once the trimmed query has ≥2 chars. Order is Roblox's. */
export function useSearch(q: string): UseQueryResult<GameSummary[], AppError> {
  const query = q.trim();
  return useQuery<GameSummary[], AppError>({
    queryKey: ["search", query],
    enabled: query.length >= 2,
    staleTime: 120_000,
    queryFn: async () => {
      const res = await ipc.rbxGet<RawSearch>({ kind: "search", query });
      const games: GameSummary[] = [];
      for (const group of res.searchResults ?? []) {
        for (const c of group.contents ?? []) {
          if (c.contentType !== "Game") continue;
          const s = toSummary(c);
          if (s) games.push(s);
        }
      }
      return withIcons(dedupe(games));
    },
  });
}

/** Sorts available for Discover (see DISCOVER_SORT_IDS), in Roblox order. */
export function useSorts(): UseQueryResult<Sort[], AppError> {
  return useQuery<Sort[], AppError>({
    queryKey: ["sorts"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await ipc.rbxGet<RawSorts>({ kind: "sorts" });
      const allowed: readonly string[] = DISCOVER_SORT_IDS;
      return (res.sorts ?? [])
        .filter((s): s is { sortId: string; sortDisplayName?: string; contentType?: string } =>
          typeof s.sortId === "string" && allowed.includes(s.sortId))
        .map((s) => ({ id: s.sortId, name: s.sortDisplayName || s.sortId }));
    },
  });
}

/** Games of one sort with icons. Refreshes player counts every 60 s while the window is visible. */
export function useSortGames(sortId: string | undefined, enabled = true): UseQueryResult<GameSummary[], AppError> {
  return useQuery<GameSummary[], AppError>({
    queryKey: ["sortGames", sortId],
    enabled: !!sortId && enabled,
    refetchInterval: refetchWhileVisible,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const res = await ipc.rbxGet<RawSortContent>({ kind: "sortContent", sortId: sortId! });
      const games = dedupe((res.games ?? []).map(toSummary).filter((g): g is GameSummary => g !== null));
      return withIcons(games);
    },
  });
}

/**
 * Full details for a place. `seed` (e.g. the clicked card's summary) supplies instant placeholder data
 * and skips the universe lookup. Check `isPlaceholderData` to know whether real data has arrived.
 */
export function useGameDetails(
  placeId: number | null,
  seed?: Partial<GameSummary>,
): UseQueryResult<GameDetails, AppError> {
  return useQuery<GameDetails, AppError>({
    queryKey: ["game", placeId],
    enabled: placeId !== null,
    staleTime: 5 * 60_000,
    placeholderData: seed?.name
      ? {
          placeId: placeId ?? 0,
          universeId: seed.universeId ?? 0,
          name: seed.name,
          iconUrl: seed.iconUrl,
          playerCount: seed.playerCount,
          genre: seed.genre,
          upVotes: seed.upVotes,
          maturity: seed.maturity,
          downVotes: seed.downVotes,
          description: seed.description ?? "",
          visits: 0,
          maxPlayers: 0,
          creator: seed.creator ?? "",
          heroUrl: seed.iconUrl,
          screenshots: [],
        }
      : undefined,
    refetchInterval: refetchWhileVisible,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      const universeId =
        seed?.universeId || (await ipc.rbxGet<{ universeId: number }>({ kind: "universeForPlace", placeId: placeId! })).universeId;
      const [details, icons, thumbs, votes] = await Promise.all([
        ipc.rbxGet<RawDetails>({ kind: "gameDetails", universeIds: [universeId] }),
        iconMap([universeId]),
        ipc.rbxGet<RawThumbs>({ kind: "gameThumbnails", universeIds: [universeId] }).catch(() => ({}) as RawThumbs),
        // Votes are not part of /v1/games, so a directly opened game (no seed) needs its own call.
        ipc.rbxGet<RawVotes>({ kind: "gameVotes", universeIds: [universeId] }).catch(() => ({}) as RawVotes),
      ]);
      const v = votes.data?.find((x) => x.id === universeId);
      const d = details.data?.[0];
      if (!d) throw { code: "parse", message: "Game not found" } satisfies AppError;
      const iconUrl = icons.get(universeId);
      const screenshots = [
        ...new Set(
          (thumbs.data?.find((t) => t.universeId === universeId)?.thumbnails ?? [])
            .filter((t) => t.state === "Completed" && t.imageUrl)
            .map((t) => t.imageUrl as string),
        ),
      ];
      return {
        placeId: d.rootPlaceId ?? placeId!,
        universeId,
        name: d.name ?? seed?.name ?? "Unknown experience",
        iconUrl,
        playerCount: d.playing,
        genre: d.genre_l1 || d.genre || seed?.genre,
        upVotes: v?.upVotes ?? seed?.upVotes,
        downVotes: v?.downVotes ?? seed?.downVotes,
        description: d.description ?? "",
        visits: d.visits ?? 0,
        maxPlayers: d.maxPlayers ?? 0,
        creator: d.creator?.name ?? "",
        maturity: seed?.maturity,
        created: d.created,
        updated: d.updated,
        favorites: d.favoritedCount,
        creatorId: d.creator?.id,
        creatorType: d.creator?.type === "Group" ? "Group" : d.creator?.type === "User" ? "User" : undefined,
        creatorVerified: d.creator?.hasVerifiedBadge === true,
        genreL2: d.genre_l2 || undefined,
        heroUrl: screenshots[0] ?? iconUrl,
        screenshots,
      };
    },
  });
}

/** Avatar headshot URL for a Roblox user id (undefined until loaded / when unavailable). */
export function useHeadshot(userId: string | number | null | undefined): UseQueryResult<string | undefined, AppError> {
  const id = userId === null || userId === undefined ? NaN : Number(userId);
  return useQuery<string | undefined, AppError>({
    queryKey: ["headshot", id],
    enabled: Number.isSafeInteger(id) && id > 0,
    staleTime: 60 * 60_000,
    queryFn: async () => {
      const res = await ipc.rbxGet<RawIcons>({ kind: "headshots", userIds: [id] });
      const d = res.data?.[0];
      return d?.state === "Completed" && d.imageUrl ? d.imageUrl : undefined;
    },
  });
}

/** Roblox protocol-handler detection. `refetch()` is the "Re-check" action. */
export function useRobloxStatus(): UseQueryResult<ProtocolStatus, AppError> {
  return useQuery<ProtocolStatus, AppError>({
    queryKey: ["robloxStatus"],
    staleTime: 0,
    gcTime: 0,
    queryFn: () => ipc.robloxStatus(),
  });
}

/**
 * Roblox's own Continue row for the active account (read-only). Runs only when the setting is on and
 * a Roblox web session is active and not expired. Failures are silent: `data` stays undefined and
 * Home just shows Muffin's own history. Re-keyed per account, so switching accounts refetches.
 */
export function useRobloxContinue(): UseQueryResult<ContinueGame[], AppError> {
  const accountId = useActiveAccountId();
  const expired = useAccount((s) => s.accounts.find((a) => a.userId === s.activeUserId)?.expired ?? false);
  const on = useSettings((s) => s.values.continueFromRoblox);
  return useQuery<ContinueGame[], AppError>({
    queryKey: ["roblox-account", "continue", accountId],
    enabled: on && accountId !== null && !expired,
    staleTime: 2 * 60_000,
    retry: false,
    queryFn: () => ipc.robloxContinue(),
  });
}

type IconWant = { placeId: number; universeId: number | null };

/** Picture URLs by place id, found through the universe id (looked up from the place when it's unknown). */
async function lookupIcons(missing: IconWant[]): Promise<Record<number, string>> {
  const universes = new Map<number, number>();
  await Promise.all(
    missing.map(async (g) => {
      try {
        const universeId =
          g.universeId || (await ipc.rbxGet<{ universeId: number }>({ kind: "universeForPlace", placeId: g.placeId })).universeId;
        if (universeId) universes.set(g.placeId, universeId);
      } catch {
        /* pictures are decoration */
      }
    }),
  );
  const byUniverse = await iconMap([...universes.values()]);
  const out: Record<number, string> = {};
  for (const [placeId, universeId] of universes) {
    const url = byUniverse.get(universeId);
    if (url) out[placeId] = url;
  }
  return out;
}

// Any card, on any page, whose game has no picture asks here. Requests made in the same moment go out as one lookup.
const cardIcons = new Map<number, string | null>();
const cardWanted = new Map<number, IconWant>();
const cardListeners = new Set<() => void>();
let cardTimer: ReturnType<typeof setTimeout> | undefined;

function flushCardIcons() {
  cardTimer = undefined;
  const batch = [...cardWanted.values()];
  cardWanted.clear();
  void lookupIcons(batch)
    .then((found) => {
      for (const g of batch) cardIcons.set(g.placeId, found[g.placeId] ?? null);
    })
    .catch(() => {
      for (const g of batch) cardIcons.set(g.placeId, null);
    })
    .finally(() => cardListeners.forEach((l) => l()));
}

/** The game, with its picture looked up (and cached for the session) when it was saved without one. */
export function useCardGame<T extends { placeId: number; universeId?: number | null; iconUrl?: string | null }>(game: T): T {
  const url = useSyncExternalStore(
    (l) => {
      cardListeners.add(l);
      return () => cardListeners.delete(l);
    },
    () => cardIcons.get(game.placeId),
  );
  useEffect(() => {
    if (game.iconUrl || cardIcons.has(game.placeId) || cardWanted.has(game.placeId)) return;
    cardIcons.set(game.placeId, null);
    cardWanted.set(game.placeId, { placeId: game.placeId, universeId: game.universeId ?? null });
    cardTimer ??= setTimeout(flushCardIcons, 60);
  }, [game.iconUrl, game.placeId, game.universeId]);
  return game.iconUrl || !url ? game : { ...game, iconUrl: url };
}

/**
 * Games saved without a picture (older launches, some Roblox Continue items) get their icon looked up
 * by universe id, or by place id when that is missing too. Games that already have one pass through.
 */
export function useFilledIcons<T extends { placeId: number; universeId?: number | null; iconUrl?: string | null }>(games: T[]): T[] {
  const missing = useMemo(
    () => games.filter((g) => !g.iconUrl).map((g) => ({ placeId: g.placeId, universeId: g.universeId ?? null })),
    [games],
  );
  const key = missing.map((g) => g.placeId).sort((a, b) => a - b).join(",");
  const icons = useQuery<Record<number, string>, AppError>({
    queryKey: ["game-icons", key],
    enabled: missing.length > 0,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: () => lookupIcons(missing),
  });
  return useMemo(
    () => (icons.data ? games.map((g) => (g.iconUrl ? g : { ...g, iconUrl: icons.data[g.placeId] ?? g.iconUrl })) : games),
    [games, icons.data],
  );
}

// ---- game details extras (lazy: each hook takes `enabled` so a tab only loads when opened) -----

interface RawServers {
  nextPageCursor?: string | null;
  data?: { id?: string; playing?: number; maxPlayers?: number; fps?: number; ping?: number }[];
}
interface RawBadges {
  nextPageCursor?: string | null;
  data?: {
    id: number;
    name?: string;
    displayName?: string;
    description?: string | null;
    displayDescription?: string | null;
    statistics?: { pastDayAwardedCount?: number; awardedCount?: number; winRatePercentage?: number };
  }[];
}
interface RawPasses {
  nextPageToken?: string | null;
  gamePasses?: {
    id: number;
    name?: string;
    displayName?: string;
    displayDescription?: string | null;
    price?: number | null;
    isForSale?: boolean;
    /** Real ownership only with a session; guests always get `false` (verified live). */
    isOwned?: boolean;
  }[];
}
// Verified live (groups.roblox.com/v1/groups/295182): {id, name, memberCount: 14910479, hasVerifiedBadge: true,
// owner: {userId, username, displayName, hasVerifiedBadge} | null, publicEntryAllowed, …}.
interface RawGroup {
  id?: number;
  name?: string;
  memberCount?: number;
  hasVerifiedBadge?: boolean;
  owner?: { displayName?: string; username?: string } | null;
}
interface RawPlaces {
  nextPageCursor?: string | null;
  data?: { id: number; name?: string; description?: string | null }[];
}
interface RawAutocomplete {
  entries?: { searchQuery?: string }[];
}
interface RawUsers {
  data?: { id: number; name?: string; displayName?: string; hasVerifiedBadge?: boolean }[];
}

/** Image URL by target id for one of the thumbnail endpoints; failures just mean "no icon". */
async function imageMap(req: RbxRequest): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const res = await ipc.rbxGet<RawIcons>(req);
    for (const d of res.data ?? []) if (d.imageUrl && d.state === "Completed") out.set(d.targetId, d.imageUrl);
  } catch {
    /* icons are decoration */
  }
  return out;
}

/** Cursor-paged list query with `AppError` errors; `queryFn` receives the cursor (null for the first page). */
function usePaged<T>(opts: {
  queryKey: readonly unknown[];
  enabled: boolean;
  staleTime: number;
  queryFn: (cursor: string | null) => Promise<Paged<T>>;
}) {
  return useInfiniteQuery<Paged<T>, AppError, InfiniteData<Paged<T>>, readonly unknown[], string | null>({
    queryKey: opts.queryKey,
    enabled: opts.enabled,
    staleTime: opts.staleTime,
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor || undefined,
    queryFn: ({ pageParam }) => opts.queryFn(pageParam),
  });
}

/** Public servers, newest list first page; `fetchNextPage` follows Roblox's cursor. */
export function usePublicServers(placeId: number | null, enabled: boolean) {
  return usePaged<PublicServer>({
    queryKey: ["servers", placeId],
    enabled: enabled && placeId !== null,
    staleTime: 20_000,
    queryFn: async (pageParam) => {
      const res = await ipc.rbxGet<RawServers>({ kind: "publicServers", placeId: placeId!, cursor: pageParam });
      const items: PublicServer[] = [];
      for (const s of res.data ?? []) {
        if (!s.id || typeof s.playing !== "number" || typeof s.maxPlayers !== "number") continue;
        items.push({ id: s.id, playing: s.playing, maxPlayers: s.maxPlayers, fps: s.fps, ping: s.ping });
      }
      return { items, nextCursor: res.nextPageCursor ?? null };
    },
  });
}

/** Badges of a universe with icons, win rate (Roblox's "rarity") and award counts. */
export function useUniverseBadges(universeId: number | null, enabled: boolean) {
  return usePaged<Badge>({
    queryKey: ["badges", universeId],
    enabled: enabled && !!universeId,
    staleTime: 5 * 60_000,
    queryFn: async (pageParam) => {
      const res = await ipc.rbxGet<RawBadges>({ kind: "universeBadges", universeId: universeId!, cursor: pageParam });
      const rows = res.data ?? [];
      const icons = rows.length
        ? await imageMap({ kind: "badgeIcons", badgeIds: rows.map((b) => b.id) })
        : new Map<number, string>();
      return {
        items: rows.map((b) => ({
          id: b.id,
          name: b.displayName || b.name || "Badge",
          description: b.displayDescription ?? b.description ?? "",
          iconUrl: icons.get(b.id),
          awardedCount: b.statistics?.awardedCount ?? 0,
          // Roblox reports a 0–1 fraction (0.003 = 0.3%).
          winRate: (b.statistics?.winRatePercentage ?? 0) * 100,
          pastDayAwarded: b.statistics?.pastDayAwardedCount ?? 0,
        })),
        nextCursor: res.nextPageCursor ?? null,
      };
    },
  });
}

/** The signed-in web-session user id (or null for guests); local to the hooks below. */
function useSessionUserId(): number | null {
  return useAccount((s) => (s.status?.signedIn && s.status.user ? s.status.user.id : null));
}

/**
 * Game passes of a universe (view only) with icons, Robux price and, when signed in, ownership. The signed-in
 * request returns Roblox's real `isOwned`; if it fails the public list is used and `owned` stays null.
 */
export function useGamePasses(universeId: number | null, enabled: boolean) {
  const userId = useSessionUserId();
  return usePaged<GamePass>({
    queryKey: ["passes", universeId, userId],
    enabled: enabled && !!universeId,
    staleTime: 5 * 60_000,
    queryFn: async (pageParam) => {
      let res: RawPasses | undefined;
      let withOwnership = false;
      if (userId !== null) {
        try {
          res = (await ipc.gamePassesSession(universeId!, pageParam)) as RawPasses;
          withOwnership = true;
        } catch {
          /* fall back to the public list below */
        }
      }
      res ??= await ipc.rbxGet<RawPasses>({ kind: "gamePasses", universeId: universeId!, pageToken: pageParam });
      const rows = res.gamePasses ?? [];
      const icons = rows.length
        ? await imageMap({ kind: "gamePassIcons", passIds: rows.map((p) => p.id) })
        : new Map<number, string>();
      return {
        items: rows.map((p) => ({
          id: p.id,
          name: p.displayName || p.name || "Game pass",
          description: p.displayDescription ?? "",
          iconUrl: icons.get(p.id),
          price: typeof p.price === "number" ? p.price : null,
          forSale: p.isForSale === true,
          owned: withOwnership ? p.isOwned === true : null,
        })),
        nextCursor: res.nextPageToken || null,
      };
    },
  });
}

/** Every place in a universe (root place flagged) with icons. */
export function useUniversePlaces(universeId: number | null, rootPlaceId: number, enabled: boolean) {
  return usePaged<SubPlace>({
    queryKey: ["places", universeId],
    enabled: enabled && !!universeId,
    staleTime: 5 * 60_000,
    queryFn: async (pageParam) => {
      const res = await ipc.rbxGet<RawPlaces>({ kind: "universePlaces", universeId: universeId!, cursor: pageParam });
      const rows = res.data ?? [];
      const icons = rows.length
        ? await imageMap({ kind: "placeIcons", placeIds: rows.map((p) => p.id) })
        : new Map<number, string>();
      return {
        items: rows.map((p) => ({
          placeId: p.id,
          name: p.name || "Place",
          description: p.description ?? "",
          iconUrl: icons.get(p.id),
          isRoot: p.id === rootPlaceId,
        })),
        nextCursor: res.nextPageCursor ?? null,
      };
    },
  });
}

/** Group (community) info and icon for a group-owned experience: name, member count, verified badge. */
export function useCreatorGroup(groupId: number | null) {
  return useQuery<CreatorGroup, AppError>({
    queryKey: ["creatorGroup", groupId],
    enabled: groupId !== null && groupId > 0,
    staleTime: 10 * 60_000,
    retry: false,
    queryFn: async () => {
      const [g, icons] = await Promise.all([
        ipc.rbxGet<RawGroup>({ kind: "groupInfo", groupId: groupId! }),
        imageMap({ kind: "groupIcons", groupIds: [groupId!] }),
      ]);
      if (!g.name) throw { code: "parse", message: "Group not found" } satisfies AppError;
      return {
        id: groupId!,
        name: g.name,
        memberCount: typeof g.memberCount === "number" ? g.memberCount : null,
        verified: g.hasVerifiedBadge === true,
        ownerName: g.owner?.displayName || g.owner?.username || undefined,
        iconUrl: icons.get(groupId!),
      };
    },
  });
}

/**
 * Roblox's "more like this" strip. Roblox returns an empty list to guests (verified), so this only runs with a
 * web session and the rows are UNVERIFIED live; an empty or failed result simply hides the strip.
 */
export function useRecommendedGames(universeId: number | null): UseQueryResult<GameSummary[], AppError> {
  const userId = useSessionUserId();
  return useQuery<GameSummary[], AppError>({
    queryKey: ["recommended", universeId, userId],
    enabled: !!universeId && userId !== null,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async () => {
      const rows = await ipc.gameRecommendations(universeId!);
      const games = dedupe(
        rows
          .filter((r) => r.universeId !== universeId)
          .map((r) => ({
            placeId: r.placeId,
            universeId: r.universeId,
            name: r.name,
            playerCount: r.playerCount ?? undefined,
            upVotes: r.upVotes ?? undefined,
            downVotes: r.downVotes ?? undefined,
            creator: r.creator ?? undefined,
          })),
      );
      return withIcons(games);
    },
  });
}

/**
 * Content-maturity label ("Maturity: Minimal"). `games.roblox.com/v1/games` carries no age data and the
 * experience-guidelines endpoint 404s unauthenticated (verified), so a game opened without a card seed finds
 * its row in omni-search (the same rows Home uses) by name + universe id. Absent → undefined → hidden.
 */
export function useMaturity(game: { universeId: number; name: string; maturity?: string }, enabled: boolean): string | undefined {
  const name = Array.from(game.name.trim()).slice(0, 100).join("");
  const lookup = useQuery<string | null, AppError>({
    queryKey: ["maturity", game.universeId],
    enabled: enabled && !game.maturity && game.universeId > 0 && name.length > 0,
    staleTime: 30 * 60_000,
    retry: false,
    queryFn: async () => {
      const res = await ipc.rbxGet<RawSearch>({ kind: "search", query: name });
      for (const group of res.searchResults ?? []) {
        for (const c of group.contents ?? []) {
          if (c.universeId === game.universeId) return c.ageRecommendationDisplayName || null;
        }
      }
      return null;
    },
  });
  return game.maturity ?? lookup.data ?? undefined;
}

/** Roblox's search suggestions for what the user is typing. Pass an already-debounced prefix. */
export function useAutocomplete(prefix: string, enabled = true): UseQueryResult<string[], AppError> {
  const p = prefix.trim();
  return useQuery<string[], AppError>({
    queryKey: ["autocomplete", p.toLowerCase()],
    enabled: enabled && p.length >= 2,
    staleTime: 120_000,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const res = await ipc.rbxGet<RawAutocomplete>({ kind: "autocomplete", prefix: p });
      const out: string[] = [];
      for (const e of res.entries ?? []) {
        const s = e.searchQuery?.trim();
        if (s && !out.includes(s)) out.push(s);
      }
      return out.slice(0, 8);
    },
  });
}

/** User search (display only). Roblox rejects keywords shorter than 3 characters. */
export function useUserSearch(keyword: string): UseQueryResult<(UserHit & { avatarUrl?: string })[], AppError> {
  const k = keyword.trim();
  return useQuery<(UserHit & { avatarUrl?: string })[], AppError>({
    queryKey: ["userSearch", k.toLowerCase()],
    enabled: k.length >= 3,
    staleTime: 120_000,
    retry: false,
    queryFn: async () => {
      const res = await ipc.rbxGet<RawUsers>({ kind: "userSearch", keyword: k });
      const users = (res.data ?? []).filter((u) => u.id > 0 && u.name);
      if (users.length === 0) return [];
      const heads = await ipc
        .rbxGet<RawIcons>({ kind: "headshots", userIds: users.map((u) => u.id) })
        .catch(() => ({}) as RawIcons);
      const avatars = new Map<number, string>();
      for (const d of heads.data ?? []) if (d.imageUrl && d.state === "Completed") avatars.set(d.targetId, d.imageUrl);
      return users.map((u) => ({
        id: u.id,
        name: u.name!,
        displayName: u.displayName || u.name!,
        verified: u.hasVerifiedBadge === true,
        avatarUrl: avatars.get(u.id),
      }));
    },
  });
}
