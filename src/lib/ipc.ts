// The ONLY module allowed to import from @tauri-apps/*. Typed wrappers over invoke.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  disable as autostartDisable,
  enable as autostartEnable,
  isEnabled as autostartIsEnabled,
} from "@tauri-apps/plugin-autostart";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type {
  AppError,
  AccountStatus,
  AccountData,
  AccountSection,
  AccountsList,
  DataSummary,
  ErrorCode,
  HistoryEntry,
  LaunchResult,
  LibraryEntry,
  LibraryUpsert,
  PrivateServer,
  NotifierNotice,
  NotifierStatus,
  ProtocolStatus,
} from "./types";
import type { BackgroundInfo, BackgroundMeta } from "./types";
import type { AwardedBadge, RecommendedGame, SocialLink, VoteState } from "./gameExtras";
import type {
  OwnedServer,
  PurchaseResult,
  ServerDetail,
  ServerSettings,
  TransactionPage,
  TxKind,
} from "./economy";
import type { FollowKind, FriendAction, FriendsList, PersonPage, Presence } from "./socialTypes";
import type {
  ApplyFavoritesResult,
  ContinueGame,
  ExportResult,
  FavoritesDiff,
  ImportMode,
  ImportPreview,
  ImportResult,
  PlayerState,
  PlaytimeRange,
  PlaytimeSession,
  PlaytimeSummary,
} from "./dataTypes";

const CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "invalid_input",
  "not_installed",
  "launch_failed",
  "launch_busy",
  "network",
  "rate_limited",
  "http_status",
  "parse",
  "storage",
  "auth_denied",
  "auth_expired",
  "auth_failed",
]);

/** Normalize anything thrown by invoke / plugins into `{code,message}`. */
export function toAppError(e: unknown): AppError {
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    if (typeof o.message === "string") {
      const code = typeof o.code === "string" && CODES.has(o.code) ? (o.code as ErrorCode) : "unknown";
      return { code, message: o.message };
    }
  }
  if (typeof e === "string") return { code: "unknown", message: e };
  return { code: "unknown", message: "Something went wrong" };
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toAppError(e);
  }
}

export type RbxRequest =
  | { kind: "search"; query: string }
  | { kind: "sorts" }
  | { kind: "sortContent"; sortId: string }
  | { kind: "universeForPlace"; placeId: number }
  | { kind: "gameDetails"; universeIds: number[] }
  | { kind: "gameMedia"; universeId: number }
  | { kind: "gameIcons"; universeIds: number[] }
  | { kind: "gameThumbnails"; universeIds: number[] }
  | { kind: "headshots"; userIds: number[] }
  // game details extras (public)
  | { kind: "publicServers"; placeId: number; cursor?: string | null }
  | { kind: "gameVotes"; universeIds: number[] }
  | { kind: "universeBadges"; universeId: number; cursor?: string | null }
  | { kind: "badgeIcons"; badgeIds: number[] }
  | { kind: "gamePasses"; universeId: number; pageToken?: string | null }
  | { kind: "gamePassIcons"; passIds: number[] }
  | { kind: "universePlaces"; universeId: number; cursor?: string | null }
  | { kind: "placeIcons"; placeIds: number[] }
  // search extras
  | { kind: "autocomplete"; prefix: string }
  | { kind: "userSearch"; keyword: string }
  | { kind: "groupInfo"; groupId: number }
  | { kind: "groupIcons"; groupIds: number[] };

export interface LaunchExperienceArgs {
  placeId: number;
  universeId?: number | null;
  name: string;
  iconUrl?: string | null;
  genre?: string | null;
}

export const windowControls = {
  minimize: () => getCurrentWindow().minimize(),
  toggleMaximize: () => getCurrentWindow().toggleMaximize(),
  close: () => getCurrentWindow().close(),
  isMaximized: () => getCurrentWindow().isMaximized(),
  /** Subscribe to resize events; returns an unsubscribe function. */
  onResized: async (cb: () => void): Promise<() => void> => getCurrentWindow().onResized(cb),
  isFocused: () => getCurrentWindow().isFocused(),
  show: () => getCurrentWindow().show(),
  hide: () => getCurrentWindow().hide(),
  setFocus: () => getCurrentWindow().setFocus(),
};

export const autostart = {
  isEnabled: (): Promise<boolean> => autostartIsEnabled(),
  set: async (on: boolean): Promise<void> => {
    if (on) await autostartEnable();
    else await autostartDisable();
  },
};

export const notify = {
  /** Sends a native notification; silently does nothing if permission is denied. */
  send: async (title: string, body?: string): Promise<void> => {
    try {
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
    } catch {
      /* notifications are best-effort */
    }
  },
};

