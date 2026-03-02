require('dotenv').config(); // Cargar variables de entorno del archivo .env

const express = require('express');
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fsSync = require('fs');
const fs = require('fs').promises;
const { exec } = require('child_process');

// Base de datos SQLite
const requestsDB = require('./db/requests-db');
const mediaDB = require('./db/media-db');
const usersDB = require('./db/users-db');

// ========== AUTENTICACIÓN JWT ==========
const auth = require('./lib/auth');
const jwtAuthMiddleware = auth.authMiddleware(usersDB);

// ========== MÓDULOS COMPARTIDOS ==========
const { normalizeText, getMainTitle, calculateSimilarity, cleanFilenameForSearch, formatBytes, ensureFullPosterURL, VIDEO_EXTENSIONS_REGEX, TMDB_IMAGE_BASE: TMDB_IMG_BASE_LIB, CAST_LIMIT } = require('./lib/utils');
const { createTMDBClient } = require('./lib/tmdb');
const { normalizeCacheToAPI, processTMDBExtendedData } = require('./lib/normalizers');
const { createCollectionsManager } = require('./lib/collections');
const { createCacheManager } = require('./lib/cache');
const { createSeriesManager } = require('./lib/series');
const { createRequestsHelpers } = require('./lib/requests-helpers');
const { createDownloadHelpers } = require('./lib/download-helpers');
const posterCache = require('./lib/poster-cache');
const { probeNewFiles } = require('./lib/probe');

const app = express();

const requestsSSEClients = new Set(); // Clientes SSE para actualizaciones de peticiones

// ============================================
// CONFIGURACIÓN EXPRESS
// ============================================

