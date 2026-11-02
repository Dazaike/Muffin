export type Platform = "windows" | "macos" | "linux";

export function detectPlatform(ua: string): Platform {
  return /Mac/i.test(ua) ? "macos" : /Windows/i.test(ua) ? "windows" : "linux";
}

export const platform: Platform = detectPlatform(typeof navigator === "undefined" ? "" : navigator.userAgent);

export const credentialStore =
  platform === "windows" ? "Windows Credential Manager" : platform === "macos" ? "macOS Keychain" : "your system keyring";
export const dataDir =
  platform === "windows" ? "%APPDATA%/app.muffin.launcher" : platform === "macos" ? "~/Library/Application Support/app.muffin.launcher" : "~/.local/share/app.muffin.launcher";
export const modKeyLabel = platform === "macos" ? "⌘" : "Ctrl";
export const shortcutLabel = platform === "macos" ? "⌃ ⌥ M" : "Ctrl + Alt + M";

/** Where to get Roblox on this OS (shown when no handler is registered). */
export const robloxInstallHint =
  platform === "macos"
    ? "Download it from roblox.com/download (Roblox.app in Applications)"
    : platform === "linux"
      ? "Roblox has no official Linux client; install Sober (flathub.org/apps/org.vinegarhq.Sober)"
      : "Install it from roblox.com/download";
