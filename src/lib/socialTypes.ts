// Friends / presence shapes. Mirror `src-tauri/src/social.rs` (camelCase).

export type PresenceStatus = "offline" | "online" | "inGame" | "inStudio";

export interface Presence {
  userId: number;
  status: PresenceStatus;
  lastLocation?: string | null;
  placeId?: number | null;
  rootPlaceId?: number | null;
  universeId?: number | null;
  /** ISO timestamp. */
  lastOnline?: string | null;
  /** In a game with a known server, so `join_friend` can work. */
  joinable: boolean;
}

export interface SocialUser {
  id: number;
  name: string;
  displayName: string;
  verified: boolean;
  avatarUrl?: string | null;
}

export type Relation = "notFriends" | "friends" | "requestSent" | "requestReceived";

export interface Friend extends SocialUser {
  presence: Presence;
}

export interface FriendsList {
  friends: Friend[];
  total: number;
  /** Set when presence could not be loaded; friends are then shown as offline. */
  presenceError?: string | null;
}

/** A user in the requests / followers / following / search lists. */
export interface PersonRow extends SocialUser {
  relation?: Relation | null;
  following?: boolean | null;
  sentAt?: string | null;
  mutualFriends: number;
}

export interface PersonPage {
  items: PersonRow[];
  nextCursor?: string | null;
}

export type FollowKind = "followers" | "following";

export type FriendAction = "send" | "accept" | "decline" | "cancel" | "unfriend" | "follow" | "unfollow";
