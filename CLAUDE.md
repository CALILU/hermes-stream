# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IsiPrime (HermesStream) is a self-hosted streaming video application running on a LincStation N2 (Ubuntu 24.04 Server) for 5-10 remote users. Node.js/Express backend serves a React frontend. Movies and TV series are stored on local NVMe disk (4TB). All metadata and user data is persisted in SQLite. Server managed by PM2 (fork mode). Accessible via HTTPS at `calilu.mooo.com` (nginx + Let's Encrypt) and LAN at `192.168.1.45:8080`.

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
- `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM_NAME` — Gmail SMTP for newsletter emails

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
| `collections.js` | `/api/collections` | Custom and auto-generated movie collections. `/:id/full` returns full TMDB details (cached 14 days in SQLite) |
| `downloads.js` | `/api/download-queue`, `/api/search-torrents` | Download queue management |
| `conversion.js` | `/api/convert` | Single video conversion with SSE progress (duplicate protection) |
| `newsletter.js` | `/api/newsletter` | Newsletter email system (preview, send, test, history) |
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
- **normalizers.js** — Convert cache format to API response format. `normalizeCast()` converts legacy TMDB photo URLs to proxy format via `ensureFullPosterURL()`
- **probe.js** — FFprobe wrapper: extracts video_codec, audio_codec, audio_channels, audio_sample_rate, bitrate, dimensions, duration
- **utils.js** — Title normalization, similarity scoring, video extension regex, constants
- **collections.js** — Collection CRUD (SQLite), auto-generation by genre/year/decade
- **requests-helpers.js** — Request operations (SQLite), auto-detect from filenames
- **download-helpers.js** — Download queue persistence (SQLite) and state tracking
- **dlna.js** — DLNA/UPnP service, media renderer client, LG webOS SSAP control (pause/resume/volume via WebSocket on port 3000). Cast strategies: Browser+fMP4 (primary), Media Viewer native, Web Video Caster, Browser+proxy
- **email.js** — SMTP email sending via nodemailer (Gmail)
- **email-template.js** — Newsletter HTML template (dark Netflix-style, table-based, inline CSS, genre grouping)

### Database (`db/`)
All data persisted in SQLite via `better-sqlite3` (WAL mode):

- **`db/media-db.js`** → `isiprime.db` — 6 tables: `movies_cache` (+ `audio_sample_rate` column), `series_cache`, `series_episodes`, `collections`, `collection_details_cache`, `download_queue`. 30+ exported functions. `collection_details_cache` stores TMDB collection movie details with 14-day TTL.
- **`db/users-db.js`** → `isiprime.db` — 7 tables: `users` (+ `email`, `email_notifications` columns), `sessions`, `user_progress`, `user_favorites`, `invitations`, `newsletter_logs`, `newsletter_movies`. 36+ exported functions. Seeds admin user on first init.
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
- `useUsers` — User management + invitations (admin CRUD, create/delete/update users, email management, generate invitation codes)
- `useVideoProgress` — Playback position (server-synced + localStorage cache)
- `useVolumeBoost` — Audio gain control
- `useRecommendations` — AI-based personalized recommendations
- `useCast` — DLNA/Cast to TV
- `useNewsletter` — Newsletter management (movie selection, preview, send, history, sent-movie tracking)

**Components** (in `my-ui/src/components/`):
- `VideoPlayer.js` — Custom video player with seek bar (mouse+touch), thumbnail preview, volume boost, PiP, fullscreen, cast button, keyboard shortcuts, recommended movies
- `UserManagementModal.js` — Admin modal: user CRUD (with email) + invitation management (2 tabs)
- `NewsletterModal.js` — Newsletter admin modal: movie selector (with "sent" badges), preview, send/test, history (3 tabs)
- `CastButton.js` — Cast to TV button with status indicator
- `CastDeviceModal.js` — DLNA device selector modal
- `RandomPickerModal.js` — Smart random movie picker
- `RequestsAdminModal.js` — Requests management modal

**App.js** is the central hub — manages all state via hooks, role-based UI (admin sees user management + newsletter + requests admin, viewer does not). Includes inline registration page triggered by `?code=` URL parameter. Section headers are sticky. Pagination loads 20 items at a time.

### Batch Converter
Two entry points:
- `batch-converter.js` — CLI tool for mass AVI/MKV→MP4 conversion with GPU acceleration
- `converter-server.js` + `converter-ui/index.html` — Web UI for the same

### Newsletter System
Email newsletter for notifying users about new movies. Admin selects movies (with "already sent" badges), previews HTML email, and sends to all users with email configured. Uses nodemailer with Gmail SMTP. Dark Netflix-style template with genre grouping, table-based layout, inline CSS. Sent movies tracked in `newsletter_movies` table to avoid duplicates. History with delete support.

