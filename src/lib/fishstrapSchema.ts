import type { FishstrapSettingValue } from "./types";

export interface Option {
  value: string | number;
  label: string;
}

/** Disabled (greyed out) unless `settings[key]` is truthy, mirroring Fishstrap's own dependencies. */
interface Requires {
  key: string;
}

interface Base {
  title: string;
  description?: string;
  requires?: Requires;
}

export type Item =
  | (Base & { kind: "switch"; key: string; invert?: boolean })
  | (Base & { kind: "select"; key: string; options: Option[] })
  | (Base & { kind: "text"; key: string; placeholder?: string })
  | (Base & { kind: "number"; key: string })
  /** Switch backed by membership of `member` in a string-array setting. */
  | (Base & { kind: "member"; key: string; member: string })
  | (Base & { kind: "readonly"; key: string });

export interface Group {
  title?: string;
  description?: string;
  items: Item[];
}

export interface SchemaPage {
  id: string;
  label: string;
  description: string;
  groups: Group[];
}

const names = (labels: string[]): Option[] => labels.map((label, value) => ({ value, label }));

// Enum orders match Fishstrap's Bloxstrap/Enums/*.cs (serialized as integer indexes).
const ICONS_ROBLOX = names(["Default", "2008", "2011", "Early 2015", "Late 2015", "2017", "2019", "2022", "Custom"]);
const ICONS_BOOTSTRAPPER = names([
  "Fishstrap",
  "Fishstrap",
  "2008",
  "2011",
  "Early 2015",
  "Late 2015",
  "2017",
  "2019",
  "2022",
  "Custom",
  "Bloxstrap (Classic)",
]);

