import type { MouseEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { navigateWithMorph, USER_AVATAR_ATTR } from "@/lib/gameTransition";
import { useMotionPrefs } from "@/lib/motion";

/** What the profile page is seeded with, so its picture is there on the first frame. */
export interface UserRouteState {
  avatarUrl?: string | null;
  /** Opened from a list avatar, so Back can morph the picture home again. */
  fromAvatar?: boolean;
}

/**
 * Opens a user's profile. With `source` (their avatar on screen) that avatar morphs into the
 * profile's picture, like a game card into its details.
 */
export function useOpenUser(): (userId: number, source?: HTMLElement | null, avatarUrl?: string | null) => void {
  const navigate = useNavigate();
  const m = useMotionPrefs();
  return (userId, source, avatarUrl) =>
    navigateWithMorph(source, () => navigate(`/user/${userId}`, { state: { avatarUrl, fromAvatar: !!source } satisfies UserRouteState }), !m.off, "user");
}

/** A link to a profile whose click morphs the nearest avatar (inside `scope`, default the enclosing list item). */
export function UserLink({
  userId,
  avatarUrl,
  className,
  children,
}: {
  userId: number;
  avatarUrl?: string | null;
  className?: string;
  children: ReactNode;
}) {
  const open = useOpenUser();
  return (
    <Link
      to={`/user/${userId}`}
      className={className}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        const row = e.currentTarget.closest("li");
        const holder = row?.querySelector<HTMLElement>(`[${USER_AVATAR_ATTR}]`);
        // The picture itself, not the holder: the holder also carries the presence dot.
        open(userId, holder?.querySelector("img")?.parentElement ?? holder, avatarUrl);
      }}
    >
      {children}
    </Link>
  );
}
