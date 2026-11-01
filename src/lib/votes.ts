/**
 * Up/down counts after the user's vote moves from `from` (true = up, false = down, null = none) to `to`.
 * Voting the same way again changes nothing; switching sides moves one vote across.
 */
export function adjustVotes(up: number, down: number, from: boolean | null, to: boolean): { up: number; down: number } {
  if (from === to) return { up, down };
  return {
    up: up + (to ? 1 : 0) - (from === true ? 1 : 0),
    down: down + (to ? 0 : 1) - (from === false ? 1 : 0),
  };
}
