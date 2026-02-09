require('dotenv').config(); // Cargar variables de entorno del archivo .env

const express = require('express');
const ftp = require("basic-ftp");
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const axios = require('axios');
const crypto = require('crypto');
const os = require('os');
const { exec, spawn } = require('child_process');
const { Readable, Writable, PassThrough } = require('stream');

// Base de datos SQLite para peticiones
const requestsDB = require('./db/requests-db');

// ========== MÓDULOS COMPARTIDOS ==========
const { normalizeText, getMainTitle, calculateSimilarity, cleanFilenameForSearch, formatBytes, ensureFullPosterURL, VIDEO_EXTENSIONS_REGEX, TMDB_IMAGE_BASE: TMDB_IMG_BASE_LIB, CAST_LIMIT } = require('./lib/utils');
const { createFTPClient, withFTPClient } = require('./lib/ftp-helper');
const { createTMDBClient } = require('./lib/tmdb');
const { normalizeCacheToAPI, processTMDBExtendedData } = require('./lib/normalizers');
const { createCollectionsManager } = require('./lib/collections');
const { createCacheManager } = require('./lib/cache');
const { createSeriesManager } = require('./lib/series');
const { createRequestsHelpers } = require('./lib/requests-helpers');
const { createDownloadHelpers } = require('./lib/download-helpers');

const app = express();

// ============================================
// SISTEMA DE AUTENTICACIÓN
// ============================================

const USERS_FILE = path.join(__dirname, 'users.json');
const sessions = new Map(); // Almacén de sesiones en memoria
const requestsSSEClients = new Set(); // Clientes SSE para actualizaciones de peticiones

// Crear archivo de usuarios si no existe (con admin por defecto)
async function initUsers() {
    try {
        await fs.access(USERS_FILE);
    } catch {
        const defaultUsers = {
            users: [
                {
                    id: 1,
                    username: 'admin',
                    // Contraseña: admin123 (hasheada con SHA256)
                    password: crypto.createHash('sha256').update('admin123').digest('hex'),
                    role: 'admin',
                    createdAt: new Date().toISOString()
                }
            ]
        };
        await fs.writeFile(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
        console.log('👤 Archivo de usuarios creado. Usuario: admin, Contraseña: admin123');
    }
}

async function readUsers() {
    try {
        const data = await fs.readFile(USERS_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return { users: [] };
    }
}

async function writeUsers(data) {
    await fs.writeFile(USERS_FILE, JSON.stringify(data, null, 2));
}

// Verificar si una IP es local
function isLocalIP(ip) {
    if (!ip) return true;

    // Limpiar la IP (puede venir como ::ffff:192.168.1.1)
    const cleanIP = ip.replace(/^::ffff:/, '');

    // IPs locales
    const localPatterns = [
        /^localhost$/i,
        /^127\./,
        /^192\.168\./,
        /^10\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^::1$/,
        /^fe80:/i
    ];

    return localPatterns.some(pattern => pattern.test(cleanIP));
}

// Obtener IP real del cliente
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           req.headers['x-real-ip'] ||
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip;
}

// Generar token de sesión
function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Middleware de autenticación (IPs locales pasan directo)
function authMiddleware(req, res, next) {
    const clientIP = getClientIP(req);

    // IPs locales: acceso directo sin login
    if (isLocalIP(clientIP)) {
        req.user = { username: 'local', role: 'admin', isLocal: true };
        return next();
    }

    // IPs externas: verificar sesión
    const sessionToken = req.headers['x-session-token'] || req.query.session;

    if (sessionToken && sessions.has(sessionToken)) {
        const session = sessions.get(sessionToken);
        // Verificar que la sesión no haya expirado (24 horas)
        if (Date.now() - session.createdAt < 24 * 60 * 60 * 1000) {
            req.user = session.user;
            return next();
        } else {
            sessions.delete(sessionToken);
        }
    }

    // No autenticado
    return res.status(401).json({
        error: 'No autorizado',
        requiresLogin: true,
        message: 'Debes iniciar sesión para acceder desde una red externa'
    });
}

// Inicializar usuarios al arrancar
initUsers();

// ============================================
// CONFIGURACIÓN EXPRESS
// ============================================

// Configurar CORS para permitir peticiones desde el frontend
app.use(cors({
    origin: true, // Permitir cualquier origen (controlamos con auth)
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token'],
    credentials: true
}));

app.use(express.json()); // Middleware para parsear JSON en todas las rutas

// Middleware de logging para debug
app.use((req, res, next) => {
    const clientIP = getClientIP(req);
    const isLocal = isLocalIP(clientIP);
    console.log(`📨 ${req.method} ${req.path} [${isLocal ? '🏠 Local' : '🌍 Externo'}: ${clientIP}]`);
    next();
});

// ============================================
// ENDPOINTS DE AUTENTICACIÓN (sin auth)
// ============================================

// Verificar estado de autenticación
app.get('/api/auth/status', (req, res) => {
    const clientIP = getClientIP(req);
    const isLocal = isLocalIP(clientIP);
    const sessionToken = req.headers['x-session-token'] || req.query.session;

    let authenticated = isLocal;
    let user = isLocal ? { username: 'local', role: 'admin', isLocal: true } : null;

    if (!isLocal && sessionToken && sessions.has(sessionToken)) {
        const session = sessions.get(sessionToken);
        if (Date.now() - session.createdAt < 24 * 60 * 60 * 1000) {
            authenticated = true;
            user = session.user;
        }
    }

    res.json({
        authenticated,
        isLocal,
        user,
        clientIP: isLocal ? clientIP : 'hidden'
    });
});

// Login
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const { users } = await readUsers();
    const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');
    const user = users.find(u => u.username === username && u.password === hashedPassword);

    if (!user) {
        console.log(`❌ Login fallido: ${username}`);
        return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    // Crear sesión
    const sessionToken = generateSessionToken();
    sessions.set(sessionToken, {
        user: { id: user.id, username: user.username, role: user.role },
        createdAt: Date.now()
    });

    console.log(`✅ Login exitoso: ${username}`);
    res.json({
        success: true,
        sessionToken,
        user: { username: user.username, role: user.role }
    });
});