// Configurar CORS para permitir peticiones desde el frontend
app.use(cors({
    origin: true, // Permitir cualquier origen (controlamos con auth)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json()); // Middleware para parsear JSON en todas las rutas

// Middleware de logging para debug
app.use((req, res, next) => {
    const clientIP = auth.getClientIP(req);
    const isLocal = auth.isLocalIP(clientIP);
    console.log(`📨 ${req.method} ${req.path} [${isLocal ? '🏠 Local' : '🌍 Externo'}: ${clientIP}]`);
    next();
});

// ============================================
// RUTAS DE AUTENTICACIÓN (JWT)
// ============================================
app.use('/api/auth', require('./routes/auth')({ usersDB, auth }));

// Endpoint de test (público)
app.get('/api/test', (req, res) => {
    console.log('✅ Test endpoint alcanzado');
    res.json({ success: true, message: 'Backend funcionando correctamente', timestamp: new Date().toISOString() });
});

// ============================================
// PROTEGER RUTAS DE API (excepto auth y públicas)
// ============================================
app.use('/api', (req, res, next) => {
    const publicPaths = ['/auth/', '/test', '/storage/config', '/img/'];
    if (publicPaths.some(p => req.path.startsWith(p))) {
        return next();
    }
    return jwtAuthMiddleware(req, res, next);
});

// Proteger rutas de streaming
app.use('/stream', jwtAuthMiddleware);
app.use('/stream-series', jwtAuthMiddleware);

// ========== DATOS PER-USER (progreso, favoritos) ==========
app.use('/api', require('./routes/user-data')({ usersDB, authMiddleware: jwtAuthMiddleware }));

// ========== MODO DE ALMACENAMIENTO (SIEMPRE LOCAL) ==========
const STORAGE_SETTINGS_FILE = path.join(__dirname, 'storage-settings.json');

// Configuración de almacenamiento - siempre local
let storageConfig = {
    mode: 'local',
    localPath: process.env.LOCAL_VIDEOS_PATH || '/media/videos'
};

// Cargar configuración de almacenamiento
function loadStorageSettings() {
    try {
        if (fsSync.existsSync(STORAGE_SETTINGS_FILE)) {
            const data = fsSync.readFileSync(STORAGE_SETTINGS_FILE, 'utf8');
            const saved = JSON.parse(data);
            storageConfig = { ...storageConfig, ...saved };
            storageConfig.mode = 'local'; // Forzar siempre local

            if (!fsSync.existsSync(storageConfig.localPath)) {
                console.log(`⚠️  Ruta local no existe: ${storageConfig.localPath}`);
            } else {
                console.log(`📁 Almacenamiento LOCAL: ${storageConfig.localPath}`);
            }
        }
    } catch (e) {
        console.log('📁 Usando configuración de almacenamiento por defecto');
    }
}

// Guardar configuración de almacenamiento
function saveStorageSettings() {
    try {
        fsSync.writeFileSync(STORAGE_SETTINGS_FILE, JSON.stringify(storageConfig, null, 2));
    } catch (e) {
        console.error('Error guardando configuración de almacenamiento:', e);
    }
}

// Cargar al iniciar
loadStorageSettings();

// Verificar que FFmpeg está instalado
ffmpeg.getAvailableFormats((err, formats) => {
    if (err) {
        console.error('⚠️  FFmpeg no detectado. Instalar con: apt install ffmpeg');
    } else {
        console.log('✓ FFmpeg disponible');
    }
});

// ========== FUNCIONES PARA TMDB ==========
// ========== SERIES ==========
const SERIES_FOLDER = 'Series'; // Carpeta donde se almacenan las series
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_API_KEY_BACKUP = process.env.TMDB_API_KEY_BACKUP;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342'; // w342 es más rápido que w500
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días en milisegundos

// ========== CLIENTE TMDB CON RATE LIMITER (lib/tmdb.js) ==========
const tmdbClient = createTMDBClient({
    apiKey: TMDB_API_KEY,
    apiKeyBackup: TMDB_API_KEY_BACKUP
});
// Alias para compatibilidad con el código existente (13 usos)
const tmdbFetch = tmdbClient.fetch;

// ========== GESTOR DE COLECCIONES (lib/collections.js) ==========
const collectionsManager = createCollectionsManager({
    mediaDB,
    TMDB_BASE_URL,
    TMDB_IMAGE_BASE,
    TMDB_API_KEY,
    tmdbFetch
});
const { readCollections, writeCollections, updateCollectionWithMovie, removeMovieFromCollections } = collectionsManager;

// ========== GESTOR DE CACHÉ (lib/cache.js) ==========
const cacheManager = createCacheManager({
    mediaDB,
    CACHE_TTL,
    TMDB_BASE_URL,
    TMDB_IMAGE_BASE,
    TMDB_API_KEY,
    tmdbFetch,
    processTMDBExtendedData,
    cleanFilenameForSearch,
    collectionsManager
});
const { readCache, writeCache, updateCacheEntry, cleanupCache, isCacheExpired, searchTMDB, getMovieMetadata } = cacheManager;

// ========== GESTOR DE SERIES (lib/series.js) ==========
const seriesManager = createSeriesManager({
    mediaDB,
    SERIES_FOLDER,
    TMDB_BASE_URL,
    TMDB_IMAGE_BASE,
    TMDB_API_KEY,
    tmdbFetch,
    storageConfig
});
const { readSeriesCache, writeSeriesCache, updateSeriesCacheEntry, readSeriesEpisodes, writeSeriesEpisodes, parseSeriesFilename, searchTVShowTMDB, getSeriesDetailsByTmdbId, getSeasonEpisodesTMDB, scanSeriesFolder, TV_GENRES } = seriesManager;

// ========== GESTOR DE PETICIONES (lib/requests-helpers.js) ==========
const requestsHelpers = createRequestsHelpers({
    requestsDB,
    requestsSSEClients
});
const { readRequests, writeRequests, notifyRequestUpdate } = requestsHelpers;

// ========== GESTOR DE DESCARGAS (lib/download-helpers.js) ==========
const downloadHelpers = createDownloadHelpers({
    mediaDB,
    calculateSimilarity,
    requestsHelpers
});
const { isDownloaderAppRunning, readDownloadQueue, writeDownloadQueue, launchDownloaderApp, isDownloaderAppRecentlyLaunched, cleanDownloadTitle, checkCompletedDownloads, initQueueState, getLastQueueState } = downloadHelpers;

// ========== ESTADO DE CONVERSIONES ==========
const conversionJobs = new Map(); // Almacena el estado de las conversiones
const TEMP_DIR = path.join(__dirname, 'temp_conversions');

// Asegurar que existe el directorio temporal
(async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
    } catch (e) {}
})();

// ========== MODO SOLO LECTURA PARA PETICIONES ==========
// Cuando REQUESTS_READONLY=true, solo se pueden ver las peticiones, no modificarlas
// Útil para ordenadores secundarios que solo deben mostrar el estado
const REQUESTS_READONLY = process.env.REQUESTS_READONLY === 'true';

if (REQUESTS_READONLY) {
    console.log('📋 Modo SOLO LECTURA activado para peticiones');
}

const PORT = process.env.PORT || 3002;

// ========== MONTAR RUTAS ==========
app.use('/api/storage', require('./routes/storage')({ storageConfig, saveStorageSettings }));
app.use('/api/img', require('./routes/poster-cache'));
app.use('/api/tmdb', require('./routes/tmdb')({ tmdbFetch, TMDB_BASE_URL, TMDB_IMAGE_BASE, TMDB_API_KEY, updateCacheEntry }));
app.use('/api', require('./routes/videos')({
    storageConfig,
    readCache, getMovieMetadata, updateCacheEntry,
    normalizeCacheToAPI,
    VIDEO_EXTENSIONS_REGEX
}));
app.use(require('./routes/series')({
    storageConfig, SERIES_FOLDER,
    readSeriesCache, writeSeriesCache, readSeriesEpisodes, writeSeriesEpisodes,
    parseSeriesFilename, searchTVShowTMDB, getSeriesDetailsByTmdbId, getSeasonEpisodesTMDB,
    scanSeriesFolder, TV_GENRES,
    isCacheExpired
}));
app.use('/api/collections', require('./routes/collections')({
    readCollections, updateCollectionWithMovie,
    readCache, writeCache,
    tmdbFetch, TMDB_BASE_URL, TMDB_API_KEY,
    mediaDB
}));
app.use('/api', require('./routes/downloads')({
    readDownloadQueue, writeDownloadQueue, launchDownloaderApp,
    isDownloaderAppRunning, isDownloaderAppRecentlyLaunched,
    getLastQueueState,
    readRequests, writeRequests, notifyRequestUpdate
}));
app.use('/api/requests', require('./routes/requests')({
    REQUESTS_READONLY, requestsSSEClients, storageConfig, requestsDB,
    readRequests, writeRequests, notifyRequestUpdate,
    readCache,
    normalizeText, getMainTitle, calculateSimilarity,
    VIDEO_EXTENSIONS_REGEX
}));

const { movies: moviesRouter, files: filesRouter } = require('./routes/movies')({
    storageConfig,
    readCache, writeCache,
    updateCollectionWithMovie, removeMovieFromCollections,
    tmdbFetch, processTMDBExtendedData, normalizeCacheToAPI,
    TMDB_BASE_URL, TMDB_API_KEY
});
app.use('/api/movies', moviesRouter);
app.use('/api/files', filesRouter);

// fMP4 streaming endpoint for MSE playback (webOS TV app)
// Remuxes MP4 to fragmented MP4 on-the-fly (no re-encoding, just container change)
app.get('/stream-fmp4/:filename', jwtAuthMiddleware, (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const startTime = parseFloat(req.query.t) || 0;
    const seriesFolder = req.query.series ? decodeURIComponent(req.query.series) : null;

    // Movies: direct in localPath. Series: in Series/folder/filename
    let localPath;
    if (seriesFolder) {
        localPath = path.join(storageConfig.localPath, SERIES_FOLDER, seriesFolder, filename);
        // If not found directly, search in subdirectories (season folders)
        if (!fsSync.existsSync(localPath)) {
            try {
                const seriesDir = path.join(storageConfig.localPath, SERIES_FOLDER, seriesFolder);
                const entries = fsSync.readdirSync(seriesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subPath = path.join(seriesDir, entry.name, filename);
                        if (fsSync.existsSync(subPath)) { localPath = subPath; break; }
                    }
                }
            } catch (e) { /* no subdirs */ }
        }
    } else {
        localPath = path.join(storageConfig.localPath, filename);
    }

    if (!fsSync.existsSync(localPath)) {
        return res.status(404).send('Not found');
    }

    console.log(`🎬 fMP4 stream: ${filename} (t=${startTime}s)`);

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');

    const cmd = ffmpeg(localPath);
    // Rate-limit input reading to prevent overwhelming the TV's limited RAM.
    // -readrate 1.5: read at 1.5x real-time (slight buffer ahead)
    // -readrate_initial_burst 10: burst first 10s instantly for quick start (Mejora 6)
    cmd.inputOptions(['-readrate', '1.5', '-readrate_initial_burst', '10']);
    if (startTime > 0) {
        cmd.seekInput(startTime);
    }

    // Mejora 3: Audio passthrough — check if audio is already AAC (no re-encode needed)
    // If audio is not AAC, re-encode to AAC for MSE compatibility
    // If AAC but >2 channels (5.1), downmix to stereo (webOS MSE can't handle multichannel)
    const movie = mediaDB.getMovie(filename);
    const audioCodec = movie ? movie.audio_codec : null;
    const audioChannels = movie ? movie.audio_channels : null;
    const audioOpt = (audioCodec === 'aac' && (!audioChannels || audioChannels <= 2))
        ? ['-c:a', 'copy']
        : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k'];

    const outputOpts = [
        '-c:v', 'copy',
        ...audioOpt,
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4'
    ];
    cmd.outputOptions(outputOpts)
    .on('start', () => console.log('▶️ fMP4 FFmpeg started'))
    .on('error', (err) => {
        if (!err.message.includes('SIGKILL') && !err.message.includes('SIGTERM')) {
            console.error('❌ fMP4 FFmpeg error:', err.message);
        }
    })
    .on('end', () => console.log('✅ fMP4 stream ended'));

    cmd.pipe(res, { end: true });
    res.on('close', () => { cmd.kill('SIGKILL'); });
});

