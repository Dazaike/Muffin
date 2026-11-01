import { useEffect } from "react";
import { create } from "zustand";
import { ipc, toAppError } from "@/lib/ipc";
import { useSettings } from "./settings";
import { toast } from "./ui";

interface BackgroundState {
  /** `blob:` URL of the stored image, or null when none is loaded. */
  url: string | null;
  /** Bumped whenever the stored file changes so the loader re-reads it. */
  revision: number;
  busy: boolean;
  load: () => Promise<void>;
  release: () => void;
  pick: () => Promise<void>;
  remove: () => Promise<void>;
}

/** Newest load wins: a slow older read must never replace a newer image. */
let loadToken = 0;

export const useBackground = create<BackgroundState>((set, get) => {
  const swapUrl = (next: string | null) => {
    const prev = get().url;
    set({ url: next });
    if (prev) URL.revokeObjectURL(prev);
  };

  return {
    url: null,
    revision: 0,
    busy: false,

    load: async () => {
      const mine = ++loadToken;
      try {
        const info = await ipc.backgroundInfo();
        if (mine !== loadToken) return;
        if (!info.present) {
          swapUrl(null);
          return;
        }
        const bytes = await ipc.backgroundRead();
        if (mine !== loadToken) return;
        swapUrl(URL.createObjectURL(new Blob([bytes], { type: info.mime ?? "image/png" })));
      } catch (e) {
        if (mine !== loadToken) return;
        swapUrl(null);
        toast.error(`Couldn't load the background image: ${toAppError(e).message}`);
      }
    },

    /** Drops the loaded image (and cancels any load in flight). */
    release: () => {
      loadToken++;
      if (get().url) swapUrl(null);
    },

    pick: async () => {
      if (get().busy) return;
      set({ busy: true });
      try {
        const meta = await ipc.backgroundPick();
        if (!meta) return; // dialog cancelled
        set((s) => ({ revision: s.revision + 1 }));
        await useSettings.getState().set("backgroundImage", true);
      } catch (e) {
        toast.error(toAppError(e).message);
      } finally {
        set({ busy: false });
      }
    },

    remove: async () => {
      if (get().busy) return;
      set({ busy: true });
      try {
        await ipc.backgroundClear();
        await useSettings.getState().set("backgroundImage", false);
        get().release();
      } catch (e) {
        toast.error(`Couldn't remove the background image: ${toAppError(e).message}`);
      } finally {
        set({ busy: false });
      }
    },
  };
});

/**
 * Keeps the blob URL in sync with the `backgroundImage` setting. Mount exactly once (it lives in
 * `AmbientBackground`). Returns the URL only while a custom image is active.
 */
export function useBackgroundLoader(): { active: boolean; url: string | null } {
  const active = useSettings((s) => s.values.backgroundImage);
  const hydrated = useSettings((s) => s.hydrated);
  const revision = useBackground((s) => s.revision);
  const url = useBackground((s) => s.url);

  useEffect(() => {
    if (!hydrated) return;
    const { load, release } = useBackground.getState();
    if (active) void load();
    else release();
  }, [active, hydrated, revision]);

  return { active, url: active ? url : null };
}
