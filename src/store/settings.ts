import { create } from "zustand";
import { autostart, ipc, toAppError } from "@/lib/ipc";
import type { Settings, SettingKey } from "@/lib/types";
import { toast } from "./ui";

export const DEFAULT_SETTINGS: Settings = {
  accentHue: 265,
  density: "comfortable",
  animationIntensity: "full",
  reduceMotion: false,
  lightweightMode: false,
  startMinimized: false,
  autoStart: false,
  closeBehavior: "quit",
  afterLaunch: "nothing",
  showRobux: true,
  notifications: false,
  continueFromRoblox: true,
  notifyMessages: true,
  notifyFriendRequests: true,
  notifyFriendsOnline: false,
  notifyOnlyWhenHidden: true,
  globalShortcut: true,
  libraryView: "grid",
  friendsView: "list",
  searchView: "list",
  cardShape: "portrait",
  discoverView: "grid",
  discoverCards: "vertical",
  favoritesView: "grid",
  recentView: "list",
  playtimeView: "list",
  walletView: "list",
  profileView: "list",
  peopleView: "list",
  serversView: "list",
  badgesView: "list",
  passesView: "grid",
  placesView: "list",
  librarySort: "added",
  onboarded: false,
  backgroundImage: false,
  backgroundDim: 55,
  backgroundBlur: 0,
};

/** Inclusive hue range (mirrors the Rust allowlist). */
export const ACCENT_HUE_RANGE = { min: 0, max: 359 } as const;

const ENUMS: Partial<Record<SettingKey, readonly string[]>> = {
  density: ["comfortable", "compact"],
  animationIntensity: ["full", "reduced", "off"],
  closeBehavior: ["quit", "tray"],
  afterLaunch: ["nothing", "tray", "quit"],
  libraryView: ["grid", "list"],
  friendsView: ["grid", "list"],
  searchView: ["grid", "list"],
  cardShape: ["portrait", "square"],
  discoverView: ["grid", "list"],
  discoverCards: ["vertical", "horizontal"],
  favoritesView: ["grid", "list"],
  recentView: ["grid", "list"],
  playtimeView: ["grid", "list"],
  walletView: ["grid", "list"],
  profileView: ["grid", "list"],
  peopleView: ["grid", "list"],
  serversView: ["grid", "list"],
  badgesView: ["grid", "list"],
  passesView: ["grid", "list"],
  placesView: ["grid", "list"],
  librarySort: ["name", "lastPlayed", "added", "custom"],
};

/** Inclusive integer ranges (mirrors the Rust allowlist). */
export const BACKGROUND_DIM_RANGE = { min: 0, max: 90 } as const;
export const BACKGROUND_BLUR_RANGE = { min: 0, max: 24 } as const;
const INT_RANGES: Partial<Record<SettingKey, { min: number; max: number }>> = {
  accentHue: ACCENT_HUE_RANGE,
  backgroundDim: BACKGROUND_DIM_RANGE,
  backgroundBlur: BACKGROUND_BLUR_RANGE,
};

/** Merge raw persisted values over defaults, dropping anything with the wrong type. */
export function mergeSettings(raw: Record<string, unknown> | undefined | null): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS };
  if (!raw) return out;
  const target = out as unknown as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as SettingKey[]) {
    const v = raw[key];
    if (v === undefined || typeof v !== typeof DEFAULT_SETTINGS[key]) continue;
    const allowed = ENUMS[key];
    if (allowed && !allowed.includes(v as string)) continue;
    const range = INT_RANGES[key];
    if (range && !(Number.isInteger(v) && (v as number) >= range.min && (v as number) <= range.max)) continue;
    target[key] = v;
  }
  return out;
}

interface SettingsState {
  values: Settings;
  hydrated: boolean;
  hydrate: (raw: Record<string, unknown> | undefined | null) => void;
  set: <K extends SettingKey>(key: K, value: Settings[K]) => Promise<void>;
  /** Reads the real autostart state from the OS plugin (source of truth for `autoStart`). */
  syncAutostart: () => Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  values: DEFAULT_SETTINGS,
  hydrated: false,
  hydrate: (raw) => set({ values: mergeSettings(raw), hydrated: true }),
  set: async (key, value) => {
    const prev = get().values[key];
    set((s) => ({ values: { ...s.values, [key]: value } }));
    try {
      if (key === "autoStart") await autostart.set(value as boolean);
      await ipc.settingsSet(key, value);
    } catch (e) {
      set((s) => ({ values: { ...s.values, [key]: prev } }));
      toast.error(`Couldn't save setting: ${toAppError(e).message}`);
    }
  },
  syncAutostart: async () => {
    try {
      const on = await autostart.isEnabled();
      set((s) => ({ values: { ...s.values, autoStart: on } }));
    } catch {
      /* plugin unavailable: keep stored value */
    }
  },
}));

/** Applies appearance/performance settings to <html>. Called from a root effect. */
export function applySettingsToDom(v: Settings, root: HTMLElement = document.documentElement): void {
  root.dataset.density = v.density;
  root.dataset.lite = String(v.lightweightMode);
  root.dataset.effects = v.animationIntensity === "off" ? "off" : "on";
  root.dataset.bgImage = String(v.backgroundImage);
  root.style.setProperty("--accent-h", String(v.accentHue));
}
