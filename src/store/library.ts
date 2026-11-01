import { create } from "zustand";
import { ipc, toAppError } from "@/lib/ipc";
import type { GameRef, HistoryEntry, LibraryEntry } from "@/lib/types";
import { toast } from "./ui";

interface LibraryState {
  entries: LibraryEntry[];
  history: HistoryEntry[];
  searches: string[];
  hydrated: boolean;

  hydrate: (data: { library: LibraryEntry[]; history: HistoryEntry[]; searches: string[] }) => void;
  refreshHistory: () => Promise<void>;

  /** Adds to favorites (upserting into library if needed) or flips the flag. */
  toggleFavorite: (game: GameRef) => Promise<void>;
  addToLibrary: (game: GameRef) => Promise<void>;
  /** Removes with a 5 s undo toast that restores flags, position and addedAt. */
  removeFromLibrary: (placeId: number) => Promise<void>;
  togglePin: (game: GameRef) => Promise<void>;
  /** `placeIds` is the full desired order. */
  reorder: (placeIds: number[]) => Promise<void>;

  clearHistory: () => Promise<void>;
  recordSearch: (q: string) => Promise<void>;
  removeSearch: (q: string) => Promise<void>;
  clearSearches: () => Promise<void>;
}

const byPosition = (a: LibraryEntry, b: LibraryEntry) => a.position - b.position || a.addedAt - b.addedAt;

function putEntry(list: LibraryEntry[], e: LibraryEntry): LibraryEntry[] {
  const i = list.findIndex((x) => x.placeId === e.placeId);
  const next = i >= 0 ? list.map((x) => (x.placeId === e.placeId ? e : x)) : [...list, e];
  return next.sort(byPosition);
}

const dropEntry = (list: LibraryEntry[], placeId: number) => list.filter((x) => x.placeId !== placeId);

/** Puts a single placeId back to its previous state (or removes it if there was none). */
function rollbackOne(list: LibraryEntry[], placeId: number, prev: LibraryEntry | undefined): LibraryEntry[] {
  return prev ? putEntry(list, prev) : dropEntry(list, placeId);
}

function fail(prefix: string, e: unknown) {
  toast.error(`${prefix}: ${toAppError(e).message}`);
}

function toEntry(game: GameRef, entries: LibraryEntry[], flags: { favorite: boolean; pinned: boolean }): LibraryEntry {
  return {
    placeId: game.placeId,
    universeId: game.universeId ?? null,
    name: game.name,
    iconUrl: game.iconUrl ?? null,
    creator: game.creator ?? null,
    genre: game.genre ?? null,
    favorite: flags.favorite,
    pinned: flags.pinned,
    addedAt: Date.now(),
    position: entries.reduce((m, x) => Math.max(m, x.position), -1) + 1,
  };
}

