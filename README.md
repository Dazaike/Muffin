# Muffin

A fast Roblox desktop launcher for Windows. Tauri 2 (Rust) + React 19 + TypeScript + Tailwind 4.

Browse and search real Roblox experiences, keep a library and favorites, save private-server share links, and launch games through the registered `roblox://` handler (Roblox Player, Bloxstrap, Fishstrap, …). Guest mode is fully functional; Roblox sign-in is optional.

## Prerequisites
- Node 20+
- Rust stable (MSVC toolchain)
- Visual Studio Build Tools with "Desktop development with C++"
- WebView2 runtime (ships with Windows 11)

## Develop / build
```powershell
npm install
npm run tauri dev
npm run tauri build   # -> src-tauri/target/release/bundle/nsis/Muffin_<ver>_x64-setup.exe
npm test              # frontend unit tests
cd src-tauri; cargo test
```

## Roblox sign-in (optional)

Choose **Sign in to Roblox** in the account menu, Profile, Settings → Account or first-run setup. It opens Roblox's own login page in an isolated WebView2 window; complete any security challenges with Roblox. Muffin stores the resulting session cookie in Windows Credential Manager (`app.muffin.launcher` / `roblox-web-session:<userId>`), and uses it to request your Robux balance, friends, created games and favorited games. This cookie grants account access; never share it. Removing an account deletes Muffin's saved session but does not revoke the session at Roblox.

There is no OAuth sign-in and no client ID or app registration to configure. Muffin works fully as a guest without signing in.

Roblox may reject embedded login or use of the session outside the webview. Its legacy account APIs may change or restrict access; errors are shown rather than inventing data. This session is separate from Roblox Player's login.

## Limitations
- **Account features need the in-app sign-in.** Robux, friends, presence, friend requests, Robux transactions, private-server purchase/management, voting and tray notifications use the Roblox website session from the in-app sign-in. Roblox may change or restrict these undocumented endpoints; failures are shown, never faked. Many were not verified against a live account.
- **Multiple accounts** can be added and switched in Muffin. This does not change which account Roblox Player uses.
- **Playtime** is attributed to the last game launched through Muffin (`RobloxPlayerBeta.exe` detection) and is an estimate; games started outside Muffin are not recorded.
- **Notifications** only work while Muffin is running (including in the tray) and show counts, never message text.
- **After launch** (Settings → Launcher) can keep Muffin open, hide it to the tray, or close it once `RobloxPlayerBeta.exe` is detected within 60 s of a launch from Muffin. Closing Muffin stops playtime tracking; a session already open is closed at the last moment Muffin saw the player.
- **Robux balance** in the top bar shows only while a Roblox account is signed in (hide it in Settings → Account → Top bar); it refreshes every 60 s while the window is visible.
- **Import/export** is a local JSON file (no tokens or cookies); there is no cloud sync.
- Not built by design: avatar editor, marketplace/inventory/trading, Roblox account/security settings.
- **Launch ≠ connected.** Muffin hands the launch to the registered `roblox://` handler; it cannot know if the game started.
- The Roblox Player uses its own login. Games launch as whichever account the Player/bootstrapper is signed into, which may differ from the account you signed in with inside Muffin.
- Private servers: only the share-link form `https://www.roblox.com/share?code=…&type=Server` is accepted.

## Data
- `%APPDATA%/app.muffin.launcher/muffin.db`: library, history, private-server codes, recent searches, settings, API cache.
- Roblox website session cookies (one per signed-in account): Windows Credential Manager (`app.muffin.launcher` / `roblox-web-session:<userId>`), never the database.
- Settings → Privacy & Data can clear cache, history and searches.

## Notices
bloxlaunch (GPL-3.0) was used only as a behavioral reference for the `roblox://` launch URI forms. No code from it is used.

MIT licensed — see `LICENSE`.
