# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IsiPrime (HermesStream) is a self-hosted streaming video application designed to run as a standalone server on a LincStation N2 (Debian 12) for 5-10 remote users. Node.js/Express backend serves a React frontend. Movies and TV series are stored on local disk. All metadata and user data is persisted in SQLite.

## Commands

```bash
# Start server (port 8080, configurable via PORT env)
npm start

# Development with auto-reload
npm run dev

# Build React frontend (output: my-ui/build/)
npm run build

# Build frontend only (from my-ui/)
cd my-ui && npm run build

# Migrate legacy JSON data to SQLite
node scripts/migrate-json-to-sqlite.js

# Batch converter CLI
node batch-converter.js --directory /path --gpu auto --quality 23

# Converter web UI
node converter-server.js
```

## Architecture

### Backend (server.js)
Express 5 server. Serves the React build as static files and all API routes. Listens on `0.0.0.0` for LAN and remote access.

**Storage**: Always local mode. Path configured in `storage-settings.json` (default: `LOCAL_VIDEOS_PATH` env var).

**Authentication (JWT)**: Handled by `lib/auth.js`. LAN IPs are auto-authenticated as admin (configurable via `ALLOW_LAN_AUTH`). External users authenticate with JWT access tokens (15min) + refresh tokens (30d). Passwords hashed with bcrypt. Legacy SHA256 hashes auto-migrate on first login.

**Key env vars**:
- `JWT_SECRET` — Secret for signing JWTs (auto-generated if not set)
- `JWT_ACCESS_EXPIRY` — Access token lifetime (default: `15m`)
- `JWT_REFRESH_EXPIRY` — Refresh token lifetime (default: `30d`)
- `BCRYPT_ROUNDS` — bcrypt cost factor (default: `12`)
- `ALLOW_LAN_AUTH` — LAN auto-auth (default: `true`)
- `DLNA_ENABLED` — Enable DLNA/Cast service (default: `false`)
- `REQUESTS_READONLY` — Read-only mode for requests (default: `false`)
- `TMDB_API_KEY` / `TMDB_API_KEY_BACKUP` — TMDB API keys
- `LOCAL_VIDEOS_PATH` — Default local video directory

### Routes (`routes/`)
| File | Mount Point | Purpose |
|------|------------|---------|
| `auth.js` | `/api/auth` | Login, refresh, logout, register, invitations, user/session management |
| `user-data.js` | `/api` | Per-user progress, favorites, continue-watching |
| `videos.js` | `/api/videos`, `/api/genres` | Movie listing, TMDB enrichment |
| `streaming.js` | `/stream/:filename` | Video streaming with FFmpeg transcoding |
| `series.js` | `/api/series`, `/stream-series/` | TV series listing, episode streaming |
| `requests.js` | `/api/requests` | User movie requests (CRUD + SSE real-time updates) |
| `tmdb.js` | `/api/tmdb` | TMDB search, cast lookup, actor filmography |
| `collections.js` | `/api/collections` | Custom and auto-generated movie collections |
| `downloads.js` | `/api/download-queue`, `/api/search-torrents` | Download queue management |
| `conversion.js` | `/api/convert` | Single video conversion with SSE progress |
| `storage.js` | `/api/storage` | Storage configuration |
| `movies.js` | `/api/movies`, `/api/files` | Poster update, file deletion, renaming |
| `dlna.js` | `/api/dlna`, `/dlna` | DLNA/Cast to TV (optional via `DLNA_ENABLED`) |
| `misc.js` | `/api/` | Utility endpoints (cache cleanup, health) |

Routes receive shared context via factory function pattern: `module.exports = function(deps) { ... }`.

