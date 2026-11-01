// Shapes for playtime tracking, import/export and the Roblox-favorites import (camelCase from Rust).

export type PlaytimeRange = "today" | "week" | "all";

export interface PlayerState {
  running: boolean;
  placeId: number | null;
}

export interface GamePlaytime {
  placeId: number;
  universeId: number | null;
  name: string;
  iconUrl: string | null;
  totalMs: number;
  sessions: number;
  lastPlayedAt: number;
}

export interface PlaytimeSummary {
  totalMs: number;
  sessionCount: number;
  games: GamePlaytime[];
}

export interface PlaytimeSession {
  id: number;
  placeId: number;
  universeId: number | null;
  name: string;
  startedAt: number;
  /** null while the session is still running. */
  endedAt: number | null;
  durationMs: number;
}

export type ImportMode = "merge" | "replace";

export interface SectionPreview {
  total: number;
  new: number;
}

export interface ImportPreview {
  fileName: string;
  exportedAt: number;
  library: SectionPreview;
  history: SectionPreview;
  searches: SectionPreview;
  privateServers: SectionPreview;
  playtime: SectionPreview;
  settings: SectionPreview;
  settingsIgnored: number;
}

export interface SectionResult {
  added: number;
  skipped: number;
}

export interface ImportResult {
  library: SectionResult;
  history: SectionResult;
  searches: SectionResult;
  privateServers: SectionResult;
  playtime: SectionResult;
  settingsApplied: number;
}

export interface ExportResult {
  fileName: string;
  library: number;
  history: number;
  searches: number;
  privateServers: number;
  playtime: number;
  settings: number;
}

export interface FavGame {
  placeId: number;
  universeId: number;
  name: string;
  creator: string | null;
  genre: string | null;
  iconUrl: string | null;
  inLibrary: boolean;
}

export interface FavoritesDiff {
  items: FavGame[];
  total: number;
  newCount: number;
  existingCount: number;
  skipped: number;
  truncated: boolean;
}

export interface ApplyFavoritesResult {
  added: number;
  alreadyPresent: number;
}

/** A game from the signed-in Roblox account's Continue / recently played row, in Roblox's order. */
export interface ContinueGame {
  placeId: number;
  universeId: number;
  name: string;
  iconUrl: string | null;
  genre: string | null;
  playerCount: number | null;
  upVotes: number | null;
  downVotes: number | null;
}
