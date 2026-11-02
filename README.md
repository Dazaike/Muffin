# Muffin

A fast, good-looking Roblox launcher for Windows, macOS and Linux. Find games, keep your favorites, and hit Play. (Fishstrap integration is Windows-only.)

Muffin doesn't replace Roblox. It's a nicer front door: you browse and search in Muffin, and when you press **Play**, Roblox opens the game just like it would from the website.

## What you can do

- **Find games.** Browse Home and Discover, or search by name. Every game has a full page with players, likes, the creator, servers, badges and passes.
- **Play with one click.** Press Play on any game. Muffin works with Roblox itself, Bloxstrap and Fishstrap.
- **Keep your games organized.** Favorite games, build a library, drag them into your own order, and jump back into recent ones from Continue Playing.
- **Join private servers.** Save a private server link for a game and launch straight into it.
- **See your friends.** Sign in to see who's online, send and answer friend requests, and join them.
- **Check your Robux.** Your balance shows in the top bar, with your recent transactions in Wallet.
- **Make it yours.** Pick any accent color, switch card layouts, and set your own background picture.
- **Stay out of the way.** Minimize to the tray, start at login, or let Muffin close itself once Roblox opens.
- **Move to a new PC.** Export your library and settings to a file and import them anywhere.

## Getting started

1. Download the installer for your system from the [Releases](../../releases) page:
   - **Windows:** `Muffin_0.1.1_x64-setup.exe`. It installs just for you, so no admin rights are needed.
   - **macOS:** `Muffin_0.1.1_universal.dmg`. The app is unsigned, so the first time right-click it and choose **Open**, or run `xattr -dr com.apple.quarantine /Applications/Muffin.app`. Install Roblox from roblox.com/download first.
   - **Linux:** the `.deb` or `.AppImage`. Roblox has no official Linux client, so install [Sober](https://flathub.org/apps/org.vinegarhq.Sober) (Flatpak) first.
2. Open Muffin. The first-run screen checks that Roblox is installed and offers to sign you in.
3. Search for a game and press **Play**.

You need Roblox (or Bloxstrap or Fishstrap) installed. If Muffin can't find it, **Settings → Roblox** tells you what's wrong.

## Do I need to sign in?

No. Browsing, searching, favorites, your library and launching all work without an account.

Signing in adds the account-based parts: your Robux, friends, your own games, and search results that match your account (including age-restricted games). It works like logging in on the Roblox website. Muffin keeps your login safe in your system's credential store and never shows it to you or sends it anywhere except Roblox. You can add more than one account and remove one any time from Settings → Account.

## Good to know

- **Muffin hands the game to Roblox.** Once you press Play, Roblox takes over, and Muffin can't tell whether the game actually started.
- **Roblox uses its own login.** The game opens as whichever account Roblox itself is signed into, which may not be the account you're using in Muffin.
- **Playtime is an estimate.** It only counts games you started from Muffin.
- **Some features are untested.** Friends, private-server buying and management, voting and transactions depend on parts of Roblox that can change, and haven't been checked against a live account. If Roblox says no, Muffin shows the error instead of making something up.
- **Not included on purpose:** avatar editor, marketplace, inventory and trading, and Roblox account or security settings.

## Your data

Everything stays on your computer: your library, history, settings and saved private servers live in `%APPDATA%/app.muffin.launcher` (Windows), `~/Library/Application Support/app.muffin.launcher` (macOS) or `~/.local/share/app.muffin.launcher` (Linux). Your Roblox login is stored in the system credential store (Windows Credential Manager, macOS Keychain, or the Linux Secret Service), not in that folder. Exports never include your login.

**Settings → Privacy & Data** can clear your cache, play history and recent searches.

## For developers

You'll need Node 20+, Rust (MSVC toolchain), Visual Studio Build Tools with "Desktop development with C++", and WebView2.

```powershell
npm install
npm run tauri dev      # run the app
npm run tauri build    # build the installer
npm test               # frontend tests
cd src-tauri; cargo test
```

Muffin is built with Tauri 2 (Rust), React 19, TypeScript and Tailwind 4. All Roblox requests go through the Rust side, which only talks to a fixed list of Roblox hosts.

## Notices

bloxlaunch (GPL-3.0) was used only as a reference for how `roblox://` launch links are written. No code from it is used.

MIT licensed. See `LICENSE`.
