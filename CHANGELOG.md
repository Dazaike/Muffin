# Changelog

All notable changes to Muffin are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
