import { useLaunch } from "@/store/launch";
import type { GameRef, GameSummary, HistoryEntry, LibraryEntry } from "./types";

type GameLike = GameSummary | LibraryEntry | HistoryEntry | GameRef;

/** Normalizes any game-shaped object into the minimal ref used by launch/library actions. */
export function toGameRef(g: GameLike): GameRef {
  return {
    placeId: g.placeId,
    universeId: g.universeId ?? null,
    name: g.name,
    iconUrl: g.iconUrl ?? null,
    genre: g.genre ?? null,
    creator: "creator" in g ? (g.creator ?? null) : null,
  };
}

/** Starts a launch through the phase machine (ignored while another launch is active). */
export function launchGame(g: GameLike): Promise<void> {
  return useLaunch.getState().launch(toGameRef(g));
}