// Get video codec info for TV player (from DB or quick FFprobe)
app.get('/video-info/:filename', jwtAuthMiddleware, (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const movie = mediaDB.getMovie(filename);
    if (movie && movie.video_codec) {
        return res.json({
            video_codec: movie.video_codec,
            audio_codec: movie.audio_codec,
            audio_channels: movie.audio_channels,
            duration: movie.duration_seconds || 0
        });
    }
    // Fallback: FFprobe on the fly
    const seriesFolder = req.query.series ? decodeURIComponent(req.query.series) : null;
    let localPath;
    if (seriesFolder) {
        localPath = path.join(storageConfig.localPath, SERIES_FOLDER, seriesFolder, filename);
        if (!fsSync.existsSync(localPath)) {
            try {
                const seriesDir = path.join(storageConfig.localPath, SERIES_FOLDER, seriesFolder);
                const entries = fsSync.readdirSync(seriesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subPath = path.join(seriesDir, entry.name, filename);
                        if (fsSync.existsSync(subPath)) { localPath = subPath; break; }
                    }
                }
            } catch (e) {}
        }
    } else {
        localPath = path.join(storageConfig.localPath, filename);
    }
    if (!fsSync.existsSync(localPath)) return res.json({ video_codec: null, audio_codec: null, duration: 0 });
    const { probeFile } = require('./lib/probe');
    probeFile(localPath).then(info => {
        res.json({
            video_codec: info ? info.video_codec : null,
            audio_codec: info ? info.audio_codec : null,
            audio_channels: info ? info.audio_channels : null,
            duration: info ? info.duration_seconds : 0
        });
    });
});

