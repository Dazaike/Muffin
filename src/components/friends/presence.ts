import { relativeTime } from "@/lib/format";
import type { Friend, Presence, PresenceStatus } from "@/lib/socialTypes";

/** Lower sorts first: in game, online, in Studio, offline. */
const RANK: Record<PresenceStatus, number> = { inGame: 0, online: 1, inStudio: 2, offline: 3 };

export const PRESENCE_GROUPS: { id: "playing" | "online" | "offline"; label: string; match: (s: PresenceStatus) => boolean }[] = [
  { id: "playing", label: "In game", match: (s) => s === "inGame" },
  { id: "online", label: "Online", match: (s) => s === "online" || s === "inStudio" },
  { id: "offline", label: "Offline", match: (s) => s === "offline" },
];

/** Online-first, then most recently online, then by display name. */
export function sortFriends(friends: Friend[]): Friend[] {
  return [...friends].sort((a, b) => {
    const byStatus = RANK[a.presence.status] - RANK[b.presence.status];
    if (byStatus !== 0) return byStatus;
    if (a.presence.status === "offline") {
      const recent = lastOnlineMs(b.presence) - lastOnlineMs(a.presence);
      if (recent !== 0) return recent;
    }
    return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
  });
}

/** 0 when missing or unparsable, so such friends sort last among the offline. */
export function lastOnlineMs(p: Presence): number {
  const t = p.lastOnline ? Date.parse(p.lastOnline) : NaN;
  return Number.isFinite(t) ? t : 0;
}

export function presenceText(p: Presence, now: number = Date.now()): string {
  switch (p.status) {
    case "inGame":
      return p.lastLocation ? `Playing ${p.lastLocation}` : "In a game";
    case "inStudio":
      return p.lastLocation ? `Creating in Studio · ${p.lastLocation}` : "In Roblox Studio";
    case "online":
      return "Online";
    default: {
      const t = lastOnlineMs(p);
      return t > 0 ? `Last online ${relativeTime(t, now)}` : "Offline";
    }
  }
}

/** Case-insensitive match on display name or username. */
export function matchesFriend(f: { displayName: string; name: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || f.displayName.toLowerCase().includes(q) || f.name.toLowerCase().includes(q);
}