export const ipc = {
  rbxGet: <T = unknown>(req: RbxRequest) => call<T>("rbx_get", { req }),
  robloxStatus: () => call<ProtocolStatus>("roblox_status"),
  launchExperience: (a: LaunchExperienceArgs) =>
    call<LaunchResult>("launch_experience", {
      placeId: a.placeId,
      universeId: a.universeId ?? null,
      name: a.name,
      iconUrl: a.iconUrl ?? null,
      genre: a.genre ?? null,
    }),
  launchPrivateServer: (serverId: number) => call<LaunchResult>("launch_private_server", { serverId }),
  launchInstance: (a: LaunchExperienceArgs & { instanceId: string }) =>
    call<LaunchResult>("launch_instance", {
      placeId: a.placeId,
      instanceId: a.instanceId,
      universeId: a.universeId ?? null,
      name: a.name,
      iconUrl: a.iconUrl ?? null,
      genre: a.genre ?? null,
    }),
  gameVoteState: (universeId: number) => call<VoteState>("game_vote_state", { universeId }),
  gameVote: (universeId: number, up: boolean) => call<VoteState>("game_vote", { universeId, up }),
  badgesAwarded: (badgeIds: number[]) => call<AwardedBadge[]>("badges_awarded", { badgeIds }),
  gameSocialLinks: (universeId: number) => call<SocialLink[]>("game_social_links", { universeId }),
  /** Roblox's "more like this" list; needs the web session (guests get an empty list from Roblox). */
  gameRecommendations: (universeId: number) => call<RecommendedGame[]>("game_recommendations", { universeId }),
  /** One page of game passes with the active account's `isOwned` flags (raw Roblox JSON). */
  gamePassesSession: (universeId: number, pageToken: string | null) =>
    call<unknown>("game_passes_session", { universeId, pageToken }),
  /** Opens an https link on an allowlisted host (Roblox + social sites) in the default browser. */
  openExternal: (url: string) => call<null>("open_external", { url }),
  addPrivateServer: (placeId: number, label: string | undefined, link: string) =>
    call<PrivateServer>("add_private_server", { placeId, label, link }),
  listPrivateServers: (placeId: number) => call<PrivateServer[]>("list_private_servers", { placeId }),
  renamePrivateServer: (id: number, label: string) => call<PrivateServer>("rename_private_server", { id, label }),
  removePrivateServer: (id: number) => call<null>("remove_private_server", { id }),

  libraryList: () => call<LibraryEntry[]>("library_list"),
  libraryUpsert: (entry: LibraryUpsert) => call<LibraryEntry>("library_upsert", { entry }),
  libraryRemove: (placeId: number) => call<null>("library_remove", { placeId }),
  librarySetFlags: (placeId: number, flags: { favorite?: boolean; pinned?: boolean }) =>
    call<null>("library_set_flags", { placeId, ...flags }),
  libraryReorder: (placeIds: number[]) => call<null>("library_reorder", { placeIds }),
  historyList: (limit = 200) => call<HistoryEntry[]>("history_list", { limit }),
  historyClear: () => call<null>("history_clear"),
  searchesList: () => call<string[]>("searches_list"),
  searchesAdd: (q: string) => call<null>("searches_add", { q }),
  searchesRemove: (q: string) => call<null>("searches_remove", { q }),
  searchesClear: () => call<null>("searches_clear"),

  settingsGetAll: () => call<Record<string, unknown>>("settings_get_all"),
  settingsSet: (key: string, value: unknown) => call<null>("settings_set", { key, value }),
  cacheClear: () => call<null>("cache_clear"),
  dataSummary: () => call<DataSummary>("data_summary"),
  appReady: () => call<null>("app_ready"),

  accountStatus: () => call<AccountStatus>("account_status"),
  accountSignOut: () => call<AccountsList>("account_sign_out"),
  // -- multi-account (active account = the one every account-scoped command acts as)
  accountsList: () => call<AccountsList>("accounts_list"),
  /** Opens the isolated Roblox login window; the account that signs in is ADDED and becomes active. */
  accountAdd: () => call<AccountsList>("account_add"),
  accountSwitch: (userId: number) => call<AccountsList>("account_switch", { userId }),
  accountRemove: (userId: number) => call<AccountsList>("account_remove", { userId }),
  onAccountChanged: (cb: (userId: number | null) => void): Promise<() => void> =>
    listen<{ userId: number | null }>("account-changed", (e) => cb(e.payload.userId)),
  onAccountExpired: (cb: (userId: number) => void): Promise<() => void> =>
    listen<{ userId: number }>("account-expired", (e) => cb(e.payload.userId)),
  accountData: (section: AccountSection, cursor?: string | null) =>
    call<AccountData>("account_data", { section, cursor: cursor ?? null }),

  // -- background notifications
  notifierStatus: () => call<NotifierStatus>("notifier_status"),
  /** Subscribes to the one-shot notice the poller emits when it stops (e.g. session expired). */
  onNotifierNotice: (cb: (n: NotifierNotice) => void): Promise<() => void> =>
    listen<NotifierNotice>("notifier-notice", (e) => cb(e.payload)),

  // -- economy: Robux history + private servers
  economyBalance: () => call<number>("economy_balance"),
  economyTransactions: (kind: TxKind, cursor?: string | null, limit?: number) =>
    call<TransactionPage>("economy_transactions", { kind, cursor: cursor ?? null, limit: limit ?? null }),
  privateServerSettings: (universeId: number) => call<ServerSettings>("private_server_settings", { universeId }),
  privateServersOwned: (universeId: number) => call<OwnedServer[]>("private_servers_owned", { universeId }),
  privateServerDetail: (serverId: number) => call<ServerDetail>("private_server_detail", { serverId }),
  privateServerRename: (serverId: number, name: string) => call<ServerDetail>("private_server_rename", { serverId, name }),
  privateServerRegenerateLink: (serverId: number) => call<ServerDetail>("private_server_regenerate_link", { serverId }),
  privateServerSetActive: (serverId: number, active: boolean) =>
    call<ServerDetail>("private_server_set_active", { serverId, active }),
  privateServerCancelSubscription: (serverId: number) =>
    call<ServerDetail>("private_server_cancel_subscription", { serverId }),
  /** Spends Robux. Rust refuses unless `expectedPrice` equals the live price. */
  privateServerPurchase: (universeId: number, name: string, expectedPrice: number) =>
    call<PurchaseResult>("private_server_purchase", { universeId, name, expectedPrice }),

  // -- social: friends, presence, follow graph, user search, join friend
  friendsList: () => call<FriendsList>("friends_list"),
  friendsPresence: (userIds: number[]) => call<Presence[]>("friends_presence", { userIds }),
  friendRequests: (cursor?: string | null) => call<PersonPage>("friend_requests", { cursor: cursor ?? null }),
  friendRequestsCount: () => call<number>("friend_requests_count"),
  followList: (kind: FollowKind, cursor?: string | null) =>
    call<PersonPage>("follow_list", { kind, cursor: cursor ?? null }),
  userSearch: (keyword: string, cursor?: string | null) =>
    call<PersonPage>("user_search", { keyword, cursor: cursor ?? null }),
  friendAction: (userId: number, action: FriendAction) => call<null>("friend_action", { userId, action }),
  /** Rust re-reads the friend's presence and builds the roblox:// URI itself. */
  joinFriend: (userId: number) => call<LaunchResult>("join_friend", { userId }),

  // -- playtime, import/export, Roblox favorites import
  playtimeSummary: (range: PlaytimeRange) =>
    call<PlaytimeSummary>("playtime_summary", { range, utcOffsetMinutes: -new Date().getTimezoneOffset() }),
  playtimeSessions: (limit = 100) => call<PlaytimeSession[]>("playtime_sessions", { limit }),
  playtimeClear: () => call<null>("playtime_clear"),
  playtimeState: () => call<PlayerState>("playtime_state"),
  onPlayerState: (cb: (s: PlayerState) => void): Promise<() => void> =>
    listen<PlayerState>("player-state", (e) => cb(e.payload)),
  /** Opens the native save dialog; resolves null when cancelled. */
  exportData: () => call<ExportResult | null>("export_data"),
  /** Opens the native file dialog and stages the file; resolves null when cancelled. */
  importPick: () => call<ImportPreview | null>("import_pick"),
  importApply: (mode: ImportMode) => call<ImportResult>("import_apply", { mode }),
  importDiscard: () => call<null>("import_discard"),
  syncRobloxFavorites: () => call<FavoritesDiff>("sync_roblox_favorites"),
  applyRobloxFavorites: (addToLibrary: boolean, markFavorite: boolean) =>
    call<ApplyFavoritesResult>("apply_roblox_favorites", { addToLibrary, markFavorite }),
  /** Read-only: the account's Roblox Continue row (≤ 24, Roblox's order, no timestamps). */
  robloxContinue: () => call<ContinueGame[]>("roblox_continue"),

  // -- custom app background image (file paths never cross IPC)
  /** Opens the native image dialog and stores the choice; resolves null when cancelled. */
  backgroundPick: () => call<BackgroundMeta | null>("background_pick"),
  backgroundInfo: () => call<BackgroundInfo>("background_info"),
  /** Raw image bytes (binary IPC response). */
  backgroundRead: () => call<ArrayBuffer>("background_read"),
  backgroundClear: () => call<null>("background_clear"),
};