export const useLibrary = create<LibraryState>((set, get) => {
  /** Upserts a game as a new library row (optimistic, replaced with Rust's row on success). */
  const insertNew = async (game: GameRef, flags: { favorite: boolean; pinned: boolean }, errPrefix: string) => {
    const optimistic = toEntry(game, get().entries, flags);
    set((s) => ({ entries: putEntry(s.entries, optimistic) }));
    try {
      const saved = await ipc.libraryUpsert({
        placeId: game.placeId,
        universeId: game.universeId ?? null,
        name: game.name,
        iconUrl: game.iconUrl ?? null,
        creator: game.creator ?? null,
        genre: game.genre ?? null,
        favorite: flags.favorite,
        pinned: flags.pinned,
      });
      set((s) => ({ entries: putEntry(s.entries, saved) }));
    } catch (e) {
      set((s) => ({ entries: dropEntry(s.entries, game.placeId) }));
      fail(errPrefix, e);
    }
  };

  const setFlag = async (entry: LibraryEntry, flag: "favorite" | "pinned", value: boolean, errPrefix: string) => {
    const next = { ...entry, [flag]: value };
    set((s) => ({ entries: putEntry(s.entries, next) }));
    try {
      await ipc.librarySetFlags(entry.placeId, { [flag]: value });
    } catch (e) {
      set((s) => ({ entries: rollbackOne(s.entries, entry.placeId, entry) }));
      fail(errPrefix, e);
    }
  };

  const restore = async (entry: LibraryEntry) => {
    set((s) => ({ entries: putEntry(s.entries, entry) }));
    try {
      const saved = await ipc.libraryUpsert({
        placeId: entry.placeId,
        universeId: entry.universeId ?? null,
        name: entry.name,
        iconUrl: entry.iconUrl ?? null,
        creator: entry.creator ?? null,
        genre: entry.genre ?? null,
        favorite: entry.favorite,
        pinned: entry.pinned,
        addedAt: entry.addedAt,
        position: entry.position,
      });
      set((s) => ({ entries: putEntry(s.entries, saved) }));
    } catch (e) {
      set((s) => ({ entries: dropEntry(s.entries, entry.placeId) }));
      fail("Couldn't restore game", e);
    }
  };

  return {
    entries: [],
    history: [],
    searches: [],
    hydrated: false,

    hydrate: ({ library, history, searches }) =>
      set({ entries: [...library].sort(byPosition), history, searches, hydrated: true }),

    refreshHistory: async () => {
      try {
        set({ history: await ipc.historyList(200) });
      } catch {
        /* keep the current list; history is informational */
      }
    },

    toggleFavorite: async (game) => {
      const existing = get().entries.find((x) => x.placeId === game.placeId);
      if (existing) return setFlag(existing, "favorite", !existing.favorite, "Couldn't update favorite");
      return insertNew(game, { favorite: true, pinned: false }, "Couldn't add favorite");
    },

    addToLibrary: async (game) => {
      if (get().entries.some((x) => x.placeId === game.placeId)) return;
      return insertNew(game, { favorite: false, pinned: false }, "Couldn't add to library");
    },

    removeFromLibrary: async (placeId) => {
      const prev = get().entries.find((x) => x.placeId === placeId);
      if (!prev) return;
      set((s) => ({ entries: dropEntry(s.entries, placeId) }));
      try {
        await ipc.libraryRemove(placeId);
      } catch (e) {
        set((s) => ({ entries: rollbackOne(s.entries, placeId, prev) }));
        fail("Couldn't remove game", e);
        return;
      }
      toast.withAction(`Removed ${prev.name}`, { label: "Undo", onClick: () => void restore(prev) }, 5000);
    },

    togglePin: async (game) => {
      const existing = get().entries.find((x) => x.placeId === game.placeId);
      if (existing) return setFlag(existing, "pinned", !existing.pinned, "Couldn't update pin");
      return insertNew(game, { favorite: false, pinned: true }, "Couldn't pin game");
    },

    reorder: async (placeIds) => {
      const prevEntries = get().entries;
      const pos = new Map(placeIds.map((id, i) => [id, i]));
      set((s) => ({
        entries: s.entries
          .map((e) => (pos.has(e.placeId) ? { ...e, position: pos.get(e.placeId)! } : e))
          .sort(byPosition),
      }));
      try {
        await ipc.libraryReorder(placeIds);
      } catch (e) {
        set({ entries: prevEntries });
        fail("Couldn't save order", e);
      }
    },

    clearHistory: async () => {
      const prev = get().history;
      set({ history: [] });
      try {
        await ipc.historyClear();
      } catch (e) {
        set({ history: prev });
        fail("Couldn't clear history", e);
      }
    },

    recordSearch: async (q) => {
      const query = q.trim();
      if (query.length < 2) return;
      const prev = get().searches;
      set({ searches: [query, ...prev.filter((x) => x !== query)].slice(0, 20) });
      try {
        await ipc.searchesAdd(query);
      } catch {
        set({ searches: prev });
      }
    },

    removeSearch: async (q) => {
      const prev = get().searches;
      set({ searches: prev.filter((x) => x !== q) });
      try {
        await ipc.searchesRemove(q);
      } catch (e) {
        set({ searches: prev });
        fail("Couldn't remove search", e);
      }
    },

    clearSearches: async () => {
      const prev = get().searches;
      set({ searches: [] });
      try {
        await ipc.searchesClear();
      } catch (e) {
        set({ searches: prev });
        fail("Couldn't clear searches", e);
      }
    },
  };
});

export const selectFavorites = (s: Pick<LibraryState, "entries">) => s.entries.filter((e) => e.favorite);
export const selectPinned = (s: Pick<LibraryState, "entries">) => s.entries.filter((e) => e.pinned);
