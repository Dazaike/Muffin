// Shared types. Rust-facing shapes mirror local muffin-contract (camelCase).

export type ErrorCode =
  | "invalid_input"
  | "not_installed"
  | "launch_failed"
  | "launch_busy"
  | "network"
  | "rate_limited"
  | "http_status"
  | "parse"
  | "storage"
  | "auth_denied"
  | "auth_expired"
  | "auth_failed"
  | "unknown";

export interface AppError {
  code: ErrorCode;
  message: string;
}

export interface GameSummary {
  placeId: number;
  universeId: number;
  name: string;
  iconUrl?: string;
  playerCount?: number;
  genre?: string;
  upVotes?: number;
  downVotes?: number;
  description?: string;
  creator?: string;
  /** Roblox's content-maturity label as shown on the site, e.g. "Maturity: Minimal". */
  maturity?: string;
}

export interface GameDetails extends GameSummary {
  description: string;
  visits: number;
  maxPlayers: number;
  creator: string;
  heroUrl?: string;
  screenshots: string[];
  /** ISO timestamps from `games.roblox.com/v1/games`. */
  created?: string;
  updated?: string;
  /** Total favorites (`favoritedCount`). */
  favorites?: number;
  creatorId?: number;
  creatorType?: "User" | "Group";
  creatorVerified?: boolean;
  /** Second-level genre ("Pet Care"); `genre` holds the first level. */
  genreL2?: string;
}

export interface LibraryEntry {
  placeId: number;
  universeId?: number | null;
  name: string;
  iconUrl?: string | null;
  creator?: string | null;
  genre?: string | null;
  favorite: boolean;
  pinned: boolean;
  addedAt: number;
  position: number;
}

/** Payload for `library_upsert`. addedAt/position only set when restoring a removed row. */
export interface LibraryUpsert {
  placeId: number;
  universeId?: number | null;
  name: string;
  iconUrl?: string | null;
  creator?: string | null;
  genre?: string | null;
  favorite: boolean;
  pinned: boolean;
  addedAt?: number;
  position?: number;
}

export interface HistoryEntry {
  placeId: number;
  universeId?: number | null;
  name: string;
  iconUrl?: string | null;
  genre?: string | null;
  lastLaunchedAt: number;
  launchCount: number;
}

export interface PrivateServer {
  id: number;
  placeId: number;
  label: string;
  code: string;
  kind: string;
  createdAt: number;
}

export type HandlerKind = "roblox" | "bloxstrap" | "fishstrap" | "other" | "none";

export interface ProtocolStatus {
  registered: boolean;
  command?: string | null;
  exePath?: string | null;
  exeExists: boolean;
  handler: HandlerKind;
}

export type FishstrapSettingValue = boolean | number | string | null | unknown[];

export interface FishstrapSetting {
  key: string;
  value: FishstrapSettingValue;
}

export interface FishstrapLaunchStep {
  label: string;
  state: "pending" | "active" | "done";
}

export interface FishstrapLaunchProgress {
  phase: "running" | "done" | "failed" | "cancelled";
  message: string;
  steps: FishstrapLaunchStep[];
  packagesDownloaded: number;
  downloadedBytes: number;
}

export interface FishstrapStatus {
  installed: boolean;
  dir?: string | null;
  installedVersion?: string | null;
  channel?: string | null;
  fishstrapRunning: boolean;
  playerRunning: boolean;
}

export interface FastFlag {
  name: string;
  value: string;
}

export interface ModEntry {
  name: string;
  isDir: boolean;
  size: number;
}

export interface ModsInfo {
  path: string;
  entries: ModEntry[];
}

export interface CleanupResult {
  removed: number;
  freedBytes: number;
}

export interface AccountUser {
  id: number;
  displayName: string;
  username: string;
  avatarUrl?: string | null;
}

export interface AccountStatus {
  signedIn: boolean;
  /** The active account's Roblox session was rejected: it needs a fresh login. */
  expired?: boolean;
  user?: AccountUser | null;
}