// Get video duration for TV player (quick FFprobe)
app.get('/video-duration/:filename', jwtAuthMiddleware, (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const seriesFolder = req.query.series ? decodeURIComponent(req.query.series) : null;
    let localPath;
    if (seriesFolder) {
        localPath = path.join(storageConfig.localPath, SERIES_FOLDER, seriesFolder, filename);
        if (!fsSync.existsSync(localPath)) {
            try {
                const seriesDir = path.join(storageConfig.localPath, SERIES_FOLDER, seriesFolder);
                const entries = fsSync.readdirSync(seriesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subPath = path.join(seriesDir, entry.name, filename);
                        if (fsSync.existsSync(subPath)) { localPath = subPath; break; }
                    }
                }
            } catch (e) {}
        }
    } else {
        localPath = path.join(storageConfig.localPath, filename);
    }
    if (!fsSync.existsSync(localPath)) return res.json({ duration: 0 });
    ffmpeg.ffprobe(localPath, (err, metadata) => {
        if (err) return res.json({ duration: 0 });
        res.json({ duration: Math.floor(metadata.format.duration || 0) });
    });
});

// TV Player page — MSE-based video playback for webOS app
// The <video> element on webOS cannot load HTTP URLs directly (returns SRC_NOT_SUPPORTED).
// Solution: fetch fMP4 stream via JavaScript and feed it to <video> via Media Source Extensions.
// CRITICAL: Memory management — TV has limited RAM (~1.5GB). Must limit buffer size and clean old data.
app.get('/tv-player', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<meta name="viewport" content="width=1920,height=1080">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#000;overflow:hidden;font-family:system-ui,sans-serif}
video{width:100vw;height:100vh;object-fit:contain}
#tb{position:fixed;top:0;left:0;right:0;padding:30px 60px;background:linear-gradient(rgba(0,0,0,0.85),transparent);color:#fff;font-size:26px;font-weight:600;z-index:10;transition:opacity 0.3s;text-shadow:0 2px 6px rgba(0,0,0,0.8)}
#ctrl{position:fixed;bottom:0;left:0;right:0;padding:20px 60px 40px;background:linear-gradient(transparent,rgba(0,0,0,0.92));z-index:10;transition:opacity 0.3s}
.pb-wrap{padding:16px 0;cursor:pointer}
.pb{height:14px;background:rgba(255,255,255,0.3);border-radius:7px;position:relative}
#pf{height:100%;background:linear-gradient(90deg,#7c3aed,#c4b5fd);border-radius:7px;width:0%;transition:width 0.5s linear;position:relative;min-height:14px}
#pd{position:absolute;top:50%;right:-10px;width:22px;height:22px;background:#fff;border-radius:50%;transform:translateY(-50%);box-shadow:0 0 12px rgba(196,181,253,0.8),0 0 4px rgba(255,255,255,0.5)}
.tr{display:flex;justify-content:space-between;align-items:center;color:#ccc;font-size:18px;margin-top:10px}
.btns{display:flex;align-items:center;gap:24px}
.btn{background:none;border:none;color:#fff;font-size:36px;cursor:pointer;padding:8px;opacity:0.85;transition:opacity 0.2s,transform 0.15s;outline:none}
.btn:hover,.btn.fc{opacity:1;transform:scale(1.15)}
.btn-play{font-size:44px;background:rgba(124,58,237,0.3);border-radius:50%;width:64px;height:64px;display:flex;align-items:center;justify-content:center}
.btn-play:hover,.btn-play.fc{background:rgba(124,58,237,0.6)}
#si{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);font-size:80px;color:#fff;opacity:0;transition:opacity 0.3s;z-index:20;pointer-events:none;text-shadow:0 4px 16px rgba(0,0,0,0.7)}
#si.v{opacity:1}
.hid{opacity:0;pointer-events:none}
#dbg{display:none}
#loader{position:fixed;top:0;left:0;width:100%;height:100%;background:#000;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:30;transition:opacity 0.4s}
#loader.gone{opacity:0;pointer-events:none}
.ld-spinner{width:64px;height:64px;border:5px solid rgba(196,181,253,0.2);border-top-color:#c4b5fd;border-radius:50%;animation:spin 0.8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.ld-text{color:#aaa;font-size:20px;margin-top:20px;font-family:system-ui,sans-serif}
</style></head><body>
<video id="v" preload="auto" playsinline></video>
<div id="loader"><div class="ld-spinner"></div><div class="ld-text">Cargando...</div></div>
<div id="tb"></div>
<div id="ctrl">
<div class="pb-wrap" id="pbw"><div class="pb"><div id="pf"><div id="pd"></div></div></div></div>
<div class="tr">
<span id="tc">0:00</span>
<div class="btns">
<button class="btn" id="brw" title="Retroceder 10s">&#x25C0;&#x25C0;</button>
<button class="btn btn-play" id="bpp" title="Play/Pause">&#x25B6;</button>
<button class="btn" id="bff" title="Avanzar 10s">&#x25B6;&#x25B6;</button>
<button class="btn" id="bst" title="Detener">&#x25A0;</button>
</div>
<span id="tt">0:00</span>
</div>
</div>
<div id="si"></div>
<div id="dbg"></div>
<script>
function getParam(n){var m=location.search.match(new RegExp('[?&]'+n+'=([^&]*)'));return m?decodeURIComponent(m[1]):'';}
var file=getParam('file');
var series=getParam('series');
var pos=parseInt(getParam('pos'))||0;
var title=getParam('title');
var token=getParam('token');
var ext=getParam('ext');
var vcodec=getParam('vcodec');
var acodec=getParam('acodec');
// directMode: disabled — webOS enableVideoHole conflicts with direct v.src in iframe
// Force MSE/fMP4 mode for all files; falls back to direct if MSE unavailable
var directMode=false;
var v=document.getElementById('v');
var pf=document.getElementById('pf');
var tc=document.getElementById('tc');
var tt=document.getElementById('tt');
var si=document.getElementById('si');
var ctrl=document.getElementById('ctrl');
var tb=document.getElementById('tb');
var dbg=document.getElementById('dbg');
var bpp=document.getElementById('bpp');
var brw=document.getElementById('brw');
var bff=document.getElementById('bff');
var bst=document.getElementById('bst');
var ht=null;
var abortCtrl=null;
var totalDur=0; // real total duration in seconds (from FFprobe)
tb.textContent=title;

// Fetch real duration and codec info from server
var infoUrl='/video-info/'+encodeURIComponent(file);
var infoQs=[];
if(series)infoQs.push('series='+encodeURIComponent(series));
if(token)infoQs.push('token='+token);
if(infoQs.length>0)infoUrl+='?'+infoQs.join('&');
function xhrGet(url,cb){var x=new XMLHttpRequest();x.open('GET',url);x.onload=function(){try{cb(null,JSON.parse(x.responseText));}catch(e){cb(e);}};x.onerror=function(){cb(new Error('xhr error'));};x.send();}
xhrGet(infoUrl,function(err,d){
if(!err&&d){
totalDur=d.duration||0;log('Duration: '+totalDur+'s');tt.textContent=fmt(totalDur);
// Codec info from server (for logging only; direct mode disabled for webOS compatibility)
if(!vcodec&&d.video_codec){vcodec=d.video_codec;acodec=d.audio_codec||'';}
}else{
// Fallback: try old endpoint
xhrGet('/video-duration/'+encodeURIComponent(file)+(token?'?token='+token:''),function(e2,d2){
if(!e2&&d2){totalDur=d2.duration||0;tt.textContent=fmt(totalDur);}
});
}
});

// Absolute position: direct mode uses v.currentTime directly, MSE uses offset + v.currentTime
function absTime(){return directMode?Math.floor(v.currentTime||0):(pos+Math.floor(v.currentTime||0));}

// Button click handlers (Magic Remote)
function doToggle(){if(v.paused){v.play();icon('\\u25B6');bpp.textContent='\\u23F8';}else{v.pause();icon('\\u23F8');bpp.textContent='\\u25B6';}showC();}
function doRw(){v.currentTime=Math.max(0,v.currentTime-10);icon('\\u25C0\\u25C0');showC();}
function doFf(){var maxT=directMode?(totalDur||v.currentTime+30):(totalDur>0?(totalDur-pos):v.currentTime+30);v.currentTime=Math.min(maxT,v.currentTime+10);icon('\\u25B6\\u25B6');showC();}
function doStop(){if(abortCtrl)abortCtrl.abort();msg('back');}
bpp.addEventListener('click',function(e){e.stopPropagation();doToggle();});
brw.addEventListener('click',function(e){e.stopPropagation();doRw();});
bff.addEventListener('click',function(e){e.stopPropagation();doFf();});
bst.addEventListener('click',function(e){e.stopPropagation();doStop();});
v.addEventListener('play',function(){bpp.textContent='\\u23F8';});
v.addEventListener('pause',function(){bpp.textContent='\\u25B6';});

// Magic Remote: show controls on any mouse movement or click
document.addEventListener('mousemove',function(){showC();});
document.addEventListener('click',function(){showC();});

// Click on progress bar to seek (Magic Remote) - reloads stream from new position
var pbWrap=document.getElementById('pbw');
var pbBar=document.querySelector('.pb');
pbWrap.addEventListener('click',function(e){
e.stopPropagation();
if(!totalDur)return;
var rect=pbBar.getBoundingClientRect();
var x=e.clientX-rect.left;
var ratio=Math.max(0,Math.min(1,x/rect.width));
var seekTime=Math.floor(ratio*totalDur);
log('Seek click: ratio='+ratio.toFixed(2)+' seekTime='+seekTime+'s totalDur='+totalDur);
if(directMode){
// Direct mode: native seek via range requests
v.currentTime=seekTime;showC();
}else{
// MSE mode: reload iframe at new position (can't seek outside buffer)
msg('progress');
var u=location.pathname+'?file='+encodeURIComponent(file)+'&pos='+seekTime+'&title='+encodeURIComponent(title);
if(series)u+='&series='+encodeURIComponent(series);
if(token)u+='&token='+encodeURIComponent(token);
if(ext)u+='&ext='+ext;
if(vcodec)u+='&vcodec='+vcodec;
if(acodec)u+='&acodec='+acodec;
location.href=u;
}
});

// Keep controls visible while pointer hovers over them
ctrl.addEventListener('mouseenter',function(){if(ht){clearTimeout(ht);ht=null;}});
ctrl.addEventListener('mouseleave',function(){if(!v.paused){ht=setTimeout(function(){ctrl.classList.add('hid');tb.classList.add('hid');},3000);}});

// Buffer limits — TV has ~1.5GB RAM shared with OS
// Mejora 6: Increased buffers (images now served locally, less memory pressure)
var MAX_QUEUE_BYTES=4*1024*1024;   // 4MB max pending in JS queue (was 3MB)
var MAX_BUFFER_AHEAD=20;           // 20s ahead before pausing fetch (was 15s)
var RESUME_BUFFER=12;              // resume fetching when only 12s buffered ahead (was 8s)
var CLEAN_BEHIND=5;                // keep only 5s behind, aggressively remove old data

function log(m){console.log('[TVPlayer] '+m);if(dbg)dbg.textContent+=m+'\\n';}
function fmt(s){if(!s||isNaN(s))return'0:00';s=Math.floor(s);var h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sc=s%60;if(h>0)return h+':'+(m<10?'0':'')+m+':'+(sc<10?'0':'')+sc;return m+':'+(sc<10?'0':'')+sc;}
function icon(i){si.textContent=i;si.classList.add('v');setTimeout(function(){si.classList.remove('v');},800);}
function showC(){ctrl.classList.remove('hid');tb.classList.remove('hid');if(ht)clearTimeout(ht);if(!v.paused)ht=setTimeout(function(){ctrl.classList.add('hid');tb.classList.add('hid');},3000);}
function msg(t,d){d=d||{};d.type=t;d.currentTime=absTime();d.duration=totalDur||0;try{parent.postMessage(d,'*');}catch(e){}}

var loader=document.getElementById('loader');
function hideLoader(){if(loader&&!loader.classList.contains('gone')){loader.classList.add('gone');setTimeout(function(){loader.style.display='none';},400);}}
function showLoader(){if(loader){loader.style.display='flex';loader.classList.remove('gone');}}
log('file: '+file);
log('pos: '+pos);
log('MSE supported: '+(typeof MediaSource!=='undefined'));

var useMSE=false;
var mime=null;
if(typeof MediaSource!=='undefined'){
var mimeTypes=[
'video/mp4; codecs="avc1.640028, mp4a.40.2"',
'video/mp4; codecs="avc1.64001f, mp4a.40.2"',
'video/mp4; codecs="avc1.4d4028, mp4a.40.2"',
'video/mp4; codecs="avc1.42e01e, mp4a.40.2"',
'video/mp4; codecs="avc1.640028"',
'video/mp4'
];
for(var i=0;i<mimeTypes.length;i++){
if(MediaSource.isTypeSupported(mimeTypes[i])){mime=mimeTypes[i];break;}
}
if(mime)useMSE=true;
}
log('MSE: '+(useMSE?'yes ('+mime+')':'no'));
log('Direct mode: '+directMode+' (ext='+ext+', vcodec='+vcodec+', acodec='+acodec+')');

var directStarted=false;
function startDirect(){
if(directStarted)return;
directStarted=true;
var directUrl='/stream/'+encodeURIComponent(file);
var dqs=[];
if(token)dqs.push('token='+token);
if(series)dqs.push('series='+encodeURIComponent(series));
if(dqs.length>0)directUrl+='?'+dqs.join('&');
log('Direct stream URL: '+directUrl);
if(abortCtrl){try{abortCtrl.abort();}catch(e){}}
v.addEventListener('loadedmetadata',function(){
log('loadedmetadata fired, duration='+v.duration);
if(!totalDur||totalDur===0)totalDur=Math.floor(v.duration||0);
tt.textContent=fmt(totalDur);
if(pos>0)v.currentTime=pos;
try{v.play().then(function(){log('play() OK');msg('playing');}).catch(function(e){log('play err: '+e.message);});}
catch(e){v.play();}
},false);
v.addEventListener('error',function(){var e=v.error;log('VIDEO ERROR: code='+e.code+' msg='+(e.message||''));},false);
v.addEventListener('stalled',function(){log('VIDEO STALLED');},false);
v.addEventListener('canplay',function(){log('canplay fired');},false);
v.src=directUrl;
v.load();
}

if(directMode){
startDirect();
}else if(!useMSE){
// Fallback: direct stream for browsers without MSE
directMode=true;
startDirect();
}else{
var fmp4Url='/stream-fmp4/'+encodeURIComponent(file);
var qs=[];
if(pos>0)qs.push('t='+pos);
if(series)qs.push('series='+encodeURIComponent(series));
if(token)qs.push('token='+token);
if(qs.length>0)fmp4Url+='?'+qs.join('&');
log('fMP4 URL: '+fmp4Url);

var ms=new MediaSource();
v.src=URL.createObjectURL(ms);

ms.addEventListener('sourceopen',function(){
log('MSE sourceopen');
var sb;
try{sb=ms.addSourceBuffer(mime);log('SourceBuffer created');}
catch(e){log('addSourceBuffer error: '+e.message);return;}

var queue=[];
var queueBytes=0;
var feeding=false;
var streamDone=false;
var reader=null;
var paused=false;     // stream reading paused (backpressure)
var totalBytes=0;
var started=false;

// Get buffered seconds ahead of current playback
function bufferedAhead(){
try{
var buf=sb.buffered;
if(buf.length===0)return 0;
return buf.end(buf.length-1)-v.currentTime;
}catch(e){return 0;}
}

// Remove old data from SourceBuffer to free memory
function cleanBuffer(){
if(sb.updating)return;
try{
var buf=sb.buffered;
if(buf.length===0)return;
// Remove all data more than CLEAN_BEHIND seconds before current position
var removeEnd=v.currentTime-CLEAN_BEHIND;
if(removeEnd>buf.start(0)+0.5){
log('clean: remove 0-'+Math.round(removeEnd)+'s');
sb.remove(buf.start(0),removeEnd);
}
}catch(e){}
}

function feedNext(){
if(feeding||queue.length===0)return;
if(sb.updating)return;
feeding=true;
var chunk=queue.shift();
queueBytes-=chunk.byteLength;
try{sb.appendBuffer(chunk);}
catch(e){
log('appendBuffer err: '+e.message);
feeding=false;
// QuotaExceededError — clean buffer and retry
if(e.name==='QuotaExceededError'){
cleanBuffer();
}
}
}

sb.addEventListener('updateend',function(){
feeding=false;

// Clean old buffer data periodically
if(v.currentTime>CLEAN_BEHIND+5){
cleanBuffer();
}

// Feed next chunk from queue
if(queue.length>0){feedNext();}
else if(streamDone&&!sb.updating){
try{if(ms.readyState==='open')ms.endOfStream();}catch(e){}
}

// Resume stream reading if buffer is low
if(paused&&!streamDone&&bufferedAhead()<RESUME_BUFFER){
paused=false;
pump();
}

// Auto-play once we have enough data
if(v.paused&&v.readyState>=2&&!started){
started=true;
try{v.play().then(function(){log('play() OK');msg('playing');}).catch(function(e){log('play err: '+e.message);});}
catch(e){v.play();}
}
});

function pump(){
if(!reader||paused)return;
reader.read().then(function(result){
if(result.done){
log('Stream complete ('+Math.round(totalBytes/1024/1024)+'MB)');
streamDone=true;
if(!sb.updating&&queue.length===0){
try{if(ms.readyState==='open')ms.endOfStream();}catch(e){}
}
return;
}
totalBytes+=result.value.byteLength;
queue.push(result.value);
queueBytes+=result.value.byteLength;
feedNext();

// Backpressure: pause reading if queue is full or buffer is far ahead
if(queueBytes>=MAX_QUEUE_BYTES||bufferedAhead()>=MAX_BUFFER_AHEAD){
paused=true;
return;
}
pump();
}).catch(function(e){
if(e.name!=='AbortError')log('Read error: '+e.message);
});
}

// Periodic aggressive buffer cleanup every 3s
setInterval(function(){
if(v.currentTime>CLEAN_BEHIND+2){cleanBuffer();}
// Also resume pump if needed
if(paused&&!streamDone&&bufferedAhead()<RESUME_BUFFER){
paused=false;
pump();
}
},3000);

log('Fetching fMP4...');
if(typeof fetch==='function'&&typeof AbortController==='function'){
abortCtrl=new AbortController();
fetch(fmp4Url,{signal:abortCtrl.signal}).then(function(response){
log('fMP4: '+response.status);
if(!response.ok){log('ERROR: HTTP '+response.status);return;}
reader=response.body.getReader();
pump();
}).catch(function(e){
if(e.name!=='AbortError')log('Fetch error: '+e.message);
});
}else{
// Old browser: XHR progressive via overrideMimeType
var xhr=new XMLHttpRequest();
xhr.open('GET',fmp4Url);
xhr.responseType='arraybuffer';
abortCtrl={abort:function(){try{xhr.abort();}catch(e){}}};
xhr.onload=function(){
if(xhr.status>=200&&xhr.status<300){
var buf=new Uint8Array(xhr.response);
log('fMP4 XHR received: '+Math.round(buf.byteLength/1024/1024)+'MB');
totalBytes=buf.byteLength;
queue.push(buf);queueBytes+=buf.byteLength;feedNext();
sb.addEventListener('updateend',function onue(){
if(queue.length>0){feedNext();}
else if(!streamDone){streamDone=true;try{if(ms.readyState==='open')ms.endOfStream();}catch(e){}}
});
}else{log('XHR error: HTTP '+xhr.status);}
};
xhr.onerror=function(){log('XHR network error');};
xhr.send();
}
});
}

v.addEventListener('timeupdate',function(){var at=absTime();var dur=totalDur||0;if(dur>0){pf.style.width=(at/dur*100)+'%';tc.textContent=fmt(at);tt.textContent=fmt(dur);}else{tc.textContent=fmt(at);}});
v.addEventListener('ended',function(){msg('ended');});
v.addEventListener('playing',function(){log('playing!');hideLoader();msg('playing');});
v.addEventListener('canplay',function(){hideLoader();});
v.addEventListener('error',function(){var e=v.error;var m=e?'code='+e.code:'unknown';log('Video error: '+m);hideLoader();});
v.addEventListener('waiting',function(){icon('\\u231B');showLoader();});

// Save progress to server every 10s
setInterval(function(){if(!v.paused&&v.duration)msg('progress');},10000);
// Send time updates to parent every 1s
setInterval(function(){if(v.currentTime>0)parent.postMessage({type:'timeupdate',currentTime:absTime(),duration:totalDur||0,paused:v.paused},'*');},1000);

// Receive commands from parent (player.js) via postMessage
window.addEventListener('message',function(e){
var d=e.data;if(!d||!d.action)return;
switch(d.action){
case 'toggle':doToggle();break;
case 'play':v.play();icon('\\u25B6');showC();break;
case 'pause':v.pause();icon('\\u23F8');showC();break;
case 'seek':v.currentTime=Math.max(0,Math.min(v.duration||0,v.currentTime+(d.offset||0)));showC();break;
case 'seekTo':v.currentTime=Math.max(0,Math.min(v.duration||0,d.time||0));showC();break;
case 'stop':doStop();break;
}
});

document.addEventListener('keydown',function(e){
var k=e.keyCode;e.preventDefault();
switch(k){
case 13:doToggle();break;
case 415:v.play();icon('\\u25B6');showC();break;
case 19:v.pause();icon('\\u23F8');showC();break;
case 37:case 412:doRw();break;
case 39:case 417:doFf();break;
case 461:case 413:doStop();break;
default:showC();}
// Notify parent of key press so it can show OSD
parent.postMessage({type:'keyInIframe',keyCode:k},'*');
});
showC();
</script></body></html>`);
});

app.use(require('./routes/streaming')({
    storageConfig, TEMP_DIR
}));

app.use('/api/convert', require('./routes/conversion')({
    conversionJobs, TEMP_DIR, storageConfig,
    readCache, writeCache,
    readCollections, writeCollections
}));

// DLNA/Cast a TV (opcional via DLNA_ENABLED env var)
const dlnaRoutes = require('./routes/dlna').initRoutes({ storageConfig });
app.use('/api/dlna', dlnaRoutes.apiRouter);
// Proxy DLNA montado SIN auth (los TVs no pueden autenticarse)
app.use('/dlna', dlnaRoutes.mediaRouter);

// ========== NEWSLETTER ==========
const emailService = require('./lib/email');
const emailTemplate = require('./lib/email-template');
app.use('/api/newsletter', require('./routes/newsletter')({ usersDB, emailService, emailTemplate, auth }));

app.use('/api', require('./routes/misc')({
    storageConfig,
    readCache, writeCache, getMovieMetadata, cleanupCache,
    VIDEO_EXTENSIONS_REGEX,
    PORT
}));

// Servir archivos estáticos del frontend en producción
if (process.env.NODE_ENV === 'production') {
    // Servir archivos estáticos
    app.use(express.static(path.join(__dirname, 'my-ui/build')));

    // Middleware catch-all para SPA (debe ir al final, después de las rutas de API)
    app.use((req, res, next) => {
        // Si no es una ruta de API, servir index.html
        if (!req.path.startsWith('/api') && !req.path.startsWith('/stream')) {
            res.sendFile(path.join(__dirname, 'my-ui/build', 'index.html'));
        } else {
            next();
        }
    });
}

// Manejar errores no capturados para evitar que el proceso termine
process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

// Función para liberar puerto en uso
async function killProcessOnPort(port) {
    return new Promise((resolve) => {
        // Intentar con fuser (Linux)
        exec(`fuser -k ${port}/tcp`, (err) => {
            if (!err) {
                console.log(`✅ Puerto ${port} liberado`);
                resolve(true);
            } else {
                resolve(false);
            }
        });
    });
}

// Inicializar monitor de descargas y monitorear cada 5 segundos
initQueueState();
setInterval(checkCompletedDownloads, 5000);

// Iniciar servidor
async function startServer() {
    // Inicializar bases de datos SQLite
    try {
        requestsDB.init();
        mediaDB.init();
        usersDB.init();
        console.log('🗄️  Bases de datos SQLite inicializadas correctamente');
    } catch (err) {
        console.error('❌ Error inicializando SQLite:', err.message);
    }

    // Inicializar poster cache
    try {
        posterCache.init();
        console.log('📸 Poster cache inicializado');
    } catch (err) {
        console.error('⚠️ Error inicializando poster cache:', err.message);
    }

    // Limpiar sesiones expiradas cada hora
    setInterval(() => {
        try { usersDB.cleanExpiredSessions(); } catch (e) {}
    }, 60 * 60 * 1000);

    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Servidor IsiPrime activo en puerto ${PORT}`);
        console.log(`📍 Escuchando en http://0.0.0.0:${PORT} (accesible desde la red)`);
        console.log('⏳ Servidor en ejecución... (presiona Ctrl+C para detener)');

        // Prewarm poster cache en background (no bloquea el arranque)
        posterCache.prewarm(mediaDB).catch(err => {
            console.warn('⚠️ Poster cache prewarm error:', err.message);
        });

        // Probe codec info de archivos nuevos en background
        probeNewFiles(mediaDB, storageConfig.localPath).catch(err => {
            console.warn('⚠️ Codec probe error:', err.message);
        });

        // Iniciar servicio DLNA si está habilitado
        if (process.env.DLNA_ENABLED === 'true') {
            try {
                const dlnaService = require('./lib/dlna');
                dlnaService.init(PORT);
            } catch (err) {
                console.error('📺 DLNA: Error al iniciar:', err.message);
            }
        }
    });

    server.on('error', async (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️  Puerto ${PORT} ocupado, intentando liberar...`);
            const freed = await killProcessOnPort(PORT);
            if (freed) {
                // Esperar un momento y reintentar
                setTimeout(() => {
                    console.log('🔄 Reintentando iniciar servidor...');
                    startServer();
                }, 1000);
            } else {
                console.error(`❌ No se pudo liberar el puerto ${PORT}. Cierra manualmente el proceso.`);
                process.exit(1);
            }
        } else {
            console.error('❌ Error del servidor:', err);
        }
    });
}

startServer();
