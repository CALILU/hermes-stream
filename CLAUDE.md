# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

IsiPrime (HermesStream) is a streaming video application. Node.js/Express backend serves a React frontend. Movies and TV series are stored on a Synology NAS via FTP or on local disk, with automatic fallback between modes.

## Commands

```bash
# Start server (port 8080)
npm start

# Development with auto-reload
npm run dev

# Build React frontend (output: my-ui/build/)
npm run build

# Build frontend only (from my-ui/)
cd my-ui && npm run build

# Batch converter CLI
node batch-converter.js --directory /path --gpu auto --quality 23

# Converter web UI
node converter-server.js
```

## Architecture

### Backend (server.js)
Express server on port 8080. Serves the React build as static files and all API routes. Listens on `0.0.0.0` for LAN access.

**Dual storage mode** configured in `storage-settings.json`:
- **FTP mode**: Connects to NAS via basic-ftp (host/credentials in `.env`)
- **Local mode**: Reads directly from disk path (e.g., `E:\`)
- Auto-detects: if `localPath` is accessible, uses local; otherwise falls back to FTP

**Authentication**: Local network IPs (192.168.x.x, 10.x.x.x, 127.x) are auto-authenticated. External IPs require session token login. Default credentials in `users.json`.

### Routes (`routes/`)
| File | Mount Point | Purpose |
|------|------------|---------|
| `videos.js` | `/api/videos`, `/api/genres` | Movie listing, TMDB enrichment |
| `streaming.js` | `/stream/:filename` | Video streaming with FFmpeg transcoding |
| `series.js` | `/api/series`, `/stream-series/` | TV series listing, episode streaming, watch progress |
| `requests.js` | `/api/requests` | User movie requests (CRUD + SSE real-time updates) |
| `tmdb.js` | `/api/tmdb` | TMDB search, cast lookup, actor filmography |
| `collections.js` | `/api/collections` | Custom and auto-generated movie collections |
| `downloads.js` | `/api/download-queue`, `/api/search-torrents` | Download queue, Tor Browser torrent search |
| `conversion.js` | `/api/convert` | Single video conversion with SSE progress |
| `storage.js` | `/api/storage` | Storage mode switching (FTP/local) |
| `movies.js` | `/api/movies`, `/api/files` | Poster update, file deletion, renaming |
| `misc.js` | `/api/` | Utility endpoints |

Routes receive shared context via `initRoutes(context)` pattern. Context includes `storageConfig`, `FTP_CONFIG`, `TMDB_CONFIG`, `requestsDB`, `REQUESTS_READONLY`, and SSE client arrays.

### Libraries (`lib/`)
- **ftp-helper.js** — FTP client factory with auto-cleanup wrapper
- **tmdb.js** — Rate-limited TMDB client (35 req/10s queue, multi-strategy search with English fallback, backup API key on 429/timeout)
- **cache.js** — Movie metadata cache (`cache.json`) with TTL expiration
- **series.js** — Series folder scanning, filename parsing (`S01E01` pattern), series cache
- **normalizers.js** — Convert cache format to API response format
- **utils.js** — Title normalization, similarity scoring, video extension regex, constants
- **collections.js** — Collection CRUD, auto-generation by genre/year/decade
- **requests-helpers.js** — Request operations, auto-detect from filenames
- **download-helpers.js** — Download queue persistence and state tracking

### Frontend (`my-ui/`)
React 19 app with Tailwind CSS and Framer Motion. Built with react-scripts, output served from `my-ui/build/`.

**Hooks** (in `my-ui/src/hooks/`): `useVideos` (catalog + favorites + search), `useSeries` (series + episodes + progress), `useRequests` (requests + SSE), `useAuth` (login/session), `useVideoProgress` (playback position), `useVolumeBoost` (audio gain).

**App.js** is the central hub — manages all state via hooks and orchestrates 12+ modal components.

### Batch Converter
Two entry points:
- `batch-converter.js` — CLI tool for mass AVI/MKV→MP4 conversion with GPU acceleration
- `converter-server.js` + `converter-ui/index.html` — Web UI for the same, with directory scanning, progress tracking, and optional FTP upload after conversion

### Database
- **SQLite** (`requests.db` via better-sqlite3, WAL mode) — Movie requests with statuses: `pending`, `downloading`, `downloaded`, `mp4`, `server`, `rejected`
- **JSON files** — `cache.json` (movie metadata), `cache-series.json`, `series-episodes.json`, `collections.json`, `download-queue.json`, `users.json`

### Requests System
Requests can be stored in SQLite (local mode) or JSON on FTP. Auto-detection marks movies as "server" when found on disk/FTP. Requests with status `downloaded`/`server` are auto-deleted after 7 days based on `requestedAt` (not `updatedAt`, to prevent auto-detection from resetting the timer). `REQUESTS_READONLY` env var makes the install package view-only.

## Key Patterns

- **SSE (Server-Sent Events)**: Used for real-time request updates and conversion progress. Client arrays maintained in server context.
- **Series detection**: Regex `S\d{1,2}E\d{1,2}` in filename routes files to `Series/series_name/` subdirectory.
- **Streaming**: MP4 served directly with range requests. MKV served with `video/x-matroska` mime type. AVI transcoded on-the-fly via FFmpeg.
- **TMDB multi-strategy search**: Tries 5 strategies (exact, main title, year variants, partial, English) before giving up.

## Install Package

`IsiPrime-Install/` contains a standalone read-only package for other users. Has its own `.env` (pointing to `calilu.mooo.com` FTP), `INSTALAR.bat` (auto-installs Node.js + deps), and `IsiPrime.bat` (launcher). Must be manually updated when the main codebase changes.

## Troubleshooting

- **Black screen**: `my-ui/build/` missing or corrupted. Restore from `backups/build-backup-*` or run `npm run build`.
- **FTP timeout in WSL**: DNS issue. Run server from Windows PowerShell instead, or `wsl --shutdown` and retry.
- **Videos won't play after WiFi drop**: FTP connection lost. Restart the server.
