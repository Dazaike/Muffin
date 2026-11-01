// Shapes for the game-details extras: server browser, badges, passes, places, votes, social links.

/** Result of `game_vote_state` / `game_vote`. `userVote`: true = up, false = down, null = none. */
export interface VoteState {
  canVote: boolean;
  userVote: boolean | null;
  /** Why voting is unavailable, when Roblox says so (e.g. "PlayGame"). */
  reason: string | null;
}

export interface AwardedBadge {
  badgeId: number;
  awardedDate: string | null;
}

/** Only links the Rust opener accepts are ever returned. */
export interface SocialLink {
  title: string;
  kind: string;
  url: string;
}

export interface PublicServer {
  /** Instance GUID; the Rust side re-validates it before launching. */
  id: string;
  playing: number;
  maxPlayers: number;
  /** Server frame rate / ping to Roblox as reported by the list; absent for new servers. */
  fps?: number;
  ping?: number;
}

export interface Badge {
  id: number;
  name: string;
  description: string;
  iconUrl?: string;
  awardedCount: number;
  /** Percentage of players who earned it (0–100), Roblox's "win rate". */
  winRate: number;
  pastDayAwarded: number;
}

export interface GamePass {
  id: number;
  name: string;
  description: string;
  iconUrl?: string;
  /** Robux price; null when not for sale / no price. */
  price: number | null;
  forSale: boolean;
  /** Whether the signed-in account owns it; null for guests (Roblox always reports false to them). */
  owned: boolean | null;
}

/** Roblox's "more like this" entry (needs a session). */
export interface RecommendedGame {
  universeId: number;
  placeId: number;
  name: string;
  playerCount?: number | null;
  upVotes?: number | null;
  downVotes?: number | null;
  creator?: string | null;
}

/** Creator section data when the creator is a group (community). */
export interface CreatorGroup {
  id: number;
  name: string;
  memberCount: number | null;
  verified: boolean;
  /** Display name of the group owner, when public. */
  ownerName?: string;
  iconUrl?: string;
}

export interface SubPlace {
  placeId: number;
  name: string;
  description: string;
  iconUrl?: string;
  isRoot: boolean;
}

export interface UserHit {
  id: number;
  name: string;
  displayName: string;
  verified: boolean;
}

export interface Paged<T> {
  items: T[];
  nextCursor: string | null;
}