/** One saved Roblox account (no secrets; the cookie stays in the OS credential store). */
export interface AccountSummary {
  userId: number;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  addedAt: number;
  expired: boolean;
}

export interface AccountsList {
  accounts: AccountSummary[];
  activeUserId: number | null;
}
export type AccountSection = "robux" | "friends" | "created" | "saved";

export interface AccountData {
  robux?: number | null;
  items: { id: number; name: string; displayName?: string | null; placeId?: number | null; universeId?: number | null; iconUrl?: string | null }[];
  nextCursor?: string | null;
}

export interface DataSummary {
  libraryCount: number;
  historyCount: number;
  searchCount: number;
  cacheRows: number;
  dbBytes: number;
}

export interface LaunchResult {
  handedOff: true;
}

export interface Settings {
  /** Accent colour as an HSL-style hue angle, 0–359. */
  accentHue: number;
  /** App background colour as `#rrggbb` (independent of the accent). */
  backgroundColor: string;
  density: "comfortable" | "compact";
  animationIntensity: "full" | "reduced" | "off";
  reduceMotion: boolean;
  lightweightMode: boolean;
  startMinimized: boolean;
  autoStart: boolean;
  closeBehavior: "quit" | "tray";
  afterLaunch: "nothing" | "tray" | "quit";
  fishstrapPrompt: "ask" | "declined";
  showRobux: boolean;
  notifications: boolean;
  continueFromRoblox: boolean;
  notifyMessages: boolean;
  notifyFriendRequests: boolean;
  notifyFriendsOnline: boolean;
  notifyOnlyWhenHidden: boolean;
  globalShortcut: boolean;
  hideFishstrap: boolean;
  libraryView: "grid" | "list";
  friendsView: "grid" | "list";
  searchView: "grid" | "list";
  cardShape: "portrait" | "square";
  discoverView: "grid" | "list";
  /** Discover grid view: vertical poster cards or horizontal icon-left tiles. */
  discoverCards: "vertical" | "horizontal";
  favoritesView: "grid" | "list";
  recentView: "grid" | "list";
  playtimeView: "grid" | "list";
  walletView: "grid" | "list";
  profileView: "grid" | "list";
  peopleView: "grid" | "list";
  serversView: "grid" | "list";
  badgesView: "grid" | "list";
  passesView: "grid" | "list";
  placesView: "grid" | "list";
  librarySort: "name" | "lastPlayed" | "added" | "custom";
  onboarded: boolean;
  /** A custom background image is active (the file itself lives in the app data folder). */
  backgroundImage: boolean;
  /** Dark overlay over the image, percent 0–90. */
  backgroundDim: number;
  /** Blur applied to the image only, px 0–24. */
  backgroundBlur: number;
}

/** Metadata about a stored background image. The file path never leaves Rust. */
export interface BackgroundMeta {
  ext: string;
  bytes: number;
}

export interface BackgroundInfo {
  present: boolean;
  mime: string | null;
}

export interface NotifierStatus {
  state: "starting" | "disabled" | "no_account" | "running" | "stopped";
  userId: number | null;
  /** Unix ms of the last attempt that reached at least one endpoint. */
  lastPollAt: number | null;
  lastError: string | null;
  stoppedReason: string | null;
  unreadMessages: number | null;
  friendRequests: number | null;
  friendsOnline: number | null;
}

export interface NotifierNotice {
  kind: "auth_expired";
  message: string;
}

/** What a bell button watches: a friend (Roblox user id) or a game (universe id). */
export type WatchKind = "friend" | "game";

export interface WatchList {
  friends: number[];
  games: number[];
}

export type SettingKey = keyof Settings;

/** Minimal game shape accepted by launch/favorite/library helpers. */
export interface GameRef {
  placeId: number;
  universeId?: number | null;
  name: string;
  iconUrl?: string | null;
  genre?: string | null;
  creator?: string | null;
}

/** Anything a game card can render: GameSummary, GameDetails, LibraryEntry, HistoryEntry all fit. */
export interface CardGame extends GameRef {
  playerCount?: number;
  upVotes?: number;
  downVotes?: number;
  description?: string;
}