// Logout
app.post('/api/auth/logout', (req, res) => {
    const sessionToken = req.headers['x-session-token'];
    if (sessionToken) {
        sessions.delete(sessionToken);
    }
    res.json({ success: true });
});

// Gestión de usuarios (solo admin)
app.get('/api/auth/users', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'No tienes permisos' });
    }

    const { users } = await readUsers();
    res.json(users.map(u => ({
        id: u.id,
        username: u.username,
        role: u.role,
        createdAt: u.createdAt
    })));
});

app.post('/api/auth/users', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'No tienes permisos' });
    }

    const { username, password, role = 'user' } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
    }

    const data = await readUsers();

    if (data.users.find(u => u.username === username)) {
        return res.status(400).json({ error: 'El usuario ya existe' });
    }

    const newUser = {
        id: Date.now(),
        username,
        password: crypto.createHash('sha256').update(password).digest('hex'),
        role,
        createdAt: new Date().toISOString()
    };

    data.users.push(newUser);
    await writeUsers(data);

    console.log(`👤 Usuario creado: ${username} (${role})`);
    res.json({ success: true, user: { id: newUser.id, username, role } });
});

app.delete('/api/auth/users/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'No tienes permisos' });
    }

    const userId = parseInt(req.params.id);
    const data = await readUsers();

    const userIndex = data.users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
        return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const deletedUser = data.users.splice(userIndex, 1)[0];
    await writeUsers(data);

    console.log(`🗑️ Usuario eliminado: ${deletedUser.username}`);
    res.json({ success: true });
});

// Endpoint de test para verificar conectividad
app.get('/api/test', (req, res) => {
    console.log('✅ Test endpoint alcanzado');
    res.json({ success: true, message: 'Backend funcionando correctamente', timestamp: new Date().toISOString() });
});

