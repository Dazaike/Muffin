# Changelog

All notable changes to Muffin are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [v0.1.1] - 2026-11-02

The commits since v0.1.0 only touch the README (`33c18e2`). The rest of this release was developed in the working tree and is committed together in the release commit, so entries below come from the diff, not individual commits.

### Added
- Fishstrap integration: a Fishstrap settings tab (status, Roblox version, channel, FastFlags editor and import, mods folder, cleanup) and launching through Fishstrap, with a launch prompt.
- Interactive 3D avatar on Home (lazy-loaded, reused across visits) and a Home banner with a rotating welcome and friends panel.
- Friend profile page with avatar, stats, About, and tabs for experiences, favorites, friends, badges, groups, collectibles and wearing. Avatars in friend lists open it.
- Shared-element morphs: game card picture into the details hero, friend avatar into the profile and back.
- Bell watches: notify when a specific friend comes online or a specific game updates.
- Undo toasts for favorite, pin, remove and search-history actions; slide-to-confirm for paid private-server purchases.
- Background colour setting, a colour picker, and a "Reset colours" row in Appearance.
- Slide transition between top-bar pages.
- Linux and macOS bundle configs and a CI workflow (`.github/`).

### Changed
- Account menu rebuilt (hold to remove an account, switch-account sub-page).
- Buttons restyled (Arc-style Button, copy button and action swap on Play, Join and sign-in buttons). Primary buttons stay accent-filled.
- Game details page redesigned (new hero, play section and tabs layout).
- Game card hover Play pill is now an overlay on the picture.
- Pages other than Home, game details and profiles load on demand; the main JS bundle dropped from 905 kB to 482 kB.
- Cards without an icon now look one up, batched, so they get pictures.
- Home sections stream cards and defer below-the-fold rows.

### Fixed
- 3D avatar failing with "too many textures" for avatars with many layered items (limit raised to 64 textures with a total size cap, downloaded in parallel).

### Removed
- Library count badge in the navigation; the old featured hero.

## [v0.1.0] - 2026-11-01

First release. The repository had no prior commits or tags, so this entry describes the initial codebase rather than a diff.

### Added
- Windows desktop launcher built on Tauri 2 (Rust) with a React 19 / TypeScript / Tailwind 4 interface and an NSIS per-user installer.
- Home, Discover, Search, My Library, Favorites, Recently Played, Friends, Wallet, Profile and Settings pages, switched from a top tab bar with a single sliding highlight.
- Game browsing and search from Roblox's public APIs (fetched in Rust through a fixed host allowlist, cached in SQLite). Search runs as the signed-in account when one is active, falling back to guest search.
- Game details page: stats, like/dislike bar, creator or group card, servers, badges, passes, places, social links and "More like this".
- Launching through the `roblox://` protocol handler (Roblox, Bloxstrap or Fishstrap), including saved private servers and joining a specific public server. The Play button is the only direct launch trigger.
- Multi-account Roblox web-session sign-in inside Muffin (cookie kept in Windows Credential Manager, never sent to the UI), friends and presence, Robux balance, transactions and wallet.
- Library with favorites, pinning and custom ordering; play history, playtime tracking and Continue Playing, including the Roblox Continue row.
- Recommendations from favorite and recently played genres, with a growing poster grid.
- Settings: accent colour wheel, card shape and layout, density, custom background image with dim and blur, animation and lightweight modes, tray and close behaviour, autostart, global shortcut `Ctrl+Alt+M`, after-launch action, Robux badge toggle, data export/import and cache clearing.
- Command palette (`Ctrl+K`), onboarding and offline banner.

### Notes
- No OAuth: sign-in is the in-app web-session flow only.
- Live behaviour that needs a signed-in account (friends, private-server management, transactions, voting, age-gated search results, pass ownership) is untested against Roblox.
