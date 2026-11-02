import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { ipc } from "./ipc";
import type { AppError } from "./types";

/** Mirrors `src-tauri/src/user_profile.rs`. */
export interface UserProfile {
  id: number;
  name: string;
  displayName: string;
  description: string;
  /** ISO timestamp. */
  created?: string | null;
  verified: boolean;
  banned: boolean;
  friends?: number | null;
  followers?: number | null;
  following?: number | null;
  games: { universeId: number; placeId: number; name: string; visits: number }[];
}

export function useUserProfile(userId: number | null): UseQueryResult<UserProfile, AppError> {
  return useQuery<UserProfile, AppError>({
    queryKey: ["userProfile", userId],
    enabled: userId !== null,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => ipc.userProfile(userId as number),
  });
}

export type ProfileSection = "friends" | "favorites" | "badges" | "groups" | "collectibles" | "wearing";

/** One tile on a profile tab (mirrors `Item` in `user_profile.rs`). */
export interface ProfileItem {
  id: number;
  name: string;
  subtitle?: string | null;
  imageUrl?: string | null;
  /** Set for experiences. */
  placeId?: number | null;
  universeId?: number | null;
}

export interface SectionData {
  items: ProfileItem[];
  /** The user keeps this section hidden. */
  private: boolean;
}

/** One tab's content, fetched only once the tab is opened. */
export function useUserSection(userId: number | null, section: ProfileSection, enabled: boolean): UseQueryResult<SectionData, AppError> {
  return useQuery<SectionData, AppError>({
    queryKey: ["userSection", userId, section],
    enabled: enabled && userId !== null,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => ipc.userSection(userId as number, section),
  });
}