### Requests System
Requests stored in SQLite (`requests.db`). Auto-detection marks movies as "server" when found on disk. Requests with status `downloaded`/`server` are auto-deleted after 7 days based on `requestedAt`. `REQUESTS_READONLY` env var makes the instance view-only.

## Key Patterns

- **JWT Auth**: Access token (15min, in memory) + refresh token (30d, localStorage). Token rotation on refresh. Rate limiting on login (5 attempts/15min per IP).
- **SSE (Server-Sent Events)**: Used for real-time request updates and conversion progress. Token passed via query string (`?token=`).
- **Per-user data**: Video progress and favorites synced to server (SQLite), with localStorage as fallback cache. Server has authoritative data.
- **Role-based access**: `admin` role can manage users, invitations, requests. `viewer` role has standard access. LAN users auto-authenticated as admin.
- **Series detection**: Regex `S\d{1,2}E\d{1,2}` in filename routes files to `Series/series_name/` subdirectory.
- **Streaming**: MP4/MKV served via MSE/fMP4 (FFmpeg remux). Direct mode (`v.src`) disabled — webOS `enableVideoHole: true` causes `MEDIA_ELEMENT_ERROR` in iframes. Audio passthrough when AAC stereo ≤48kHz; otherwise re-encode to AAC stereo 48kHz 192kbps (`-ar 48000 -ac 2 -b:a 192k`). AVI transcoded on-the-fly. Protected by JWT (token in query string).
- **Cache fallback by basename**: `routes/videos.js` falls back to matching by filename without extension when exact match not found. Handles MKV→MP4 conversions where cache key is the old `.mkv` filename. Auto-migrates cache entry to new filename.
- **TV Player iframe architecture**: Parent (`player.js`) shows loading overlay, auto-resumes from saved position (no confirmation dialog), saves progress every 10s, forwards keys via `postMessage`. Iframe (`/tv-player`) handles video element, controls UI, loading spinner, and sends `timeupdate`/`progress`/`back`/`ended`/`playing` messages to parent. Controls cannot overlay iframe on webOS Chromium 87, so all UI is inside the iframe.
- **MSE duration workaround**: fMP4 streaming with `empty_moov` reports `v.duration = Infinity`. Real duration fetched from `/video-duration/:filename` (FFprobe). Absolute position calculated as `seekStartPos + v.currentTime` since FFmpeg `-ss` resets timestamps to 0.
- **TMDB multi-strategy search**: Tries 5 strategies (exact, main title, year variants, partial, English) before giving up.
- **SQLite singleton pattern**: Each db module (`media-db.js`, `users-db.js`, `requests-db.js`) creates its own `Database` instance with WAL mode. Tables auto-created on `init()`.
- **TV App auto-update**: IPK is a minimal bootstrap (`config.js` local + dynamic loader). 17 JS modules + CSS loaded from `SERVER_URL/tv-app/` with `?v=timestamp` cache-bust. Fallback to local IPK copy on server failure. Update flow: edit in `IsiPrime-WebOS-Native/` → `bash scripts/sync-tv-app.sh` → TVs load new version on next app open. `tv-app/` served via `express.static` with `maxAge:0, etag:true`.

### webOS Native TV App (`IsiPrime-WebOS-Native/`)
Standalone vanilla JS app for LG webOS TVs. NO frameworks, NO ES modules, NO build step. Connects to the IsiPrime server via HTTP API. Compatible with webOS 4.0+ (Chromium ~53+). **Auto-update**: IPK is a minimal bootstrap; 17 JS modules + CSS loaded dynamically from server (`/tv-app/`) with local fallback. Only `config.js` stays local in IPK.

**Target TVs**:
| Device | Model | webOS | Chromium | IP | Connection |
|--------|-------|-------|----------|-----|-----------|
| `miLGTV` | LG 43UP80006LR | 6.0 | ~87 | 192.168.1.94 | Wired |
| `nuevaTV` | LG 32LK6100PLB (2018) | 4.0 | ~53 | 192.168.1.108 | WiFi (Archer) |

**Technical constraints** (lowest common denominator — webOS 4.0/Chromium ~53):
- No `URLSearchParams`, `fetch`, `AbortController`, `ReadableStream` (use XHR/regex)
- No `aspect-ratio` CSS (uses `padding-bottom: 150%`), no `display:grid` (use flexbox), no `?.`, no `??`, no `replaceAll()`
- `IntersectionObserver` exists but is unreliable on webOS 4.0 — images loaded directly with concurrency limit
- `appinfo.json` must include `accessibleUrl: "http://*:*;https://*:*"` for external HTTP requests
- Uses `window.App` namespace pattern