// ============================================
// PROTEGER RUTAS DE API (excepto auth)
// ============================================
app.use('/api', (req, res, next) => {
    // Rutas públicas (no requieren auth)
    const publicPaths = ['/auth/status', '/auth/login', '/auth/logout', '/test', '/storage/config'];
    if (publicPaths.some(p => req.path.startsWith(p))) {
        return next();
    }

    // Aplicar middleware de autenticación
    return authMiddleware(req, res, next);
});

// Proteger rutas de streaming
app.use('/stream', authMiddleware);

// ========== MODO DE ALMACENAMIENTO (LOCAL / RED) ==========
const STORAGE_SETTINGS_FILE = path.join(__dirname, 'storage-settings.json');

// Configuración de almacenamiento
let storageConfig = {
    mode: 'ftp', // 'ftp' o 'local'
    localPath: process.env.LOCAL_VIDEOS_PATH || 'E:\\Peliculas', // Ruta local por defecto
    ftpPath: '/volume-1' // Ruta en el servidor FTP
};

// Cargar configuración de almacenamiento
function loadStorageSettings() {
    try {
        if (fsSync.existsSync(STORAGE_SETTINGS_FILE)) {
            const data = fsSync.readFileSync(STORAGE_SETTINGS_FILE, 'utf8');
            const saved = JSON.parse(data);
            storageConfig = { ...storageConfig, ...saved };

            // Si está en modo local pero la ruta no existe, cambiar a FTP
            if (storageConfig.mode === 'local' && !fsSync.existsSync(storageConfig.localPath)) {
                console.log(`⚠️  Ruta local no existe: ${storageConfig.localPath}`);
                console.log(`📁 Cambiando a modo FTP automáticamente`);
                storageConfig.mode = 'ftp';
                saveStorageSettings();
            } else {
                console.log(`📁 Modo almacenamiento: ${storageConfig.mode.toUpperCase()}`);
                if (storageConfig.mode === 'local') {
                    console.log(`   Ruta local: ${storageConfig.localPath}`);
                }
            }
        }
    } catch (e) {
        console.log('📁 Usando configuración de almacenamiento por defecto (FTP)');
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

// Configuración FTP desde variables de entorno
const FTP_CONFIG = {
    host: process.env.FTP_HOST || "calilu.mooo.com",
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    port: parseInt(process.env.FTP_PORT) || 21
};

// Verificar que FFmpeg está instalado
ffmpeg.getAvailableFormats((err, formats) => {
    if (err) {
        console.error('⚠️  FFmpeg no detectado. Instalar con: apt install ffmpeg');
    } else {
        console.log('✓ FFmpeg disponible');
    }
});

// ========== FUNCIONES PARA TMDB ==========
const CACHE_FILE = path.join(__dirname, 'cache.json');
const COLLECTIONS_FILE = path.join(__dirname, 'collections.json');
// ========== SERIES ==========
const CACHE_SERIES_FILE = path.join(__dirname, 'cache-series.json');
const SERIES_EPISODES_FILE = path.join(__dirname, 'series-episodes.json');
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
    COLLECTIONS_FILE,
    TMDB_BASE_URL,
    TMDB_IMAGE_BASE,
    TMDB_API_KEY,
    tmdbFetch
});
const { readCollections, writeCollections, updateCollectionWithMovie, removeMovieFromCollections } = collectionsManager;

// ========== GESTOR DE CACHÉ (lib/cache.js) ==========
const cacheManager = createCacheManager({
    CACHE_FILE,
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
    CACHE_SERIES_FILE,
    SERIES_EPISODES_FILE,
    SERIES_FOLDER,
    TMDB_BASE_URL,
    TMDB_IMAGE_BASE,
    TMDB_API_KEY,
    tmdbFetch,
    storageConfig,
    FTP_CONFIG,
    withFTPClient
});
const { readSeriesCache, writeSeriesCache, updateSeriesCacheEntry, readSeriesEpisodes, writeSeriesEpisodes, parseSeriesFilename, searchTVShowTMDB, getSeasonEpisodesTMDB, scanSeriesFolder, TV_GENRES } = seriesManager;

// ========== GESTOR DE PETICIONES (lib/requests-helpers.js) ==========
const requestsHelpers = createRequestsHelpers({
    storageConfig,
    FTP_CONFIG,
    requestsDB,
    requestsSSEClients,
    withFTPClient
});
const { readRequests, writeRequests, notifyRequestUpdate } = requestsHelpers;

