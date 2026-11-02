import { beforeEach, describe, expect, it, vi } from "vitest";
import { ipc } from "@/lib/ipc";
import type { GameRef, LibraryEntry } from "@/lib/types";
import { useLibrary } from "./library";
import { useUi } from "./ui";

vi.mock("@/lib/ipc", () => ({
  ipc: {
    libraryUpsert: vi.fn(),
    librarySetFlags: vi.fn(),
    libraryRemove: vi.fn(),
    libraryReorder: vi.fn(),
    searchesRemove: vi.fn(),
    searchesAdd: vi.fn(),
    searchesClear: vi.fn(),
  },
  toAppError: (e: unknown) => ({ code: "storage", message: e instanceof Error ? e.message : String(e) }),
}));

const api = vi.mocked(ipc);

const game: GameRef = { placeId: 1, universeId: 10, name: "Alpha", iconUrl: "https://x/a.webp", genre: "RPG", creator: "Dev" };

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  placeId: 1,
  universeId: 10,
  name: "Alpha",
  iconUrl: "https://x/a.webp",
  creator: "Dev",
  genre: "RPG",
  favorite: false,
  pinned: false,
  addedAt: 1000,
  position: 0,
  ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  useLibrary.setState({ entries: [], history: [], searches: [], hydrated: true });
  useUi.setState({ toasts: [] });
});

describe("toggleFavorite", () => {
  it("adds a new favorite optimistically, then adopts Rust's row", async () => {
    const d = deferred<LibraryEntry>();
    api.libraryUpsert.mockReturnValue(d.promise);

    const pending = useLibrary.getState().toggleFavorite(game);
    // Optimistic: visible before IPC resolves.
    expect(useLibrary.getState().entries).toHaveLength(1);
    expect(useLibrary.getState().entries[0]).toMatchObject({ placeId: 1, favorite: true, pinned: false });

    d.resolve(entry({ favorite: true, addedAt: 5555, position: 7 }));
    await pending;
    expect(useLibrary.getState().entries[0]).toMatchObject({ favorite: true, addedAt: 5555, position: 7 });
    expect(api.libraryUpsert).toHaveBeenCalledWith(expect.objectContaining({ placeId: 1, favorite: true, pinned: false }));
  });

  it("rolls back a failed add and shows an error toast", async () => {
    api.libraryUpsert.mockRejectedValue(new Error("disk full"));

    await useLibrary.getState().toggleFavorite(game);

    expect(useLibrary.getState().entries).toEqual([]);
    const toasts = useUi.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: "error" });
    expect(toasts[0]?.message).toContain("disk full");
  });

  it("flips the flag on an existing entry and rolls back on rejection", async () => {
    useLibrary.setState({ entries: [entry({ favorite: false })] });
    const d = deferred<null>();
    api.librarySetFlags.mockReturnValue(d.promise);

    const pending = useLibrary.getState().toggleFavorite(game);
    expect(useLibrary.getState().entries[0]?.favorite).toBe(true);
    expect(api.librarySetFlags).toHaveBeenCalledWith(1, { favorite: true });

    d.reject(new Error("locked"));
    await pending;
    expect(useLibrary.getState().entries[0]?.favorite).toBe(false);
    expect(useUi.getState().toasts[0]?.kind).toBe("error");
  });
});

describe("removeFromLibrary", () => {
  it("removes optimistically and rolls back when the IPC call fails", async () => {
    useLibrary.setState({ entries: [entry({ favorite: true })] });
    const d = deferred<null>();
    api.libraryRemove.mockReturnValue(d.promise);

    const pending = useLibrary.getState().removeFromLibrary(1);
    expect(useLibrary.getState().entries).toEqual([]);

    d.reject(new Error("nope"));
    await pending;
    expect(useLibrary.getState().entries).toHaveLength(1);
    expect(useLibrary.getState().entries[0]?.favorite).toBe(true);
  });

  it("undo restores the same row including flags, addedAt and position", async () => {
    const original = entry({ favorite: true, pinned: true, addedAt: 1234, position: 3 });
    useLibrary.setState({ entries: [original, entry({ placeId: 2, name: "Beta", position: 4 })] });
    api.libraryRemove.mockResolvedValue(null);
    api.libraryUpsert.mockImplementation(async (payload) => ({ ...original, ...payload, addedAt: payload.addedAt ?? 0, position: payload.position ?? 0 }) as LibraryEntry);

    await useLibrary.getState().removeFromLibrary(1);
    expect(useLibrary.getState().entries.map((e) => e.placeId)).toEqual([2]);

    const toast = useUi.getState().toasts.at(-1);
    expect(toast?.message).toBe("Removed Alpha");
    expect(toast?.undo?.duration).toBeGreaterThan(0);
    expect(toast?.action).toBeUndefined();

    toast?.undo?.onUndo();
    // Optimistic restore is synchronous; the IPC round-trip settles on the next ticks.
    expect(useLibrary.getState().entries.map((e) => e.placeId)).toEqual([1, 2]);
    await vi.waitFor(() => expect(api.libraryUpsert).toHaveBeenCalledTimes(1));

    expect(api.libraryUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ placeId: 1, favorite: true, pinned: true, addedAt: 1234, position: 3 }),
    );
    const restored = useLibrary.getState().entries.find((e) => e.placeId === 1);
    expect(restored).toMatchObject({ favorite: true, pinned: true, addedAt: 1234, position: 3 });
  });
});