**Architecture** (17 JS modules loaded dynamically from server, fallback to local):
| Module | Purpose |
|--------|---------|
| `config.js` | Constants, TMDB image helpers (detect full URLs), key codes, APP_VERSION (always local in IPK) |
| `api.js` | HTTP client with JWT auth + auto-refresh on 401, actor filmography |
| `login.js` | Login screen for remote (non-LAN) users |
| `images.js` | Direct image loading with concurrency limit (max 20) + 15s timeout protection |
| `focus.js` | D-pad navigation engine (groups, vertical/horizontal movement) |
| `carousel.js` | Virtual horizontal carousel (only renders visible items + buffer) |
| `router.js` | State machine (LOADING→HOME→DETAIL→PLAYER→SERIES→SEARCH→ACTOR→SAGAS) |
| `home.js` | Genre carousels, continue-watching, series, favorites sections |
| `detail.js` | Movie/series detail overlay with backdrop, cast grid (D-pad + click navigation), play/favorite/saga buttons |
| `player.js` | Video player: iframe to `/tv-player`, loading overlay, auto-resume, progress save, key forwarding |
| `series.js` | Series detail with season tabs + episode list |
| `search.js` | On-screen keyboard + local search results (dynamic column detection) |
| `actor.js` | Actor filmography grid — shows only locally available movies, TMDB data via `/api/tmdb/actor` |
| `sagas.js` | Collection/saga browser — sidebar list + movie grid, unavailable movies in B&W with request toggle |
| `app.js` | Bootstrap, data loading, nav bar setup, version label (loaded last) |

**Auth**: LAN users auto-authenticated (no login). Remote users see login form, JWT stored in memory/localStorage.

**TV Player** (`/tv-player`): Inline HTML page served by `server.js` for video playback inside an iframe. Uses Chromium ~53 compatible JS (regex params, XHR for duration). Contains its own transport controls (play/pause, seek ±10s, stop), interactive progress bar (click to seek), title bar, time display, and **loading spinner** (shown during buffering, hidden on `canplay`/`playing`). Streaming strategy: MSE/fMP4 forced (direct mode disabled for webOS `enableVideoHole` compatibility), with XHR fallback for older browsers. Duration fetched via FFprobe (`/video-duration/:filename`) using XHR. Seek reloads iframe at new position. Supports both D-pad remote (keydown) and Magic Remote (mousemove/click).

**MSE duration workaround**: fMP4 streaming with `empty_moov` reports `v.duration = Infinity`. Real duration fetched from `/video-duration/:filename` (FFprobe). Absolute position calculated as `seekStartPos + v.currentTime` since FFmpeg `-ss` resets timestamps to 0.

**UI Details (v2.11.2)**:
- Loading screen: HD logo (1024x1024 `assets/icon-hd.png`) centered, spinner below, background `#1a1a2e`
- Nav bar: icon (112px) + logo text (108px) + version label (`v2.11.2`, 18px, white 85%) + nav buttons (30px font)
- Detail view: enlarged meta (23px), genres (20px), overview (24px), buttons (26px), cast photos (105px), cast names (19px)
- Cast grid: flex-wrap with D-pad vertical navigation between rows (calculates columns per row dynamically)
- Hover tooltip: Magic Remote pointer shows movie/actor name on mouseenter (carousel, featured, cast items, actor grid, search results)
- Loading spinner: purple spinner with "Cargando película..." in player.js overlay + "Cargando..." in tv-player iframe, fades out on playback start, reappears during buffering

**Commands**:
```bash
# Package for webOS
cd IsiPrime-WebOS-Native && ares-package .

# Install on TVs
ares-install --device miLGTV com.isiprime.app_2.11.2_all.ipk    # comedor
ares-install --device nuevaTV com.isiprime.app_2.11.2_all.ipk   # hijo

# Update TV app WITHOUT reinstalling IPK (auto-update system)
bash scripts/sync-tv-app.sh    # copies JS/CSS to tv-app/ + scp to NAS

# Debug: close + relaunch + inspect
ares-launch --device miLGTV --close com.isiprime.app
ares-launch --device miLGTV com.isiprime.app
ares-inspect --device miLGTV --app com.isiprime.app

# Renew Developer Mode (cron every 24h)
scripts/renew-webos-devmode.sh
```

## NAS (LincStation N2) — Operational

**Hardware**: LincStation N2 (Intel N100, 16GB LPDDR5, 128GB eMMC, Ubuntu 24.04 Server). IP: `192.168.1.45` (static). Movies on WD_Black SN7100 4TB NVMe (NTFS, mounted via ntfs-3g at `/mnt/peliculas`). PM2 in fork mode (SQLite not cluster-safe).