### Libraries (`lib/`)
- **auth.js** — JWT generation/verification, bcrypt hashing, SHA256 legacy migration, `authMiddleware`, `requireRole`, `loginRateLimit`
- **tmdb.js** — Rate-limited TMDB client (35 req/10s queue, multi-strategy search with English fallback, backup API key on 429/timeout)
- **cache.js** — Movie metadata cache (SQLite via `mediaDB`) with TTL expiration
- **series.js** — Series folder scanning, filename parsing (`S01E01` pattern), series cache (SQLite)
- **normalizers.js** — Convert cache format to API response format
- **utils.js** — Title normalization, similarity scoring, video extension regex, constants
- **collections.js** — Collection CRUD (SQLite), auto-generation by genre/year/decade
- **requests-helpers.js** — Request operations (SQLite), auto-detect from filenames
- **download-helpers.js** — Download queue persistence (SQLite) and state tracking
- **dlna.js** — DLNA/UPnP service, media renderer client, LG webOS SSAP control (pause/resume/volume via WebSocket on port 3000). Cast strategies: Browser+fMP4 (primary), Media Viewer native, Web Video Caster, Browser+proxy

### Database (`db/`)
All data persisted in SQLite via `better-sqlite3` (WAL mode):

- **`db/media-db.js`** → `isiprime.db` — 5 tables: `movies_cache`, `series_cache`, `series_episodes`, `collections`, `download_queue`. 30+ exported functions.
- **`db/users-db.js`** → `isiprime.db` — 5 tables: `users`, `sessions`, `user_progress`, `user_favorites`, `invitations`. 29 exported functions. Seeds admin user on first init.
- **`db/requests-db.js`** → `requests.db` — Movie requests with statuses: `pending`, `downloading`, `downloaded`, `mp4`, `server`, `rejected`.

**Migration**: Run `node scripts/migrate-json-to-sqlite.js` to import legacy JSON files (`cache.json`, `cache-series.json`, `series-episodes.json`, `collections.json`, `download-queue.json`) into SQLite.

### Frontend (`my-ui/`)
React 19 app with Tailwind CSS and Framer Motion. Built with react-scripts, output served from `my-ui/build/`.

