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
    const publicPaths = ['/auth/', '/test', '/storage/config'];
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
app.use('/api/tmdb', require('./routes/tmdb')({ tmdbFetch, TMDB_BASE_URL, TMDB_IMAGE_BASE, TMDB_API_KEY, updateCacheEntry }));
app.use('/api', require('./routes/videos')({
    storageConfig,
    readCache, getMovieMetadata,
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
    tmdbFetch, TMDB_BASE_URL, TMDB_API_KEY
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

    // Limpiar sesiones expiradas cada hora
    setInterval(() => {
        try { usersDB.cleanExpiredSessions(); } catch (e) {}
    }, 60 * 60 * 1000);

    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`🚀 Servidor IsiPrime activo en puerto ${PORT}`);
        console.log(`📍 Escuchando en http://0.0.0.0:${PORT} (accesible desde la red)`);
        console.log('⏳ Servidor en ejecución... (presiona Ctrl+C para detener)');

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