**Services running**:
- IsiPrime via PM2 (`pm2-isidro.service`, auto-start on boot)
- nginx reverse proxy + Let's Encrypt SSL (`calilu.mooo.com`)
- lincstation-leds daemon (I2C LED control)
- fail2ban (SSH + nginx jails)
- UFW firewall (SSH/80/443 open; Samba/8080 LAN-only)
- certbot auto-renewal (SSL cert expires 2026-05-30)
- Developer Mode renewal cron (daily 3AM for webOS TVs)

**Migration scripts** (in `scripts/`):
- `transfer-to-nas.sh` — Run from WSL: rsync code + build + DBs to NAS
- `migrate-to-nas.sh` — Run on NAS: validates Node.js, FFmpeg, gcc, files, storage path
- `start-tv-nas.sh` — NAS version of start-tv.sh (no rclone, PM2 support)
- `setup-nginx-https.sh` — nginx + Let's Encrypt setup
- `renew-webos-devmode.sh` — cron script for Developer Mode extension
- `sync-tv-app.sh` — Copies JS/CSS from `IsiPrime-WebOS-Native/` to `tv-app/` + scp to NAS
- `check-audio.js` — Analyzes all MP4 files for non-standard audio (codec, channels, sample rate)
- `normalize-audio.js` — Re-encodes audio to AAC stereo 48kHz 192kbps (FFmpeg remux)

**Config files**:
- `ecosystem.config.js` — PM2 config (fork mode, 1 instance, logs in `logs/`)
- `.env.nas` — Template .env for NAS
- `HermesStream.bat` — Simplified launcher (just opens browser to NAS URL)

## Install Package

`IsiPrime-Install/` contains a standalone read-only package for other users. Has its own `.env`, `INSTALAR.bat` (auto-installs Node.js + deps), and `IsiPrime.bat` (launcher). Must be manually updated when the main codebase changes.

## Redirect IPK (for other LG TVs)

`IsiPrime-WebOS-Redirect/` is a lightweight webOS app (`com.isiprime.redirect`) that redirects to the IsiPrime web UI. Tries HTTPS (`calilu.mooo.com`) first, falls back to LAN IP. For TVs that don't have the native app installed — opens IsiPrime in the TV's built-in browser.

**Config**: Edit `SERVER_URL` and `SERVER_URL_LAN` in `index.html` before packaging.

```bash
cd IsiPrime-WebOS-Redirect && ares-package .
ares-install --device <TV> com.isiprime.redirect_1.0.0_all.ipk
```

## HTTPS / nginx — Active

`scripts/setup-nginx-https.sh` — nginx reverse proxy + Let's Encrypt SSL. DDNS via No-IP (`calilu.mooo.com`). DMZ active on Livebox 6 pointing to NAS. Certificate auto-renews via certbot systemd timer.

## Troubleshooting

- **Black screen**: `my-ui/build/` missing or corrupted. Restore from `backups/build-backup-*` or run `npm run build`.
- **SQLite "invalid ELF header"**: Native module compiled for wrong architecture. Run `npm rebuild better-sqlite3` on the target machine.
- **Auth not working**: Ensure `JWT_SECRET` is set consistently (if server restarts with auto-generated secret, existing tokens become invalid).
- **DLNA not starting**: Set `DLNA_ENABLED=true` in `.env` and restart the server.
- **Video won't play on webOS (Format error code 4)**: Direct mode conflicts with `enableVideoHole`. Ensure `directMode=false` in tv-player. All streaming must go through MSE/fMP4.
- **5.1 audio doesn't play on webOS**: MSE on webOS can't handle multichannel AAC. The fMP4 route auto-downmixes to stereo when `audio_channels > 2`.
- **96kHz audio stutters on webOS**: MSE decoders don't support high sample rates. The fMP4 route re-encodes to 48kHz when `audio_sample_rate > 48000`. Run `scripts/normalize-audio.js` on NAS to permanently fix source files.
- **TV app not updating**: If `scripts/sync-tv-app.sh` was run but TV still shows old code, close and reopen the app (scripts are loaded with `?v=timestamp` cache-bust). If the IPK itself is too old (before dynamic loader), reinstall the IPK.
- **TV app stuck on loading screen**: Dynamic script loading means `DOMContentLoaded` fires before scripts finish. `app.js` uses `document.readyState` check instead of the event. If stuck, the loader or a module failed to load — check console via `ares-inspect`.

## Docker

A `Dockerfile` and `.dockerignore` are included for containerized deployment. The image builds on `node:20-slim` with FFmpeg installed.
