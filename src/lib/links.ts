/** Display-side validation only; Rust is authoritative for anything that reaches the OS. */
export function parsePlaceIdParam(s: string | undefined | null): number | null {
  if (!s || !/^\d{1,16}$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export function gamePath(placeId: number): string {
  return `/game/${placeId}`;
}

/** Router `state` passed when opening a game so the details page can paint instantly. */
export interface GameRouteState {
  seed?: {
    placeId: number;
    universeId?: number | null;
    name: string;
    iconUrl?: string | null;
    playerCount?: number;
    genre?: string | null;
    upVotes?: number;
    downVotes?: number;
    description?: string;
    creator?: string | null;
  };
}
