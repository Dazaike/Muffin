import { useAccount } from "@/store/account";

/** Id of the signed-in Roblox web-session user (the active account), or null for guests. */
export function useWebSessionUserId(): number | null {
  return useAccount((s) => (s.status?.signedIn && s.status.user ? s.status.user.id : null));
}