export const SCHEMA_PAGES: SchemaPage[] = [
  {
    id: "integrations",
    label: "Integrations",
    description: "Configure additional functionality to go alongside Roblox.",
    groups: [
      {
        title: "Activity tracking",
        items: [
          {
            kind: "switch",
            key: "EnableActivityTracking",
            title: "Enable activity tracking",
            description: "Allows for Fishstrap to detect what Roblox game you're playing. Certain features may require this.",
          },
          {
            kind: "switch",
            key: "ShowServerDetails",
            title: "Query server details",
            description: "When in-game, you'll be able to see where your server is located via rovalra.com. Additional server information may be sent.",
          },
          {
            kind: "switch",
            key: "UseDisableAppPatch",
            title: "Don't exit to desktop app",
            description: "Roblox will fully close when you leave a game instead of going back to the app. Will break some things!",
          },
        ],
      },
      {
        title: "Discord Rich Presence",
        description: "This feature requires activity tracking to be enabled and the Discord desktop app to be installed and running.",
        items: [
          {
            kind: "switch",
            key: "UseDiscordRichPresence",
            title: "Show game activity",
            description: "The Roblox game you're playing will be shown on your Discord profile.",
          },
          {
            kind: "select",
            key: "RichPresenceStatusDisplayType",
            title: "Discord status display",
            description: "Select the type of status display you want.",
            options: [
              { value: 0, label: "Name (Playing Roblox)" },
              { value: 1, label: "Details" },
            ],
            requires: { key: "UseDiscordRichPresence" },
          },
          {
            kind: "switch",
            key: "HideRPCButtons",
            invert: true,
            title: "Allow activity joining",
            description: "Allows for anybody to join the game you're currently in through your Discord profile.",
            requires: { key: "UseDiscordRichPresence" },
          },
          {
            kind: "switch",
            key: "ShowAccountOnRichPresence",
            title: "Show Roblox account",
            description: "Shows the Roblox account you're playing with on your Discord profile.",
            requires: { key: "UseDiscordRichPresence" },
          },
        ],
      },
      {
        title: "Window Manipulation",
        items: [
          {
            kind: "switch",
            key: "EnableWindowManipulation",
            title: "Enable window manipulation",
            description: "Allows Fishstrap to access Roblox's window handle allowing for better customization and features.",
          },
          {
            kind: "switch",
            key: "FakeBorderlessFullscreen",
            title: "Enable Borderless Fullscreen for Vulkan",
            description: "Lets you use a fake version of borderless fullscreen while using Vulkan.",
            requires: { key: "EnableWindowManipulation" },
          },
        ],
      },
      {
        title: "App Settings (Roblox)",
        items: [
          {
            kind: "switch",
            key: "EnableRobloxBackgroundApp",
            title: "Let Roblox run in the background",
            description: "Lets Roblox start up with Windows and stay in the notification area after you close it.",
          },
          {
            kind: "select",
            key: "RobloxTheme",
            title: "Roblox app theme",
            description: "The theme used by the Roblox app.",
            options: names(["Default", "Light", "Dark"]),
          },
        ],
      },
      {
        title: "Custom Integrations",
        description: "Here, you can have other programs launch with Roblox automatically. Add or edit them in Fishstrap itself.",
        items: [{ kind: "readonly", key: "CustomIntegrations", title: "Integrations" }],
      },
    ],
  },
  {
    id: "bootstrapper",
    label: "Bootstrapper",
    description: "Configure what Fishstrap should do when launching Roblox.",
    groups: [
      {
        items: [
          {
            kind: "switch",
            key: "ConfirmLaunches",
            title: "Prompt to confirm when launching another Roblox instance",
            description: "Prevent against closures of your existing game from accidentally launching another one.",
          },
          {
            kind: "switch",
            key: "ForceRobloxLanguage",
            title: "Allow use of unsupported Roblox languages",
            description: "Only applies to games launched from the Roblox website.",
          },
          {
            kind: "switch",
            key: "BackgroundUpdatesEnabled",
            title: "Background updates",
            description: "Update Roblox in the background instead of waiting. Not recommended for slow networks. At least 3GB of free storage space is required for this feature to work.",
          },
        ],
      },
      {
        title: "Cleaner",
        description: "Fishstrap will remove old data to save on space.",
        items: [
          {
            kind: "select",
            key: "CleanerOptions",
            title: "When should the files get deleted",
            description: "Files older than set amount will be deleted.",
            options: names(["Never", "After 1 day", "After 1 week", "After 2 weeks", "After 1 month", "After 2 months"]),
          },
          { kind: "member", key: "CleanerDirectories", member: "RobloxCache", title: "Cache", description: "Old downloads will be deleted." },
          { kind: "member", key: "CleanerDirectories", member: "RobloxStudioCache", title: "Studio Cache", description: "Old Studio downloads will be deleted." },
          { kind: "member", key: "CleanerDirectories", member: "RobloxLogs", title: "Logs", description: "Old log files will be deleted." },
          { kind: "member", key: "CleanerDirectories", member: "FishstrapLogs", title: "Fishstrap logs", description: "Fishstrap logs will be deleted." },
        ],
      },
      {
        title: "Experimental",
        description: "A collection of experimental settings. Be careful while using them, as they may or may not work as intended.",
        items: [
          {
            kind: "switch",
            key: "AllowCookieAccess",
            title: "Allow Fishstrap to access your Roblox account",
            description: "Provide access to Roblox APIs using your authentication cookie.",
          },
          {
            kind: "switch",
            key: "EnableBetterMatchmaking",
            title: "Enable BetterMatchmaking",
            description: "Let Fishstrap decide which servers you join. Prioritizes the server with the shortest distance to you.",
          },
          {
            kind: "switch",
            key: "EnableBetterMatchmakingRandomization",
            title: "Randomize BetterMatchmaking server",
            description: "Randomizes the chosen server from the list of optimal servers.",
            requires: { key: "EnableBetterMatchmaking" },
          },
        ],
      },
    ],
  },
  {
    id: "deployment",
    label: "Deployment",
    description: "Change deployment and installation settings for Roblox & Fishstrap.",
    groups: [
      {
        title: "Fishstrap",
        items: [
          {
            kind: "switch",
            key: "CheckForUpdates",
            title: "Automatically update Fishstrap",
            description: "Fishstrap will automatically check and update itself when launching Roblox.",
          },
        ],
      },
      {
        title: "Roblox",
        items: [
          {
            kind: "switch",
            key: "StaticDirectory",
            title: "Static directory",
            description: "Switch from version-xxx to BinaryType based install directories.",
          },
          {
            kind: "select",
            key: "DistributorType",
            title: "Roblox version",
            description: "Choose the client deployment Fishstrap should use. Please note, you may not be able to revert your account status after agreeing to the terms shown by Roblox.",
            options: [
              { value: 0, label: "Global (Default)" },
              { value: 1, label: "VNG Games" },
            ],
          },
          {
            kind: "text",
            key: "RobloxDomain",
            title: "Roblox domain",
            description: "Set what domain Roblox and Fishstrap will use. Enter only trusted domains.",
          },
          {
            kind: "text",
            key: "Channel",
            title: "Channel",
            description: "Choose deployment channel. Don't change unless you know what you're doing. Fishstrap downloads that version on your next launch.",
          },
          {
            kind: "select",
            key: "ChannelChangeMode",
            title: "Automatic channel change action",
            description: "Roblox or Fishstrap may try to change your preferred channel.",
            options: [
              { value: 0, label: "Change automatically" },
              { value: 1, label: "Prompt" },
              { value: 2, label: "Ignore" },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "Configure how Fishstrap should look.",
    groups: [
      {
        items: [
          {
            kind: "select",
            key: "Theme",
            title: "Global Theme",
            options: names(["System default", "Light", "Dark"]),
          },
          {
            kind: "text",
            key: "Locale",
            title: "Language",
            description: "Locale code, or \"nil\" for the system default. A relaunch is required for changes to take effect.",
          },
          { kind: "switch", key: "UseAcrylicBackground", title: "Acrylic background", description: "Use a translucent acrylic window background in Fishstrap." },
          {
            kind: "number",
            key: "AcrylicBackgroundOpacity",
            title: "Acrylic opacity",
            description: "Opacity of the acrylic background (number).",
            requires: { key: "UseAcrylicBackground" },
          },
        ],
      },
      {
        title: "Roblox",
        description: "Customize how the Roblox window looks like.",
        items: [
          { kind: "text", key: "RobloxTitle", title: "Roblox title", description: "Choose what title Roblox window should have." },
          { kind: "select", key: "RobloxIcon", title: "Roblox icon", description: "Choose what icon Roblox should display on the taskbar.", options: ICONS_ROBLOX },
          { kind: "text", key: "RobloxIconCustomLocation", title: "Custom Roblox icon path", description: "Used when the icon is set to Custom." },
        ],
      },
      {
        title: "Bootstrapper",
        description: "You can make it look different, retro, or even just like Roblox.",
        items: [
          {
            kind: "select",
            key: "BootstrapperStyle",
            title: "Style",
            description: "Choose how it should look. Dark theme does not apply to Legacy/Vista.",
            options: names([
              "Vista",
              "Legacy (2008)",
              "Legacy (2011)",
              "Progress",
              "Fishstrap (Classic)",
              "2025",
              "Terminal",
              "Byfron",
              "Fishstrap",
              "Fishstrap (Aero)",
              "Custom",
            ]),
          },
          { kind: "text", key: "BootstrapperTitle", title: "Bootstrapper Title", description: "The text that shows as the title of the bootstrapper." },
          { kind: "select", key: "BootstrapperIcon", title: "Bootstrapper Icon", description: "Choose what icon the bootstrapper should display.", options: ICONS_BOOTSTRAPPER },
          { kind: "text", key: "BootstrapperIconCustomLocation", title: "Custom bootstrapper icon path", description: "Used when the icon is set to Custom." },
        ],
      },
    ],
  },
];

/** Every Settings.json key the schema (or the dedicated FastFlags page) already presents. */
export const KNOWN_KEYS: ReadonlySet<string> = new Set([
  ...SCHEMA_PAGES.flatMap((p) => p.groups.flatMap((g) => g.items.map((i) => i.key))),
  "UseFastFlagManager",
]);

/** "EnableActivityTracking" → "Enable Activity Tracking". */
export function keyLabel(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

export type SettingsMap = Record<string, FishstrapSettingValue>;

export function isDisabled(item: Item, settings: SettingsMap): boolean {
  return !!item.requires && !settings[item.requires.key];
}

/** Case-insensitive match on title/description across all schema items. */
export function searchItems(query: string): { page: SchemaPage; item: Item }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return SCHEMA_PAGES.flatMap((page) =>
    page.groups.flatMap((g) =>
      g.items
        .filter((i) => `${i.title} ${i.description ?? ""}`.toLowerCase().includes(q))
        .map((item) => ({ page, item })),
    ),
  );
}
