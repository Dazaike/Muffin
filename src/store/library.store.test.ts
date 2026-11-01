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
    expect(toast?.action?.label).toBe("Undo");

    toast?.action?.onClick();
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