// ========== GESTOR DE DESCARGAS (lib/download-helpers.js) ==========
const downloadHelpers = createDownloadHelpers({
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
app.use('/api/storage', require('./routes/storage')({ storageConfig, FTP_CONFIG, saveStorageSettings }));
app.use('/api/tmdb', require('./routes/tmdb')({ tmdbFetch, TMDB_BASE_URL, TMDB_IMAGE_BASE, TMDB_API_KEY, updateCacheEntry }));
app.use('/api', require('./routes/videos')({
    storageConfig, FTP_CONFIG,
    readCache, getMovieMetadata,
    normalizeCacheToAPI,
    VIDEO_EXTENSIONS_REGEX
}));
app.use(require('./routes/series')({
    storageConfig, FTP_CONFIG, SERIES_FOLDER,
    readSeriesCache, writeSeriesCache, readSeriesEpisodes, writeSeriesEpisodes,
    parseSeriesFilename, searchTVShowTMDB, getSeasonEpisodesTMDB,
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
    FTP_CONFIG,
    readRequests, writeRequests, notifyRequestUpdate,
    readCache,
    normalizeText, getMainTitle, calculateSimilarity,
    VIDEO_EXTENSIONS_REGEX
}));

const { movies: moviesRouter, files: filesRouter } = require('./routes/movies')({
    storageConfig, FTP_CONFIG,
    readCache, writeCache,
    updateCollectionWithMovie, removeMovieFromCollections,
    tmdbFetch, processTMDBExtendedData, normalizeCacheToAPI,
    TMDB_BASE_URL, TMDB_API_KEY
});
app.use('/api/movies', moviesRouter);
app.use('/api/files', filesRouter);

app.use(require('./routes/streaming')({
    storageConfig, FTP_CONFIG, TEMP_DIR
}));

app.use('/api/convert', require('./routes/conversion')({
    conversionJobs, TEMP_DIR, FTP_CONFIG,
    readCache, writeCache,
    readCollections, writeCollections
}));

app.use('/api', require('./routes/misc')({
    storageConfig, FTP_CONFIG,
    readCache, writeCache, getMovieMetadata, cleanupCache,
    withFTPClient, VIDEO_EXTENSIONS_REGEX,
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

// Función para liberar puerto en uso (Windows)
async function killProcessOnPort(port) {
    return new Promise((resolve) => {
        exec(`netstat -ano | findstr :${port}`, (err, stdout) => {
            if (err || !stdout) {
                resolve(false);
                return;
            }
            // Buscar PID del proceso LISTENING
            const lines = stdout.split('\n');
            for (const line of lines) {
                if (line.includes('LISTENING')) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && !isNaN(pid)) {
                        console.log(`⚠️  Puerto ${port} en uso por PID ${pid}, liberando...`);
                        exec(`taskkill /PID ${pid} /F`, (killErr) => {
                            if (!killErr) {
                                console.log(`✅ Proceso ${pid} terminado`);
                                resolve(true);
                            } else {
                                resolve(false);
                            }
                        });
                        return;
                    }
                }
            }
            resolve(false);
        });
    });
}

// Inicializar monitor de descargas y monitorear cada 5 segundos
initQueueState();
setInterval(checkCompletedDownloads, 5000);

// Iniciar servidor con auto-liberación de puerto
async function startServer() {
    // Inicializar base de datos SQLite si estamos en modo LOCAL
    if (storageConfig.mode === 'local') {
        try {
            requestsDB.init();
            console.log('🗄️  Base de datos SQLite inicializada correctamente');
        } catch (err) {
            console.error('❌ Error inicializando SQLite:', err.message);
        }
    }

    const server = app.listen(PORT, () => {
        console.log(`🚀 Servidor Hermes activo en puerto ${PORT}`);
        console.log(`📍 Escuchando en http://localhost:${PORT}`);
        console.log('⏳ Servidor en ejecución... (presiona Ctrl+C para detener)');
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