**Auth flow** (`my-ui/src/utils/api.js`): Access token stored in memory, refresh token in `localStorage`. `authFetch()` auto-refreshes on 401. For `<video>` and `EventSource` (which can't set headers), token is passed via `?token=` query param.

**Hooks** (in `my-ui/src/hooks/`):
- `useAuth` — JWT login/refresh/logout, LAN auto-auth fallback
- `useVideos` — Catalog + favorites (server-synced) + search
- `useSeries` — Series + episodes
- `useRequests` — Requests + SSE real-time updates
- `useUsers` — User management + invitations (admin CRUD, create/delete users, generate invitation codes)
- `useVideoProgress` — Playback position (server-synced + localStorage cache)
- `useVolumeBoost` — Audio gain control
- `useRecommendations` — AI-based personalized recommendations
- `useCast` — DLNA/Cast to TV

**Components** (in `my-ui/src/components/`):
- `VideoPlayer.js` — Custom video player with seek bar (mouse+touch), thumbnail preview, volume boost, PiP, fullscreen, cast button, keyboard shortcuts, recommended movies
- `UserManagementModal.js` — Admin modal: user CRUD + invitation management (2 tabs)
- `CastButton.js` — Cast to TV button with status indicator
- `CastDeviceModal.js` — DLNA device selector modal
- `RandomPickerModal.js` — Smart random movie picker
- `RequestsAdminModal.js` — Requests management modal

**App.js** is the central hub — manages all state via hooks, role-based UI (admin sees user management + requests admin, viewer does not). Includes inline registration page triggered by `?code=` URL parameter.

### Batch Converter
Two entry points:
- `batch-converter.js` — CLI tool for mass AVI/MKV→MP4 conversion with GPU acceleration
- `converter-server.js` + `converter-ui/index.html` — Web UI for the same

### Requests System
Requests stored in SQLite (`requests.db`). Auto-detection marks movies as "server" when found on disk. Requests with status `downloaded`/`server` are auto-deleted after 7 days based on `requestedAt`. `REQUESTS_READONLY` env var makes the instance view-only.

## Key Patterns

- **JWT Auth**: Access token (15min, in memory) + refresh token (30d, localStorage). Token rotation on refresh. Rate limiting on login (5 attempts/15min per IP).
- **SSE (Server-Sent Events)**: Used for real-time request updates and conversion progress. Token passed via query string (`?token=`).
- **Per-user data**: Video progress and favorites synced to server (SQLite), with localStorage as fallback cache. Server has authoritative data.
- **Role-based access**: `admin` role can manage users, invitations, requests. `viewer` role has standard access. LAN users auto-authenticated as admin.
- **Series detection**: Regex `S\d{1,2}E\d{1,2}` in filename routes files to `Series/series_name/` subdirectory.
- **Streaming**: MP4 served directly with range requests. MKV served with `video/x-matroska` mime type. AVI transcoded on-the-fly via FFmpeg. Protected by JWT (token in query string for `<video>` elements).
- **TMDB multi-strategy search**: Tries 5 strategies (exact, main title, year variants, partial, English) before giving up.
- **SQLite singleton pattern**: Each db module (`media-db.js`, `users-db.js`, `requests-db.js`) creates its own `Database` instance with WAL mode. Tables auto-created on `init()`.

### webOS Native TV App (`IsiPrime-WebOS-Native/`)
Standalone vanilla JS app for LG webOS 6.0 TVs (Chromium ~87). NO frameworks, NO ES modules, NO build step. Connects to the IsiPrime server via HTTP API.

**Technical constraints**: No `aspect-ratio` CSS (uses `padding-bottom: 150%`), no `?.`, no `??`, no `replaceAll()`. Uses `window.App` namespace pattern.

**Architecture** (13 JS modules loaded via `<script>` tags in dependency order):
| Module | Purpose |
|--------|---------|
| `config.js` | Constants, TMDB image helpers, key codes |
| `api.js` | HTTP client with JWT auth + auto-refresh on 401 |
| `login.js` | Login screen for remote (non-LAN) users |
| `images.js` | Lazy loading with IntersectionObserver (max 4 concurrent) |
| `focus.js` | D-pad navigation engine (groups, vertical/horizontal movement) |
| `carousel.js` | Virtual horizontal carousel (only renders visible items + buffer) |
| `router.js` | State machine (LOADING→HOME→DETAIL→PLAYER→SERIES→SEARCH) |
| `home.js` | Genre carousels, continue-watching, series, favorites sections |
| `detail.js` | Movie/series detail overlay with backdrop, cast, play/favorite buttons |
| `player.js` | Fullscreen video player with remote controls, resume dialog, progress save |
| `series.js` | Series detail with season tabs + episode list |
| `search.js` | On-screen keyboard + local search results |
| `app.js` | Bootstrap, data loading, nav bar setup (loaded last) |

**Auth**: LAN users auto-authenticated (no login). Remote users see login form, JWT stored in memory/localStorage.

**Commands**:
```bash
# Package for webOS
cd IsiPrime-WebOS-Native && ares-package .

# Install on TV
ares-install --device IsiPrimeTV com.isiprime.app_2.0.0_all.ipk

# Renew Developer Mode (cron every 24h)
scripts/renew-webos-devmode.sh
```

## Install Package

`IsiPrime-Install/` contains a standalone read-only package for other users. Has its own `.env`, `INSTALAR.bat` (auto-installs Node.js + deps), and `IsiPrime.bat` (launcher). Must be manually updated when the main codebase changes.

## Troubleshooting

- **Black screen**: `my-ui/build/` missing or corrupted. Restore from `backups/build-backup-*` or run `npm run build`.
- **SQLite "invalid ELF header"**: Native module compiled for wrong architecture. Run `npm rebuild better-sqlite3` on the target machine.
- **Auth not working**: Ensure `JWT_SECRET` is set consistently (if server restarts with auto-generated secret, existing tokens become invalid).
- **DLNA not starting**: Set `DLNA_ENABLED=true` in `.env` and restart the server.