describe("reorder", () => {
  it("applies the new order immediately and restores the old one on failure", async () => {
    useLibrary.setState({
      entries: [entry({ placeId: 1, position: 0 }), entry({ placeId: 2, name: "B", position: 1 }), entry({ placeId: 3, name: "C", position: 2 })],
    });
    api.libraryReorder.mockRejectedValue(new Error("tx failed"));

    const pending = useLibrary.getState().reorder([3, 1, 2]);
    expect(useLibrary.getState().entries.map((e) => e.placeId)).toEqual([3, 1, 2]);

    await pending;
    expect(useLibrary.getState().entries.map((e) => e.placeId)).toEqual([1, 2, 3]);
    expect(useUi.getState().toasts[0]?.kind).toBe("error");
  });
});

describe("undoable flag changes", () => {
  it("un-favorite offers an undo that restores the flag without another undo toast", async () => {
    useLibrary.setState({ entries: [entry({ favorite: true })] });
    api.librarySetFlags.mockResolvedValue(null);

    await useLibrary.getState().toggleFavorite(game);
    expect(useLibrary.getState().entries[0]?.favorite).toBe(false);
    const t = useUi.getState().toasts.at(-1);
    expect(t?.message).toBe("Removed Alpha from favorites");

    t?.undo?.onUndo();
    expect(useLibrary.getState().entries[0]?.favorite).toBe(true);
    await vi.waitFor(() => expect(api.librarySetFlags).toHaveBeenLastCalledWith(1, { favorite: true }));
    expect(useUi.getState().toasts.filter((x) => x.undo)).toHaveLength(1);
  });

  it("unpin undo re-pins", async () => {
    useLibrary.setState({ entries: [entry({ pinned: true })] });
    api.librarySetFlags.mockResolvedValue(null);

    await useLibrary.getState().togglePin(game);
    expect(useUi.getState().toasts.at(-1)?.message).toBe("Unpinned Alpha");
    useUi.getState().toasts.at(-1)?.undo?.onUndo();
    expect(useLibrary.getState().entries[0]?.pinned).toBe(true);
    await vi.waitFor(() => expect(api.librarySetFlags).toHaveBeenLastCalledWith(1, { pinned: true }));
  });

  it("a failed toggle shows only the error, no undo", async () => {
    useLibrary.setState({ entries: [entry({ pinned: true })] });
    api.librarySetFlags.mockRejectedValue(new Error("locked"));

    await useLibrary.getState().togglePin(game);
    expect(useLibrary.getState().entries[0]?.pinned).toBe(true);
    expect(useUi.getState().toasts.map((x) => x.kind)).toEqual(["error"]);
    expect(useUi.getState().toasts.some((x) => x.undo)).toBe(false);
  });

  it("undoing a first-time favorite removes the row again", async () => {
    api.libraryUpsert.mockResolvedValue(entry({ favorite: true }));
    api.libraryRemove.mockResolvedValue(null);

    await useLibrary.getState().toggleFavorite(game);
    expect(useUi.getState().toasts.at(-1)?.message).toBe("Added Alpha to favorites");

    useUi.getState().toasts.at(-1)?.undo?.onUndo();
    expect(useLibrary.getState().entries).toEqual([]);
    await vi.waitFor(() => expect(api.libraryRemove).toHaveBeenCalledWith(1));
  });
});

describe("recent searches", () => {
  it("undo of a single removal puts it back at its old slot and re-adds in recency order", async () => {
    useLibrary.setState({ searches: ["a", "b", "c"] });
    api.searchesRemove.mockResolvedValue(null);
    api.searchesAdd.mockResolvedValue(null);

    await useLibrary.getState().removeSearch("b");
    expect(useLibrary.getState().searches).toEqual(["a", "c"]);

    useUi.getState().toasts.at(-1)?.undo?.onUndo();
    expect(useLibrary.getState().searches).toEqual(["a", "b", "c"]);
    await vi.waitFor(() => expect(api.searchesAdd).toHaveBeenCalledTimes(2));
    // Re-added bottom-up so "a" ends up as the most recent again.
    expect(api.searchesAdd.mock.calls.map((c) => c[0])).toEqual(["b", "a"]);
  });

  it("clearing is only undoable when asked, and undo restores the list", async () => {
    useLibrary.setState({ searches: ["a", "b"] });
    api.searchesClear.mockResolvedValue(null);
    api.searchesAdd.mockResolvedValue(null);

    await useLibrary.getState().clearSearches();
    expect(useUi.getState().toasts).toHaveLength(0);

    useLibrary.setState({ searches: ["a", "b"] });
    await useLibrary.getState().clearSearches({ undoable: true });
    expect(useLibrary.getState().searches).toEqual([]);
    useUi.getState().toasts.at(-1)?.undo?.onUndo();
    expect(useLibrary.getState().searches).toEqual(["a", "b"]);
    await vi.waitFor(() => expect(api.searchesAdd.mock.calls.map((c) => c[0])).toEqual(["b", "a"]));
  });
});
