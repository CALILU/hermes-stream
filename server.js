require('dotenv').config(); // Cargar variables de entorno del archivo .env

const express = require('express');
const ftp = require("basic-ftp");
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const crypto = require('crypto');

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
const fsSync = require('fs');

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

// ========== API DE MODO DE ALMACENAMIENTO ==========

// Obtener configuración actual de almacenamiento
app.get('/api/storage/config', (req, res) => {
    res.json({
        mode: storageConfig.mode,
        localPath: storageConfig.localPath,
        ftpHost: FTP_CONFIG.host
    });
});

// Cambiar modo de almacenamiento
app.post('/api/storage/mode', (req, res) => {
    const { mode, localPath } = req.body;

    if (!mode || !['ftp', 'local'].includes(mode)) {
        return res.status(400).json({ error: 'Modo inválido. Usar "ftp" o "local"' });
    }

    // Si es modo local, verificar que la ruta existe
    if (mode === 'local') {
        const pathToCheck = localPath || storageConfig.localPath;
        if (!fsSync.existsSync(pathToCheck)) {
            return res.status(400).json({ error: `La ruta local no existe: ${pathToCheck}` });
        }
        if (localPath) {
            storageConfig.localPath = localPath;
        }
    }

    const oldMode = storageConfig.mode;
    storageConfig.mode = mode;
    saveStorageSettings();

    console.log(`🔄 Modo almacenamiento cambiado: ${oldMode.toUpperCase()} -> ${mode.toUpperCase()}`);

    res.json({
        success: true,
        mode: storageConfig.mode,
        localPath: storageConfig.localPath,
        message: `Cambiado a modo ${mode === 'ftp' ? 'RED (FTP)' : 'LOCAL'}`
    });
});

// Explorar carpeta local (para selector) - Diálogo moderno Windows 11
app.get('/api/storage/browse', (req, res) => {
    const { exec } = require('child_process');

    // Diálogo moderno de Windows 11 usando COM Shell.Application
    const psScript = `
[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null

# Usar el diálogo moderno de Windows 11 con Shell.Application
$shell = New-Object -ComObject Shell.Application
$folder = $shell.BrowseForFolder(0, "ISIPRIME - Selecciona la carpeta con peliculas", 0x511, 17)

if ($folder -ne $null) {
    Write-Output $folder.Self.Path
}
`;

    exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
        { timeout: 120000, windowsHide: false },
        (error, stdout, stderr) => {
            const selectedPath = stdout.trim();

            if (selectedPath && fsSync.existsSync(selectedPath)) {
                // Verificar si hay videos en la carpeta
                try {
                    const files = fsSync.readdirSync(selectedPath);
                    const videoFiles = files.filter(f => /\.(mp4|mkv|avi|mov)$/i.test(f));
                    console.log(`📁 Carpeta seleccionada: ${selectedPath}`);
                    console.log(`   📼 Videos encontrados: ${videoFiles.length}`);
                    if (videoFiles.length === 0) {
                        console.log(`   ⚠️  No hay archivos de video en esta carpeta`);
                        console.log(`   📂 Contenido: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
                    }
                } catch (e) {
                    console.log(`   ⚠️  Error leyendo carpeta: ${e.message}`);
                }
                res.json({ success: true, path: selectedPath });
            } else if (error && error.killed) {
                res.json({ success: false, error: 'Timeout' });
            } else {
                res.json({ success: false, cancelled: true });
            }
        }
    );
});

// Limpiar caché de películas que ya no existen
app.post('/api/cache/cleanup', async (req, res) => {
    try {
        console.log('🧹 Limpiando caché de entradas huérfanas...');

        // Obtener lista de archivos actuales
        let videoFiles = [];

        if (storageConfig.mode === 'local') {
            if (fsSync.existsSync(storageConfig.localPath)) {
                const files = fsSync.readdirSync(storageConfig.localPath);
                videoFiles = files
                    .filter(name => name.match(/\.(mp4|mkv|avi|mov)$/i))
                    .map(name => ({ name }));
            }
        } else {
            const client = new ftp.Client();
            client.ftp.timeout = 60000;
            try {
                await client.access({ ...FTP_CONFIG, secure: false, passive: true });
                const list = await client.list("/volume-1");
                videoFiles = list.filter(file => file.name.match(/\.(mp4|mkv|avi|mov)$/i));
            } finally {
                client.close();
            }
        }

        const result = await cleanupCache(videoFiles);
        res.json({
            success: true,
            removed: result.removed,
            remaining: result.remaining,
            message: `Eliminadas ${result.removed} entradas. Quedan ${result.remaining} en caché.`
        });
    } catch (err) {
        console.error('Error limpiando caché:', err);
        res.status(500).json({ error: err.message });
    }
});

// Limpiar TODO el caché de películas
app.delete('/api/cache', async (req, res) => {
    try {
        console.log('🗑️  Limpiando TODO el caché de películas...');
        await writeCache({});
        console.log('✅ Caché completamente limpiado');
        res.json({ success: true, message: 'Caché limpiado completamente' });
    } catch (err) {
        console.error('Error limpiando caché:', err);
        res.status(500).json({ error: err.message });
    }
});

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
const REQUESTS_FILE = path.join(__dirname, 'movie-requests.json');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_API_KEY_BACKUP = process.env.TMDB_API_KEY_BACKUP;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342'; // w342 es más rápido que w500
let usingBackupKey = false; // Flag para saber qué key estamos usando
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días en milisegundos

// ========== RATE LIMITER GLOBAL PARA TMDB ==========
// TMDB permite ~40 peticiones/10 segundos. Usamos 35 para margen de seguridad.
const tmdbRateLimiter = {
    queue: [],
    timestamps: [],
    maxRequests: 35,
    windowMs: 10000, // 10 segundos
    processing: false,

    async request(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject });
            this.processQueue();
        });
    },

    async processQueue() {
        if (this.processing || this.queue.length === 0) return;
        this.processing = true;

        while (this.queue.length > 0) {
            // Limpiar timestamps antiguos
            const now = Date.now();
            this.timestamps = this.timestamps.filter(t => now - t < this.windowMs);

            // Esperar si alcanzamos el límite
            if (this.timestamps.length >= this.maxRequests) {
                const waitTime = this.timestamps[0] + this.windowMs - now + 100;
                console.log(`⏳ Rate limit TMDB: esperando ${waitTime}ms...`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }

            // Procesar siguiente petición
            const { fn, resolve, reject } = this.queue.shift();
            this.timestamps.push(Date.now());

            try {
                const result = await fn();
                resolve(result);
            } catch (error) {
                // Si es error 429 (rate limit), reintentar
                if (error.response?.status === 429) {
                    console.warn('⚠️ TMDB 429 - Reintentando en 2s...');
                    this.queue.unshift({ fn, resolve, reject });
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    reject(error);
                }
            }

            // Pequeña pausa entre peticiones
            await new Promise(r => setTimeout(r, 100));
        }

        this.processing = false;
    }
};

// Wrapper para axios con rate limiting y fallback de API key
async function tmdbFetch(url, options = {}) {
    const currentKey = usingBackupKey ? TMDB_API_KEY_BACKUP : TMDB_API_KEY;

    // Asegurar que la API key esté en los params
    if (options.params) {
        options.params.api_key = currentKey;
    }

    return tmdbRateLimiter.request(async () => {
        try {
            return await axios.get(url, options);
        } catch (error) {
            // Si falla con timeout o error de conexión, intentar con key de respaldo
            if (!usingBackupKey && TMDB_API_KEY_BACKUP &&
                (error.code === 'ECONNABORTED' || error.message?.includes('timeout') ||
                 error.response?.status === 401 || error.response?.status === 429)) {
                console.log('🔄 Cambiando a API key de respaldo...');
                usingBackupKey = true;
                options.params.api_key = TMDB_API_KEY_BACKUP;
                return await axios.get(url, options);
            }
            throw error;
        }
    });
}

// ========== SISTEMA DE PETICIONES DE PELÍCULAS ==========

// ========== PETICIONES CENTRALIZADAS EN FTP ==========
const FTP_REQUESTS_PATH = '/volume-1/movie-requests.json';
let requestsCache = null;
let requestsCacheTime = 0;
const REQUESTS_CACHE_TTL = 30000; // 30 segundos de cache

// Leer peticiones desde FTP (SIEMPRE centralizado, independiente del modo de almacenamiento)
async function readRequests() {
    // Usar cache si es reciente
    if (requestsCache && (Date.now() - requestsCacheTime) < REQUESTS_CACHE_TTL) {
        return requestsCache;
    }

    // SIEMPRE leer desde FTP (peticiones centralizadas para todos los usuarios)
    const client = new ftp.Client();
    client.ftp.verbose = false;

    try {
        await client.access({ ...FTP_CONFIG, secure: false, passive: true });

        // Descargar a memoria usando un stream
        const chunks = [];
        const writable = new (require('stream').Writable)({
            write(chunk, encoding, callback) {
                chunks.push(chunk);
                callback();
            }
        });

        await client.downloadTo(writable, FTP_REQUESTS_PATH);
        const content = Buffer.concat(chunks).toString('utf8');
        requestsCache = JSON.parse(content);
        requestsCacheTime = Date.now();
        console.log(`📋 Peticiones cargadas desde FTP: ${requestsCache.requests?.length || 0}`);
        return requestsCache;
    } catch (error) {
        // Si el archivo no existe en FTP, devolver estructura vacía
        console.log('📋 Archivo de peticiones no existe en FTP:', error.message);
        return { requests: [], nextId: 1 };
    } finally {
        client.close();
    }
}

// Escribir peticiones en FTP (SIEMPRE centralizado, independiente del modo de almacenamiento)
async function writeRequests(data) {
    // Actualizar cache local
    requestsCache = data;
    requestsCacheTime = Date.now();

    // SIEMPRE escribir en FTP (peticiones centralizadas para todos los usuarios)
    const client = new ftp.Client();
    client.ftp.verbose = false;

    try {
        await client.access({ ...FTP_CONFIG, secure: false, passive: true });

        // Primero borrar el archivo existente
        try {
            await client.remove(FTP_REQUESTS_PATH);
        } catch (e) {
            // Ignorar si no existe
        }

        // Crear stream de lectura desde el JSON
        const content = JSON.stringify(data, null, 2);
        const { Readable } = require('stream');
        const readable = Readable.from([content]);

        await client.uploadFrom(readable, FTP_REQUESTS_PATH);
        console.log('📋 Peticiones guardadas en FTP');
    } catch (error) {
        console.error('❌ Error guardando peticiones en FTP:', error.message);
    } finally {
        client.close();
    }
}

// Función para normalizar texto (quitar acentos y caracteres especiales)
// Normalizar texto para comparación de títulos
function normalizeText(str) {
    return (str || '')
        .toLowerCase()
        // Reemplazar fracciones unicode por números
        .replace(/⅓/g, '1 3').replace(/⅔/g, '2 3').replace(/½/g, '1 2').replace(/¼/g, '1 4').replace(/¾/g, '3 4')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Quitar acentos
        .replace(/[''´`]/g, '')          // Quitar apóstrofes
        .replace(/[:\-–—]/g, ' ')        // Convertir : y guiones a espacio
        .replace(/&/g, ' and ')          // & -> and
        .replace(/[^a-z0-9\s]/g, '')     // Quitar otros caracteres especiales
        .replace(/\s+/g, ' ')            // Múltiples espacios a uno
        .trim();
}

// Obtener solo el título principal (antes de : o -)
function getMainTitle(str) {
    return (str || '')
        .split(/[:\-–—]/)[0]  // Tomar solo antes de : o -
        .trim();
}

// Calcular similitud entre dos strings (0-1)
function calculateSimilarity(str1, str2) {
    const s1 = normalizeText(str1);
    const s2 = normalizeText(str2);

    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;

    // Comparar palabras
    const words1 = s1.split(' ').filter(w => w.length > 1);
    const words2 = s2.split(' ').filter(w => w.length > 1);

    if (words1.length === 0 || words2.length === 0) return 0;

    // Contar palabras coincidentes
    const matches = words1.filter(w => words2.includes(w)).length;
    const maxWords = Math.max(words1.length, words2.length);

    return matches / maxWords;
}

// ========== MODO SOLO LECTURA PARA PETICIONES ==========
// Cuando REQUESTS_READONLY=true, solo se pueden ver las peticiones, no modificarlas
// Útil para ordenadores secundarios que solo deben mostrar el estado
const REQUESTS_READONLY = process.env.REQUESTS_READONLY === 'true';

if (REQUESTS_READONLY) {
    console.log('📋 Modo SOLO LECTURA activado para peticiones');
}

// Endpoint para que el frontend sepa si está en modo solo lectura
app.get('/api/requests/readonly', (req, res) => {
    res.json({ readonly: REQUESTS_READONLY });
});

// SSE endpoint para actualizaciones en tiempo real de peticiones
app.get('/api/requests/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Añadir cliente a la lista
    requestsSSEClients.add(res);
    console.log(`📡 Cliente SSE conectado (${requestsSSEClients.size} activos)`);

    // Enviar heartbeat cada 30 segundos para mantener conexión
    const heartbeat = setInterval(() => {
        res.write(':heartbeat\n\n');
    }, 30000);

    // Limpiar cuando se desconecta
    req.on('close', () => {
        clearInterval(heartbeat);
        requestsSSEClients.delete(res);
        console.log(`📡 Cliente SSE desconectado (${requestsSSEClients.size} activos)`);
    });
});

// Función para notificar a todos los clientes SSE
function notifyRequestUpdate(request) {
    const data = JSON.stringify({ type: 'update', request });
    requestsSSEClients.forEach(client => {
        client.write(`data: ${data}\n\n`);
    });
}

// Obtener todas las peticiones (con auto-detección leyendo del disco)
app.get('/api/requests', async (req, res) => {
    try {
        const data = await readRequests();
        const cache = await readCache();
        let modified = false;

        // Leer archivos del disco directamente
        let diskFiles = [];

        if (storageConfig.mode === 'local') {
            if (fsSync.existsSync(storageConfig.localPath)) {
                const files = fsSync.readdirSync(storageConfig.localPath);
                diskFiles = files
                    .filter(name => name.match(/\.(mp4|mkv|avi|mov)$/i))
                    .map(name => {
                        // Extraer título y año del nombre del archivo
                        const nameWithoutExt = name.replace(/\.(mp4|mkv|avi|mov)$/i, '');
                        const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
                        const year = yearMatch ? yearMatch[1] : '';
                        const title = nameWithoutExt.replace(/\s*\(\d{4}\)\s*$/, '').trim();
                        return {
                            filename: name,
                            title: title,
                            year: year,
                            titleNorm: normalizeText(title)
                        };
                    });
                console.log(`📂 Verificando ${diskFiles.length} archivos en disco para auto-detección`);
            }
        } else {
            // Modo FTP - consultar servidor FTP directamente
            const client = new ftp.Client();
            client.ftp.verbose = false;
            try {
                await client.access({ ...FTP_CONFIG, secure: false, passive: true });
                const ftpFiles = await client.list("/volume-1");
                diskFiles = ftpFiles
                    .filter(f => f.name.match(/\.(mp4|mkv|avi|mov)$/i))
                    .map(f => {
                        const nameWithoutExt = f.name.replace(/\.(mp4|mkv|avi|mov)$/i, '');
                        const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
                        const year = yearMatch ? yearMatch[1] : '';
                        const title = nameWithoutExt.replace(/\s*\(\d{4}\)\s*$/, '').trim();
                        return {
                            filename: f.name,
                            title: title,
                            year: year,
                            titleNorm: normalizeText(title)
                        };
                    });
                console.log(`📂 Verificando ${diskFiles.length} archivos en FTP para auto-detección`);
            } catch (ftpErr) {
                console.error('❌ Error consultando FTP:', ftpErr.message);
                // Fallback al cache si falla FTP
                diskFiles = Object.keys(cache).map(filename => {
                    const nameWithoutExt = filename.replace(/\.(mp4|mkv|avi|mov)$/i, '');
                    const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
                    const year = yearMatch ? yearMatch[1] : '';
                    const title = nameWithoutExt.replace(/\s*\(\d{4}\)\s*$/, '').trim();
                    return {
                        filename: filename,
                        title: title,
                        year: year,
                        titleNorm: normalizeText(title)
                    };
                });
            } finally {
                client.close();
            }
        }

        // Obtener todos los tmdb_ids de películas en la biblioteca
        const libraryTmdbIds = new Set(
            Object.values(cache)
                .filter(movie => movie.tmdb_id)
                .map(movie => movie.tmdb_id)
        );

        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        console.log(`📋 Verificando ${data.requests.length} peticiones contra ${diskFiles.length} archivos en servidor`);
        if (diskFiles.length > 0) {
            console.log(`   Ejemplos de archivos: ${diskFiles.slice(0, 3).map(f => f.filename).join(', ')}...`);
        }

        // Filtrar y actualizar peticiones
        data.requests = data.requests.filter(request => {
            // Auto-actualizar estado a "server" si la película está en el servidor FTP
            // Verificar todas las peticiones excepto las ya marcadas como 'server' o 'rejected'
            if (request.status !== 'server' && request.status !== 'rejected') {
                let found = false;
                let foundBy = '';

                const reqTitleNorm = normalizeText(request.title);
                console.log(`   🔍 Buscando: "${request.title}" → "${reqTitleNorm}" (${request.year || '-'}) [${request.status}]`);

                // 1. Buscar por TMDB ID (más preciso)
                if (libraryTmdbIds.has(request.tmdbId)) {
                    found = true;
                    foundBy = 'TMDB ID';
                }

                // 2. Fallback: buscar por título + año en disco
                if (!found && request.title) {
                    const reqTitleNorm = normalizeText(request.title);
                    const reqMainTitle = normalizeText(getMainTitle(request.title));
                    const reqYear = request.year ? String(request.year).substring(0, 4) : '';

                    const match = diskFiles.find(file => {
                        // Verificar año si ambos lo tienen
                        if (reqYear && file.year && reqYear !== file.year) {
                            return false;
                        }

                        const fileTitleNorm = file.titleNorm;
                        const fileMainTitle = normalizeText(getMainTitle(file.title));

                        // 1. Coincidencia exacta normalizada
                        if (fileTitleNorm === reqTitleNorm) {
                            return true;
                        }

                        // 2. Uno contiene al otro
                        if (fileTitleNorm.includes(reqTitleNorm) || reqTitleNorm.includes(fileTitleNorm)) {
                            return true;
                        }

                        // 3. Comparar solo títulos principales (sin subtítulos)
                        if (fileMainTitle === reqMainTitle && fileMainTitle.length > 3) {
                            return true;
                        }

                        // 4. Alta similitud (>85% de palabras coinciden)
                        const similarity = calculateSimilarity(file.title, request.title);
                        if (similarity >= 0.85) {
                            return true;
                        }

                        // 5. Título principal con alta similitud
                        const mainSimilarity = calculateSimilarity(getMainTitle(file.title), getMainTitle(request.title));
                        if (mainSimilarity >= 0.9 && reqYear === file.year) {
                            return true;
                        }

                        return false;
                    });

                    if (match) {
                        found = true;
                        foundBy = `título+año (${match.filename})`;
                    }
                }

                if (found) {
                    console.log(`      ✅ Encontrado por ${foundBy}`);
                    request.status = 'server';
                    request.updatedAt = now.toISOString();
                    modified = true;

                    // Notificar a clientes SSE
                    notifyRequestUpdate(request);
                } else {
                    console.log(`      ❌ No encontrado en servidor`);
                }
            }

            // Eliminar peticiones completadas hace más de 7 días
            if (request.status === 'downloaded' || request.status === 'server') {
                const updatedAt = new Date(request.updatedAt);
                if (updatedAt < sevenDaysAgo) {
                    console.log(`🗑️ Auto-eliminando petición antigua: "${request.title}" (completada hace más de 7 días)`);
                    modified = true;
                    return false; // Eliminar del array
                }
            }

            return true; // Mantener
        });

        // Guardar cambios si hubo modificaciones
        if (modified) {
            await writeRequests(data);
        }

        res.json({ requests: data.requests });
    } catch (error) {
        console.error('Error leyendo peticiones:', error);
        res.status(500).json({ error: 'Error al obtener peticiones' });
    }
});

// Crear nueva(s) petición(es)
// NOTA: Crear peticiones está permitido incluso en modo solo lectura
// El modo solo lectura solo afecta a modificar/eliminar (acciones de admin)
app.post('/api/requests', async (req, res) => {
    try {
        const { movies, requestedBy } = req.body;

        if (!movies || !Array.isArray(movies) || movies.length === 0) {
            return res.status(400).json({ error: 'Se requiere un array de películas' });
        }

        const data = await readRequests();
        let created = 0;
        let duplicates = 0;

        for (const movie of movies) {
            // Verificar si ya existe una petición para esta película (por tmdbId o title)
            const tmdbId = movie.tmdbId || movie.tmdb_id || movie.id;
            const exists = data.requests.find(r => r.tmdbId === tmdbId);

            if (exists) {
                duplicates++;
                continue;
            }

            const newRequest = {
                id: data.nextId++,
                tmdbId: tmdbId,
                title: movie.title,
                originalTitle: movie.originalTitle || movie.original_title,
                year: movie.year || (movie.release_date ? movie.release_date.split('-')[0] : null),
                poster: movie.poster || (movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : null),
                overview: movie.overview,
                rating: movie.rating || movie.vote_average,
                status: 'pending', // pending, downloading, downloaded, rejected, mp4, server
                requestedBy: requestedBy || 'Usuario',
                requestedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };

            data.requests.push(newRequest);
            created++;
        }

        await writeRequests(data);

        console.log(`📥 ${created} nueva(s) petición(es) añadida(s)${duplicates > 0 ? `, ${duplicates} duplicadas` : ''}`);
        res.json({
            success: true,
            created,
            duplicates,
            total: data.requests.length
        });

    } catch (error) {
        console.error('Error creando petición:', error);
        res.status(500).json({ error: 'Error al crear petición' });
    }
});

// Actualizar estado de una petición (admin)
app.put('/api/requests/:id', async (req, res) => {
    // Bloquear en modo solo lectura
    if (REQUESTS_READONLY) {
        return res.status(403).json({ error: 'Modo solo lectura: no se pueden modificar peticiones desde este ordenador' });
    }

    try {
        const { id } = req.params;
        const { status, adminNotes } = req.body;

        const data = await readRequests();
        const request = data.requests.find(r => r.id === parseInt(id));

        if (!request) {
            return res.status(404).json({ error: 'Petición no encontrada' });
        }

        if (status) {
            if (!['pending', 'downloading', 'downloaded', 'rejected', 'mp4', 'server'].includes(status)) {
                return res.status(400).json({ error: 'Estado inválido' });
            }
            request.status = status;
        }

        if (adminNotes !== undefined) {
            request.adminNotes = adminNotes;
        }

        request.updatedAt = new Date().toISOString();

        await writeRequests(data);

        // Notificar a clientes SSE
        notifyRequestUpdate(request);

        console.log(`📝 Petición #${id} actualizada: ${status || 'sin cambio de estado'}`);
        res.json({
            success: true,
            request
        });

    } catch (error) {
        console.error('Error actualizando petición:', error);
        res.status(500).json({ error: 'Error al actualizar petición' });
    }
});

// Eliminar una petición (admin)
app.delete('/api/requests/:id', async (req, res) => {
    // Bloquear en modo solo lectura
    if (REQUESTS_READONLY) {
        return res.status(403).json({ error: 'Modo solo lectura: no se pueden eliminar peticiones desde este ordenador' });
    }

    try {
        const { id } = req.params;
        const data = await readRequests();

        const index = data.requests.findIndex(r => r.id === parseInt(id));
        if (index === -1) {
            return res.status(404).json({ error: 'Petición no encontrada' });
        }

        const deleted = data.requests.splice(index, 1)[0];
        await writeRequests(data);

        console.log(`🗑️ Petición #${id} eliminada: ${deleted.title}`);
        res.json({ success: true, deleted });

    } catch (error) {
        console.error('Error eliminando petición:', error);
        res.status(500).json({ error: 'Error al eliminar petición' });
    }
});

// Estadísticas de peticiones
app.get('/api/requests/stats', async (req, res) => {
    try {
        const data = await readRequests();
        const stats = {
            total: data.requests.length,
            pending: data.requests.filter(r => r.status === 'pending').length,
            downloading: data.requests.filter(r => r.status === 'downloading').length,
            downloaded: data.requests.filter(r => r.status === 'downloaded').length,
            mp4: data.requests.filter(r => r.status === 'mp4').length,
            server: data.requests.filter(r => r.status === 'server').length,
            rejected: data.requests.filter(r => r.status === 'rejected').length
        };
        res.json(stats);
    } catch (error) {
        res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// ============================================
// COLA DE DESCARGAS (Python Downloader)
// ============================================
const os = require('os');
const { spawn } = require('child_process');
const DOWNLOAD_QUEUE_FILE = path.join(os.homedir(), '.youtube_downloader_queue.json');
// Ruta a la app de descargas (formato Windows para ejecutar desde WSL)
const DOWNLOADER_APP_PATH_WIN = 'F:\\Utiles de python para videos\\descarga_youtube\\dist\\YouTubeDownloader.exe';
const DOWNLOADER_APP_PATH_WSL = '/mnt/f/Utiles de python para videos/descarga_youtube/dist/YouTubeDownloader.exe';

// Variable para evitar abrir múltiples instancias
let downloaderAppLaunched = false;

// Verificar si la app de descargas está ejecutándose
async function isDownloaderAppRunning() {
    return new Promise((resolve) => {
        const { exec } = require('child_process');
        // Buscar el proceso en Windows (usar tasklist.exe para WSL)
        exec('tasklist.exe /FI "IMAGENAME eq YouTubeDownloader.exe" /NH', (error, stdout) => {
            if (error) {
                console.log('⚠️ Error verificando proceso:', error.message);
                resolve(false);
                return;
            }
            // Si encuentra el proceso, stdout contendrá el nombre del exe
            const isRunning = stdout.toLowerCase().includes('youtubedownloader');
            console.log(`🔍 App de descargas ${isRunning ? 'está abierta' : 'no está abierta'}`);
            resolve(isRunning);
        });
    });
}

// Leer cola de descargas
async function readDownloadQueue() {
    try {
        const data = await fs.readFile(DOWNLOAD_QUEUE_FILE, 'utf8');
        return JSON.parse(data);
    } catch {
        return [];
    }
}

// Escribir cola de descargas
async function writeDownloadQueue(queue) {
    await fs.writeFile(DOWNLOAD_QUEUE_FILE, JSON.stringify(queue, null, 2));
}

// Lanzar aplicación de descargas si no está abierta
function launchDownloaderApp() {
    try {
        const fsSync = require('fs');
        // Verificar existencia con ruta WSL
        if (!fsSync.existsSync(DOWNLOADER_APP_PATH_WSL)) {
            console.log('⚠️ App de descargas no encontrada en:', DOWNLOADER_APP_PATH_WSL);
            return false;
        }

        console.log('🚀 Abriendo aplicación de descargas...');
        // Usar cmd.exe para lanzar la app Windows desde WSL (con comillas para rutas con espacios)
        const child = spawn('cmd.exe', ['/c', 'start', '""', `"${DOWNLOADER_APP_PATH_WIN}"`], {
            detached: true,
            stdio: 'ignore',
            shell: true
        });
        child.unref();

        // Marcar como lanzada por 5 segundos para evitar múltiples aperturas
        downloaderAppLaunched = true;
        setTimeout(() => { downloaderAppLaunched = false; }, 5000);

        return true;
    } catch (error) {
        console.error('Error al abrir app de descargas:', error);
        return false;
    }
}

// POST /api/download-queue - Añadir URL a la cola de descargas
app.post('/api/download-queue', async (req, res) => {
    try {
        const { url, title, requestId } = req.body;

        if (!url) {
            return res.status(400).json({ error: 'URL requerida' });
        }

        // Validar que sea una URL de OK.ru u otra válida
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            return res.status(400).json({ error: 'URL inválida' });
        }

        const queue = await readDownloadQueue();

        // Verificar duplicados (solo pendientes o en descarga)
        const isDuplicate = queue.some(item =>
            item.url === url && ['pending', 'downloading'].includes(item.status)
        );

        if (isDuplicate) {
            return res.status(409).json({ error: 'Esta URL ya está en la cola' });
        }

        // Crear nuevo item de cola
        const queueItem = {
            url: url,
            format: 'mp4',
            status: 'pending',
            added_at: new Date().toISOString(),
            title: title || (url.length > 50 ? url.substring(0, 50) + '...' : url)
        };

        queue.push(queueItem);
        await writeDownloadQueue(queue);

        console.log(`📥 URL añadida a cola de descargas: ${url}`);

        // Actualizar estado de la petición a "downloading" si se proporciona requestId o coincide el título
        let updatedRequest = null;
        try {
            const requestsData = await readRequests();
            let requestToUpdate = null;

            // Buscar por requestId si se proporciona
            if (requestId) {
                requestToUpdate = requestsData.requests.find(r => r.id === requestId);
            }

            // Si no hay requestId, buscar por título similar
            if (!requestToUpdate && title) {
                const normalizedTitle = title.toLowerCase()
                    .replace(/[._-]/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                requestToUpdate = requestsData.requests.find(r => {
                    const reqTitle = (r.title || '').toLowerCase()
                        .replace(/[._-]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();
                    return reqTitle.includes(normalizedTitle) || normalizedTitle.includes(reqTitle);
                });
            }

            if (requestToUpdate && requestToUpdate.status !== 'server' && requestToUpdate.status !== 'downloading') {
                requestToUpdate.status = 'downloading';
                await writeRequests(requestsData);
                updatedRequest = requestToUpdate;
                console.log(`📋 Petición actualizada a "downloading": ${requestToUpdate.title}`);
                // Notificar a todos los clientes SSE conectados
                notifyRequestUpdate(requestToUpdate);
            }
        } catch (reqError) {
            console.error('Error actualizando petición:', reqError.message);
        }

        // Verificar si la app ya está ejecutándose
        const isRunning = await isDownloaderAppRunning();
        let appLaunched = false;
        let message = 'URL añadida a la cola de descargas';

        if (isRunning) {
            // La app está abierta, se actualizará automáticamente
            console.log('✅ App de descargas ya está abierta - la cola se actualizará automáticamente');
            message = 'URL añadida - La app actualizará la cola automáticamente';
        } else if (!downloaderAppLaunched) {
            // La app no está abierta, lanzarla
            appLaunched = launchDownloaderApp();
            if (appLaunched) {
                message = 'URL añadida - Abriendo aplicación de descargas';
            }
        }

        res.json({
            success: true,
            message,
            queueItem,
            appLaunched,
            appWasRunning: isRunning,
            updatedRequest: updatedRequest ? { id: updatedRequest.id, title: updatedRequest.title, status: 'downloading' } : null
        });
    } catch (error) {
        console.error('Error al añadir a cola:', error);
        res.status(500).json({ error: 'Error al añadir a la cola de descargas' });
    }
});

// GET /api/download-queue - Ver estado de la cola
app.get('/api/download-queue', async (req, res) => {
    try {
        const queue = await readDownloadQueue();
        const stats = {
            total: queue.length,
            pending: queue.filter(q => q.status === 'pending').length,
            downloading: queue.filter(q => q.status === 'downloading').length,
            completed: queue.filter(q => q.status === 'completed').length,
            error: queue.filter(q => q.status === 'error').length
        };
        res.json({ queue, stats });
    } catch (error) {
        res.status(500).json({ error: 'Error al leer la cola' });
    }
});

// ============================================
// MONITOR DE DESCARGAS COMPLETADAS
// ============================================
let lastQueueState = new Map(); // Guardar estado anterior de la cola

// Función para limpiar título de descarga (quitar sufijos de yt-dlp)
function cleanDownloadTitle(title) {
    return (title || '')
        // Quitar sufijos de yt-dlp como .fdash-audio_, .f137, etc.
        .replace(/\.f\d+.*$/, '')
        .replace(/\.fdash.*$/, '')
        .replace(/\s*\(\d{4}\)\s*$/, '') // Quitar año al final
        .trim();
}

// Función para normalizar título para comparación fuzzy
function normalizeTitleFuzzy(title) {
    return (title || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Quitar acentos
        .replace(/[^a-z0-9\s]/g, ' ') // Solo letras, números y espacios
        .replace(/\s+/g, ' ')
        .trim();
}

// Extraer palabras clave (consonantes principales) para matching fuzzy
function extractKeywords(title) {
    const normalized = normalizeTitleFuzzy(title);
    // Palabras de más de 2 caracteres
    return normalized.split(' ').filter(w => w.length > 2);
}

// Calcular similitud entre dos títulos
function titleSimilarity(title1, title2) {
    const words1 = extractKeywords(title1);
    const words2 = extractKeywords(title2);

    if (words1.length === 0 || words2.length === 0) return 0;

    let matches = 0;
    for (const w1 of words1) {
        for (const w2 of words2) {
            // Coincidencia exacta o una contenida en la otra
            if (w1 === w2 || w1.includes(w2) || w2.includes(w1)) {
                matches++;
                break;
            }
        }
    }

    // Porcentaje de palabras que coinciden
    return matches / Math.min(words1.length, words2.length);
}

// Monitorear descargas completadas y actualizar peticiones
async function checkCompletedDownloads() {
    try {
        const queue = await readDownloadQueue();

        for (const item of queue) {
            const prevStatus = lastQueueState.get(item.url);

            // Si el estado cambió a "completed" y antes no lo estaba
            if (item.status === 'completed' && prevStatus !== 'completed') {
                console.log(`✅ Descarga completada detectada: ${item.title}`);

                // Buscar la petición correspondiente y actualizarla
                try {
                    const requestsData = await readRequests();
                    const cleanedTitle = cleanDownloadTitle(item.title);

                    // Buscar la mejor coincidencia
                    let bestMatch = null;
                    let bestScore = 0;

                    for (const r of requestsData.requests) {
                        if (r.status === 'server' || r.status === 'downloaded') continue;

                        const similarity = titleSimilarity(cleanedTitle, r.title);
                        console.log(`   📊 Comparando "${cleanedTitle}" vs "${r.title}": ${(similarity * 100).toFixed(0)}%`);

                        if (similarity > bestScore && similarity >= 0.5) { // Mínimo 50% de coincidencia
                            bestScore = similarity;
                            bestMatch = r;
                        }
                    }

                    if (bestMatch) {
                        bestMatch.status = 'downloaded';
                        await writeRequests(requestsData);
                        console.log(`📋 Petición "${bestMatch.title}" actualizada a "downloaded" (${(bestScore * 100).toFixed(0)}% coincidencia)`);
                        // Notificar via SSE
                        notifyRequestUpdate(bestMatch);
                    } else {
                        console.log(`   ⚠️ No se encontró petición coincidente para: ${cleanedTitle}`);
                    }
                } catch (e) {
                    console.error('Error actualizando petición tras descarga:', e.message);
                }
            }

            // Actualizar estado guardado
            lastQueueState.set(item.url, item.status);
        }
    } catch (e) {
        // Silenciar errores si el archivo no existe
    }
}

// Iniciar monitor de descargas (cada 5 segundos)
setInterval(checkCompletedDownloads, 5000);
console.log('👀 Monitor de descargas completadas iniciado');

// ============================================
// BÚSQUEDA EN TODOTORRENTS (Tor Browser)
// ============================================
const TOR_BROWSER_PATH_WIN = 'C:\\Users\\isidr\\Desktop\\Tor Browser\\Browser\\firefox.exe';
const TOR_BROWSER_PATH_WSL = '/mnt/c/Users/isidr/Desktop/Tor Browser/Browser/firefox.exe';
const TODOTORRENTS_URL = 'https://todotorrents.org';

// Detectar si estamos en Windows o WSL
const isWindows = process.platform === 'win32';
const TOR_BROWSER_PATH = isWindows ? TOR_BROWSER_PATH_WIN : TOR_BROWSER_PATH_WSL;

// Verificar si Tor Browser está corriendo
let torLaunchInProgress = false;
let lastTorLaunch = 0;

function isTorBrowserRunning() {
    return new Promise((resolve) => {
        const { exec } = require('child_process');
        const cmd = isWindows ? 'tasklist /FI "IMAGENAME eq firefox.exe" /FO CSV' : 'tasklist.exe /FI "IMAGENAME eq firefox.exe" /FO CSV';
        exec(cmd, (error, stdout) => {
            if (error) {
                resolve(false);
                return;
            }
            const isRunning = stdout.toLowerCase().includes('firefox.exe');
            resolve(isRunning);
        });
    });
}

// POST /api/search-torrents - Buscar película en todotorrents.org con Tor Browser
// Abre la página, copia al portapapeles, y usa SendKeys para pegar y buscar
app.post('/api/search-torrents', async (req, res) => {
    try {
        const { movieTitle } = req.body;

        if (!movieTitle) {
            return res.status(400).json({ error: 'Título de película requerido' });
        }

        const fsSync = require('fs');
        if (!fsSync.existsSync(TOR_BROWSER_PATH)) {
            console.log('⚠️ Tor Browser no encontrado en:', TOR_BROWSER_PATH);
            return res.status(404).json({ error: 'Tor Browser no encontrado' });
        }

        const { exec } = require('child_process');
        const psCmd = isWindows ? 'powershell' : 'powershell.exe';

        // Copiar título al portapapeles
        const safeTitle = movieTitle.replace(/"/g, '').replace(/'/g, '');
        const clipCmd = isWindows
            ? `echo ${safeTitle}| clip`
            : `cmd.exe /c echo ${safeTitle}| clip.exe`;

        exec(clipCmd, (error) => {
            if (error) {
                console.log('⚠️ Error al copiar al portapapeles:', error.message);
            } else {
                console.log(`📋 Título copiado: ${safeTitle}`);
            }
        });

        console.log(`🔍 Buscando en TodoTorrents: ${movieTitle}`);

        const torRunning = await isTorBrowserRunning();
        const now = Date.now();

        if (torRunning) {
            // Tor ya está abierto: solo copiar al portapapeles, el usuario abre la pestaña
            console.log(`🧅 Tor Browser ya está abierto. Título copiado al portapapeles.`);
            // No abrimos nada nuevo, el usuario puede hacer Ctrl+T, Ctrl+V, Enter
        } else {
            // Protección anti-doble clic (10 segundos)
            if (now - lastTorLaunch < 10000) {
                console.log(`⏳ Tor Browser iniciándose, espera...`);
                return res.json({
                    success: true,
                    message: `Tor Browser ya se está iniciando, espera unos segundos...`,
                    torWasRunning: false
                });
            }
            lastTorLaunch = now;

            // Tor no está abierto: iniciarlo
            console.log(`🧅 Iniciando Tor Browser...`);
            exec(`${psCmd} -Command "Start-Process -FilePath '${TOR_BROWSER_PATH_WIN}' -ArgumentList '${TODOTORRENTS_URL}'"`, (error) => {
                if (error) console.log('⚠️ Error al abrir Tor Browser:', error.message);
            });
        }

        res.json({
            success: true,
            message: `Buscando "${movieTitle}" en TodoTorrents (automático)...`,
            torWasRunning: torRunning
        });
    } catch (error) {
        console.error('Error al buscar en TodoTorrents:', error);
        res.status(500).json({ error: 'Error al abrir Tor Browser' });
    }
});

// Leer caché de películas
async function readCache() {
    try {
        const data = await fs.readFile(CACHE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// Escribir caché de películas (normaliza poster_path → poster)
async function writeCache(cache) {
    // Normalizar campos para consistencia
    for (const data of Object.values(cache)) {
        if (data.poster_path && !data.poster) {
            data.poster = data.poster_path;
        }
        if (data.backdrop_path && !data.backdrop) {
            data.backdrop = data.backdrop_path;
        }
    }
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Limpiar caché de entradas huérfanas (películas que ya no existen)
async function cleanupCache(existingFiles) {
    const cache = await readCache();
    const existingSet = new Set(existingFiles.map(f => f.name || f));

    let removed = 0;
    const cleanedCache = {};

    for (const [filename, data] of Object.entries(cache)) {
        if (existingSet.has(filename)) {
            cleanedCache[filename] = data;
        } else {
            removed++;
            console.log(`🗑️  Eliminando del caché: ${filename}`);
        }
    }

    if (removed > 0) {
        await writeCache(cleanedCache);
        console.log(`✅ Caché limpiado: ${removed} entradas huérfanas eliminadas`);
    }

    return { removed, remaining: Object.keys(cleanedCache).length };
}

// Leer caché de colecciones
async function readCollections() {
    try {
        const data = await fs.readFile(COLLECTIONS_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// Escribir caché de colecciones
async function writeCollections(collections) {
    await fs.writeFile(COLLECTIONS_FILE, JSON.stringify(collections, null, 2));
}

// Actualizar colección con información de película
async function updateCollectionWithMovie(collectionInfo, movieData) {
    if (!collectionInfo || !collectionInfo.id) return;

    const collections = await readCollections();
    const collectionId = collectionInfo.id.toString();

    if (!collections[collectionId]) {
        // Nueva colección - obtener detalles completos de TMDB
        try {
            const response = await tmdbFetch(`${TMDB_BASE_URL}/collection/${collectionInfo.id}`, {
                params: { api_key: TMDB_API_KEY, language: 'es-ES' },
                timeout: 5000
            });

            const collData = response.data;
            collections[collectionId] = {
                id: collData.id,
                name: collData.name,
                overview: collData.overview,
                poster: collData.poster_path ? `${TMDB_IMAGE_BASE}${collData.poster_path}` : null,
                backdrop: collData.backdrop_path ? `${TMDB_IMAGE_BASE}${collData.backdrop_path}` : null,
                movies: [], // Películas que tenemos en nuestra biblioteca
                genre_ids: [], // Se actualizará con los géneros de las películas
                cached_at: Date.now()
            };
            console.log(`📚 Nueva colección: ${collData.name}`);
        } catch (error) {
            // Si falla, crear con info básica
            collections[collectionId] = {
                id: collectionInfo.id,
                name: collectionInfo.name,
                poster: collectionInfo.poster_path ? `${TMDB_IMAGE_BASE}${collectionInfo.poster_path}` : null,
                backdrop: collectionInfo.backdrop_path ? `${TMDB_IMAGE_BASE}${collectionInfo.backdrop_path}` : null,
                movies: [],
                genre_ids: [],
                cached_at: Date.now()
            };
        }
    }

    // Añadir película a la colección si no está
    const movieEntry = {
        filename: movieData.filename,
        tmdb_id: movieData.tmdb_id,
        title: movieData.title,
        poster: movieData.poster_path,
        release_date: movieData.release_date,
        genre_ids: movieData.genre_ids || []
    };

    const existingIndex = collections[collectionId].movies.findIndex(m => m.filename === movieData.filename);
    if (existingIndex >= 0) {
        collections[collectionId].movies[existingIndex] = movieEntry;
    } else {
        collections[collectionId].movies.push(movieEntry);
    }

    // Actualizar géneros de la colección (unión de géneros de todas las películas)
    const allGenres = new Set(collections[collectionId].genre_ids);
    (movieData.genre_ids || []).forEach(g => allGenres.add(g));
    collections[collectionId].genre_ids = Array.from(allGenres);

    await writeCollections(collections);
}

// Eliminar película de colecciones
async function removeMovieFromCollections(filename) {
    const collections = await readCollections();
    let modified = false;

    for (const collId of Object.keys(collections)) {
        const coll = collections[collId];
        const initialLength = coll.movies.length;
        coll.movies = coll.movies.filter(m => m.filename !== filename);

        if (coll.movies.length !== initialLength) {
            modified = true;
            console.log(`📚 Película eliminada de colección: ${coll.name}`);

            // Si la colección queda vacía, eliminarla
            if (coll.movies.length === 0) {
                delete collections[collId];
                console.log(`🗑️ Colección vacía eliminada: ${coll.name}`);
            } else {
                // Recalcular géneros
                const allGenres = new Set();
                coll.movies.forEach(m => (m.genre_ids || []).forEach(g => allGenres.add(g)));
                coll.genre_ids = Array.from(allGenres);
            }
        }
    }

    if (modified) {
        await writeCollections(collections);
    }
}

// Verificar si la entrada del caché está expirada
function isCacheExpired(cacheEntry) {
    if (!cacheEntry || !cacheEntry.cached_at) {
        return true;
    }
    const now = Date.now();
    const cacheAge = now - cacheEntry.cached_at;
    return cacheAge > CACHE_TTL;
}

// Limpiar nombre de archivo para búsqueda en TMDB
function cleanMovieName(filename) {
    // Quitar extensión
    let name = filename.replace(/\.(mp4|mkv|avi|mov)$/i, '');

    // Extraer año si existe en formato (YYYY) o al final como "Movie 2004"
    let year = null;

    // Buscar año entre paréntesis: "Película (1999)"
    const yearInParens = name.match(/\((\d{4})\)/);
    if (yearInParens) {
        year = parseInt(yearInParens[1]);
        name = name.replace(/\s*\(\d{4}\)/, '');
    } else {
        // Buscar año al final: "Película 2004" (solo si parece un año válido)
        const yearAtEnd = name.match(/\s(19\d{2}|20[0-2]\d)$/);
        if (yearAtEnd) {
            year = parseInt(yearAtEnd[1]);
            name = name.replace(/\s(19\d{2}|20[0-2]\d)$/, '');
        }
    }

    // Limpiar caracteres especiales pero MANTENER números del título
    // Ej: "300", "2001 Una odisea", "1917", "48 horas"
    name = name
        .replace(/[_\.]/g, ' ')           // Reemplazar _ y . por espacios
        .replace(/\s+/g, ' ')             // Múltiples espacios a uno
        .trim();

    // Si el nombre quedó vacío, usar el original sin extensión
    if (name.length < 2) {
        name = filename.replace(/\.(mp4|mkv|avi|mov)$/i, '').replace(/[_\.]/g, ' ').trim();
    }

    return { title: name, year };
}

// Buscar película en TMDB con timeout agresivo
async function searchTMDB(filename) {
    const { title, year } = cleanMovieName(filename);

    try {
        const searchUrl = `${TMDB_BASE_URL}/search/movie`;
        const params = {
            api_key: TMDB_API_KEY,
            query: title,
            language: 'es-ES',
            ...(year && { year })
        };

        const response = await tmdbFetch(searchUrl, {
            params,
            timeout: 5000,
            headers: { 'Accept': 'application/json' }
        });

        if (response.data.results && response.data.results.length > 0) {
            const movie = response.data.results[0];
            console.log(`✅ TMDB: ${title} -> ${movie.title}`);

            // Obtener detalles extendidos de la película (colección, duración, videos, recomendaciones)
            let collection = null;
            let runtime = null;
            let videos = [];
            let recommendations = [];
            let cast = [];

            try {
                const detailsResponse = await tmdbFetch(`${TMDB_BASE_URL}/movie/${movie.id}`, {
                    params: {
                        api_key: TMDB_API_KEY,
                        language: 'es-ES',
                        append_to_response: 'videos,recommendations,credits'
                    },
                    timeout: 8000
                });

                const details = detailsResponse.data;

                // Colección/Saga
                if (details.belongs_to_collection) {
                    collection = details.belongs_to_collection;
                }

                // Duración en minutos
                runtime = details.runtime || null;

                // Videos (trailers, clips) - filtrar solo YouTube
                if (details.videos?.results) {
                    videos = details.videos.results
                        .filter(v => v.site === 'YouTube' && ['Trailer', 'Teaser', 'Clip'].includes(v.type))
                        .slice(0, 5) // Máximo 5 videos
                        .map(v => ({
                            key: v.key,
                            name: v.name,
                            type: v.type,
                            url: `https://www.youtube.com/watch?v=${v.key}`
                        }));
                }

                // Películas similares/recomendadas
                if (details.recommendations?.results) {
                    recommendations = details.recommendations.results
                        .slice(0, 10) // Máximo 10 recomendaciones
                        .map(r => ({
                            tmdb_id: r.id,
                            title: r.title,
                            overview: r.overview || '',
                            poster_path: r.poster_path ? `${TMDB_IMAGE_BASE}${r.poster_path}` : null,
                            release_date: r.release_date,
                            vote_average: r.vote_average
                        }));
                }

                // Reparto (cast) - máximo 15 actores principales
                if (details.credits?.cast) {
                    cast = details.credits.cast
                        .slice(0, 15)
                        .map(actor => ({
                            id: actor.id,
                            name: actor.name,
                            character: actor.character,
                            photo: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : null
                        }));
                }
            } catch (e) {
                // Ignorar error de detalles, continuar con datos básicos
                console.warn(`⚠️ No se pudieron obtener detalles extendidos para: ${title}`);
            }

            const movieData = {
                tmdb_id: movie.id,
                title: movie.title,
                overview: movie.overview,
                poster_path: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
                backdrop_path: movie.backdrop_path ? `${TMDB_IMAGE_BASE}${movie.backdrop_path}` : null,
                release_date: movie.release_date,
                vote_average: movie.vote_average,
                genre_ids: movie.genre_ids || [],
                runtime: runtime,
                videos: videos,
                recommendations: recommendations,
                cast: cast,
                collection: collection ? {
                    id: collection.id,
                    name: collection.name,
                    poster_path: collection.poster_path,
                    backdrop_path: collection.backdrop_path
                } : null
            };

            // Actualizar colección si existe
            if (collection) {
                await updateCollectionWithMovie(collection, { ...movieData, filename });
            }

            return movieData;
        }

        return null;
    } catch (error) {
        console.error(`❌ TMDB timeout/error: ${title}`);
        return null;
    }
}

// Obtener metadata con caché y TTL
async function getMovieMetadata(filename) {
    const cache = await readCache();

    // Si está en caché y no ha expirado, devolverlo
    if (cache[filename] && !isCacheExpired(cache[filename])) {
        console.log(`💾 Caché válido para: ${filename}`);
        return cache[filename];
    }

    // Si no está o expiró, buscar en TMDB
    console.log(`🔍 Buscando en TMDB: ${filename}`);
    const metadata = await searchTMDB(filename);

    // Guardar en caché con timestamp
    if (metadata) {
        cache[filename] = {
            ...metadata,
            cached_at: Date.now()
        };
        await writeCache(cache);
    }

    return metadata;
}

// 1. Listar archivos para la interfaz (soporta LOCAL y FTP)
app.get('/api/videos', async (req, res) => {
    try {
        let videoFiles = [];

        // ========== MODO LOCAL ==========
        if (storageConfig.mode === 'local') {
            console.log(`📂 Listando archivos locales en: ${storageConfig.localPath}`);

            if (!fsSync.existsSync(storageConfig.localPath)) {
                return res.status(500).json({ error: `Ruta local no existe: ${storageConfig.localPath}` });
            }

            const files = fsSync.readdirSync(storageConfig.localPath);
            videoFiles = files
                .filter(name => name.match(/\.(mp4|mkv|avi|mov)$/i))
                .map(name => {
                    try {
                        const fullPath = path.join(storageConfig.localPath, name);
                        const stats = fsSync.statSync(fullPath);
                        return { name, size: stats.size, mtime: stats.mtime };
                    } catch (err) {
                        console.warn(`⚠️  No se puede acceder a: ${name} (${err.code})`);
                        return null;
                    }
                })
                .filter(f => f !== null); // Eliminar archivos inaccesibles

            console.log(`✅ Encontrados ${videoFiles.length} videos locales`);

        // ========== MODO FTP (RED) ==========
        } else {
            const client = new ftp.Client();
            client.ftp.timeout = 120000;
            client.ftp.verbose = false;

            try {
                console.log('🔌 Conectando a FTP...');
                await client.access({
                    ...FTP_CONFIG,
                    secure: false,
                    passive: true
                });
                console.log('✅ Conectado a FTP');

                console.log('📂 Listando archivos en /volume-1...');
                const list = await client.list("/volume-1");
                console.log(`✅ Obtenidos ${list.length} archivos`);
                videoFiles = list.filter(file => file.name.match(/\.(mp4|mkv|avi|mov)$/i));
            } finally {
                client.close();
            }
        }

        // Cargar caché del backend para aplicar carátulas guardadas
        const cache = await readCache();

        // Crear lista de videos con metadata del caché si existe
        const videosWithMetadata = videoFiles.map((file) => {
            const cached = cache[file.name];
            // mtime para local, modifiedAt para FTP
            const fileDate = file.mtime || file.modifiedAt || null;
            return {
                filename: file.name,
                title: cached?.title || file.name.replace(/\.(mp4|mkv|avi|mov)$/i, ''),
                size: (file.size / (1024 * 1024)).toFixed(1) + " MB",
                url: `/stream/${encodeURIComponent(file.name)}`,
                tmdb_id: cached?.tmdb_id || null,
                poster: cached?.poster || cached?.poster_path || null,
                backdrop: cached?.backdrop || cached?.backdrop_path || null,
                overview: cached?.overview || null,
                releaseDate: cached?.releaseDate || cached?.release_date || null,
                rating: cached?.rating || cached?.vote_average || null,
                genreIds: cached?.genreIds || cached?.genre_ids || [],
                runtime: cached?.runtime || null,
                videos: cached?.videos || [],
                recommendations: cached?.recommendations || [],
                cast: cached?.cast || [],
                addedDate: fileDate ? new Date(fileDate).toISOString() : null
            };
        });

        console.log(`📦 Videos cargados: ${videosWithMetadata.length} (${Object.keys(cache).length} en caché) [Modo: ${storageConfig.mode.toUpperCase()}]`);

        // Buscar películas sin metadatos de TMDB para actualizar en background
        const moviesWithoutMetadata = videosWithMetadata.filter(v => !v.tmdb_id);
        if (moviesWithoutMetadata.length > 0) {
            console.log(`🔍 ${moviesWithoutMetadata.length} películas sin metadatos TMDB, buscando en background...`);

            // Ejecutar en background (no bloqueante)
            (async () => {
                let updated = 0;
                for (const movie of moviesWithoutMetadata) {
                    try {
                        const metadata = await getMovieMetadata(movie.filename);
                        if (metadata && metadata.tmdb_id) {
                            updated++;
                            console.log(`✅ Metadatos encontrados: ${movie.filename} -> ${metadata.title}`);
                        }
                        // Pequeña pausa para no saturar TMDB API
                        await new Promise(r => setTimeout(r, 300));
                    } catch (err) {
                        console.error(`❌ Error buscando metadatos para ${movie.filename}:`, err.message);
                    }
                }
                if (updated > 0) {
                    console.log(`✅ Metadatos actualizados para ${updated} películas nuevas`);
                }
            })();
        }

        res.json(videosWithMetadata);
    } catch (err) {
        console.error('Error al listar videos:', err);
        res.status(500).json({ error: "No se pudo conectar al disco" });
    }
});

// 1.5 Obtener lista de géneros de TMDB
app.get('/api/genres', async (req, res) => {
    // Lista fija de géneros de TMDB (evita problemas de conectividad)
    const genres = [
        { id: 28, name: 'Acción' },
        { id: 12, name: 'Aventura' },
        { id: 16, name: 'Animación' },
        { id: 35, name: 'Comedia' },
        { id: 80, name: 'Crimen' },
        { id: 99, name: 'Documental' },
        { id: 18, name: 'Drama' },
        { id: 10751, name: 'Familia' },
        { id: 14, name: 'Fantasía' },
        { id: 36, name: 'Historia' },
        { id: 27, name: 'Terror' },
        { id: 10402, name: 'Música' },
        { id: 9648, name: 'Misterio' },
        { id: 10749, name: 'Romance' },
        { id: 878, name: 'Ciencia ficción' },
        { id: 10770, name: 'Película de TV' },
        { id: 53, name: 'Suspense' },
        { id: 10752, name: 'Bélica' },
        { id: 37, name: 'Western' }
    ];

    console.log('📚 Géneros cargados localmente:', genres.length);
    res.json(genres);
});

// 1.7 Obtener colecciones
app.get('/api/collections', async (req, res) => {
    try {
        const { genre } = req.query;
        const collections = await readCollections();

        let collectionsList = Object.values(collections);

        // Filtrar por género si se especifica
        if (genre) {
            const genreId = parseInt(genre);
            collectionsList = collectionsList.filter(c =>
                c.genre_ids && c.genre_ids.includes(genreId)
            );
        }

        // Ordenar por nombre
        collectionsList.sort((a, b) => a.name.localeCompare(b.name, 'es'));

        // Solo devolver colecciones que tienen películas
        collectionsList = collectionsList.filter(c => c.movies && c.movies.length > 0);

        console.log(`📚 Colecciones: ${collectionsList.length}${genre ? ` (género: ${genre})` : ''}`);
        res.json(collectionsList);

    } catch (error) {
        console.error('Error obteniendo colecciones:', error.message);
        res.status(500).json({ error: 'Error al obtener colecciones' });
    }
});

// 1.71 Obtener detalle de una colección
app.get('/api/collections/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const collections = await readCollections();

        const collection = collections[id];
        if (!collection) {
            return res.status(404).json({ error: 'Colección no encontrada' });
        }

        res.json(collection);

    } catch (error) {
        console.error('Error obteniendo colección:', error.message);
        res.status(500).json({ error: 'Error al obtener colección' });
    }
});

// 1.75 Buscar películas en TMDB (búsqueda manual con múltiples resultados)
app.get('/api/tmdb/search', async (req, res) => {
    try {
        let { query, year } = req.query;

        if (!query || query.trim().length < 2) {
            return res.status(400).json({ error: 'Se requiere un término de búsqueda' });
        }

        // Extraer año del query si viene en formato "Película (2025)"
        let searchQuery = query.trim();
        let searchYear = year || null;

        const yearInParens = searchQuery.match(/\((\d{4})\)\s*$/);
        if (yearInParens) {
            searchYear = yearInParens[1];
            searchQuery = searchQuery.replace(/\s*\(\d{4}\)\s*$/, '').trim();
        }

        console.log(`🔎 Búsqueda manual TMDB: "${searchQuery}"${searchYear ? ` (año: ${searchYear})` : ''}`);

        const searchUrl = `${TMDB_BASE_URL}/search/movie`;
        const params = {
            api_key: TMDB_API_KEY,
            query: searchQuery,
            language: 'es-ES',
            include_adult: false
        };

        // Añadir año si está disponible
        if (searchYear) {
            params.year = searchYear;
        }

        const response = await tmdbFetch(searchUrl, {
            params,
            timeout: 30000
        });

        if (response.data.results && response.data.results.length > 0) {
            // Devolver hasta 12 resultados con información completa
            const results = response.data.results.slice(0, 12).map(movie => ({
                tmdb_id: movie.id,
                title: movie.title,
                original_title: movie.original_title,
                overview: movie.overview ? movie.overview.substring(0, 200) + '...' : null,
                poster: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
                backdrop: movie.backdrop_path ? `${TMDB_IMAGE_BASE}${movie.backdrop_path}` : null,
                release_date: movie.release_date,
                year: movie.release_date ? movie.release_date.substring(0, 4) : null,
                rating: movie.vote_average,
                genre_ids: movie.genre_ids || []
            }));

            console.log(`✅ Encontrados ${results.length} resultados para "${query}"`);
            res.json({ success: true, results });
        } else {
            console.log(`❌ Sin resultados para "${query}"`);
            res.json({ success: true, results: [] });
        }

    } catch (error) {
        console.error('Error en búsqueda TMDB:', error.message);
        res.status(500).json({ error: 'Error al buscar en TMDB' });
    }
});

// Obtener cast de una película por TMDB ID
app.get('/api/tmdb/cast/:tmdbId', async (req, res) => {
    try {
        const { tmdbId } = req.params;

        if (!tmdbId) {
            return res.status(400).json({ error: 'Se requiere TMDB ID' });
        }

        console.log(`🎭 Obteniendo cast para TMDB ID: ${tmdbId}`);

        const response = await tmdbFetch(`${TMDB_BASE_URL}/movie/${tmdbId}/credits`, {
            params: { language: 'es-ES' }
        });

        if (response.data.cast) {
            const cast = response.data.cast
                .slice(0, 20)
                .map(actor => ({
                    id: actor.id,
                    name: actor.name,
                    character: actor.character,
                    photo: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : null
                }));

            // Actualizar cache si tenemos el filename
            const { filename } = req.query;
            if (filename) {
                const cache = await readCache();
                if (cache[filename]) {
                    cache[filename].cast = cast;
                    await writeCache(cache);
                    console.log(`✅ Cast guardado en cache para: ${filename}`);
                }
            }

            res.json({ success: true, cast });
        } else {
            res.json({ success: true, cast: [] });
        }
    } catch (error) {
        console.error('Error obteniendo cast:', error.message);
        res.status(500).json({ error: 'Error al obtener cast de TMDB' });
    }
});

// Obtener cast buscando por título (cuando no hay tmdb_id)
app.get('/api/tmdb/cast-by-title', async (req, res) => {
    try {
        const { title, year, filename } = req.query;

        if (!title) {
            return res.status(400).json({ error: 'Se requiere título' });
        }

        console.log(`🎭 Buscando cast por título: "${title}" (${year || 'sin año'})`);

        // Buscar película en TMDB
        const searchParams = {
            params: {
                language: 'es-ES',
                query: title
            }
        };
        if (year) {
            searchParams.params.year = year;
        }

        const searchResponse = await tmdbFetch(`${TMDB_BASE_URL}/search/movie`, searchParams);
        const results = searchResponse.data.results;

        if (!results || results.length === 0) {
            console.log(`❌ No se encontró película: "${title}"`);
            return res.json({ success: false, error: 'Película no encontrada en TMDB', cast: [] });
        }

        const movie = results[0];
        const tmdbId = movie.id;
        console.log(`✅ Encontrado: "${movie.title}" (${movie.release_date?.substring(0, 4)}) - ID: ${tmdbId}`);

        // Obtener cast
        const creditsResponse = await tmdbFetch(`${TMDB_BASE_URL}/movie/${tmdbId}/credits`, {
            params: { language: 'es-ES' }
        });

        const cast = (creditsResponse.data.cast || [])
            .slice(0, 20)
            .map(actor => ({
                id: actor.id,
                name: actor.name,
                character: actor.character,
                photo: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : null
            }));

        // Actualizar cache con los metadatos completos
        if (filename) {
            const cache = await readCache();
            if (cache[filename]) {
                cache[filename].tmdb_id = tmdbId;
                cache[filename].cast = cast;
                cache[filename].title = movie.title;
                cache[filename].year = movie.release_date?.substring(0, 4);
                cache[filename].overview = movie.overview;
                if (movie.poster_path) {
                    cache[filename].poster = `${TMDB_IMAGE_BASE}${movie.poster_path}`;
                }
                await writeCache(cache);
                console.log(`✅ Metadatos actualizados en cache para: ${filename}`);
            }
        }

        res.json({
            success: true,
            cast,
            tmdb_id: tmdbId,
            title: movie.title,
            year: movie.release_date?.substring(0, 4)
        });
    } catch (error) {
        console.error('Error buscando cast por título:', error.message);
        res.status(500).json({ error: 'Error al buscar en TMDB' });
    }
});

// Buscar actores y obtener sus películas
app.get('/api/tmdb/actor', async (req, res) => {
    try {
        const { query } = req.query;

        if (!query || query.trim().length < 2) {
            return res.status(400).json({ error: 'Se requiere nombre del actor' });
        }

        console.log(`🎭 Buscando actor: "${query}"`);

        // 1. Buscar persona
        const personResponse = await tmdbFetch(`${TMDB_BASE_URL}/search/person`, {
            params: {
                api_key: TMDB_API_KEY,
                query: query.trim(),
                language: 'es-ES'
            },
            timeout: 30000
        });

        if (!personResponse.data.results || personResponse.data.results.length === 0) {
            return res.json({ success: true, actor: null, movies: [] });
        }

        // Normalizar texto para comparación
        const normalize = (str) => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        const queryNorm = normalize(query);

        // Filtrar actores y ordenar por: 1) coincidencia exacta del nombre, 2) popularidad
        const actors = personResponse.data.results
            .filter(p => p.known_for_department === 'Acting' || p.known_for?.length > 0)
            .sort((a, b) => {
                const aExact = normalize(a.name) === queryNorm ? 1 : 0;
                const bExact = normalize(b.name) === queryNorm ? 1 : 0;
                // Primero por coincidencia exacta
                if (aExact !== bExact) return bExact - aExact;
                // Luego por popularidad
                return (b.popularity || 0) - (a.popularity || 0);
            });

        // Usar el mejor match, o el primero si no hay actores
        const actor = actors.length > 0 ? actors[0] : personResponse.data.results[0];
        console.log(`✅ Actor encontrado: ${actor.name} (ID: ${actor.id}, popularidad: ${actor.popularity})`);

        // 2. Obtener filmografía del actor
        const creditsResponse = await tmdbFetch(`${TMDB_BASE_URL}/person/${actor.id}/movie_credits`, {
            params: {
                api_key: TMDB_API_KEY,
                language: 'es-ES'
            },
            timeout: 30000
        });

        // Filtrar solo películas donde actuó (cast), ordenar por popularidad
        const movies = (creditsResponse.data.cast || [])
            .filter(m => m.poster_path) // Solo con poster
            .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
            .slice(0, 100) // Máximo 100 películas
            .map(movie => ({
                tmdb_id: movie.id,
                title: movie.title,
                original_title: movie.original_title,
                character: movie.character,
                poster: `${TMDB_IMAGE_BASE}${movie.poster_path}`,
                year: movie.release_date ? movie.release_date.substring(0, 4) : null,
                rating: movie.vote_average,
                overview: movie.overview
            }));

        console.log(`🎬 ${movies.length} películas encontradas para ${actor.name}`);

        res.json({
            success: true,
            actor: {
                id: actor.id,
                name: actor.name,
                photo: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : null
            },
            movies
        });

    } catch (error) {
        console.error('Error buscando actor:', error.message);
        res.status(500).json({ error: 'Error al buscar actor' });
    }
});

// 1.8 Actualizar carátula de una película específica (con datos extendidos)
app.post('/api/movies/update-poster', async (req, res) => {
    try {
        const { filename, metadata } = req.body;

        if (!filename || !metadata) {
            return res.status(400).json({ error: 'Se requiere filename y metadata' });
        }

        console.log(`🔄 Actualizando carátula de: ${filename}`);

        // Preparar datos base
        let extendedMetadata = {
            tmdb_id: metadata.tmdb_id || metadata.id,
            title: metadata.title,
            overview: metadata.overview,
            poster_path: metadata.poster || metadata.poster_path,
            backdrop_path: metadata.backdrop || metadata.backdrop_path,
            release_date: metadata.release_date,
            vote_average: metadata.vote_average || metadata.rating,
            genre_ids: metadata.genre_ids || [],
            cached_at: Date.now()
        };

        // Si tenemos tmdb_id, obtener datos extendidos (videos, recomendaciones, runtime, cast)
        const tmdbId = metadata.tmdb_id || metadata.id;
        if (tmdbId && TMDB_API_KEY) {
            try {
                console.log(`📡 Obteniendo datos extendidos de TMDB para ID: ${tmdbId}`);
                const detailsResponse = await tmdbFetch(`${TMDB_BASE_URL}/movie/${tmdbId}`, {
                    params: {
                        api_key: TMDB_API_KEY,
                        language: 'es-ES',
                        append_to_response: 'videos,recommendations,credits'
                    },
                    timeout: 8000
                });

                const details = detailsResponse.data;

                // Runtime
                extendedMetadata.runtime = details.runtime || null;

                // Videos (trailers)
                if (details.videos?.results) {
                    extendedMetadata.videos = details.videos.results
                        .filter(v => v.site === 'YouTube' && ['Trailer', 'Teaser', 'Clip'].includes(v.type))
                        .slice(0, 5)
                        .map(v => ({
                            key: v.key,
                            name: v.name,
                            type: v.type,
                            url: `https://www.youtube.com/watch?v=${v.key}`
                        }));
                }

                // Recomendaciones
                if (details.recommendations?.results) {
                    extendedMetadata.recommendations = details.recommendations.results
                        .slice(0, 10)
                        .map(r => ({
                            tmdb_id: r.id,
                            title: r.title,
                            overview: r.overview || '',
                            poster_path: r.poster_path ? `${TMDB_IMAGE_BASE}${r.poster_path}` : null,
                            release_date: r.release_date,
                            vote_average: r.vote_average
                        }));
                }

                // Reparto (cast)
                if (details.credits?.cast) {
                    extendedMetadata.cast = details.credits.cast
                        .slice(0, 15)
                        .map(actor => ({
                            id: actor.id,
                            name: actor.name,
                            character: actor.character,
                            photo: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : null
                        }));
                }

                // Colección
                if (details.belongs_to_collection) {
                    extendedMetadata.collection = {
                        id: details.belongs_to_collection.id,
                        name: details.belongs_to_collection.name,
                        poster_path: details.belongs_to_collection.poster_path,
                        backdrop_path: details.belongs_to_collection.backdrop_path
                    };
                }

                console.log(`✅ Datos extendidos: ${extendedMetadata.videos?.length || 0} videos, ${extendedMetadata.recommendations?.length || 0} recomendaciones, ${extendedMetadata.cast?.length || 0} actores`);
            } catch (e) {
                console.warn(`⚠️ No se pudieron obtener datos extendidos: ${e.message}`);
            }
        }

        // Generar nuevo nombre de archivo basado en TMDB
        const title = extendedMetadata.title || metadata.title;
        const year = extendedMetadata.release_date?.substring(0, 4) || metadata.year;
        const extension = path.extname(filename).toLowerCase();

        // Función para quitar acentos (evita problemas de codificación en FTP)
        const removeAccents = (str) => {
            return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        };

        // Limpiar título para nombre de archivo (quitar caracteres no permitidos y acentos)
        const cleanTitle = removeAccents(title)
            .replace(/[<>:"/\\|?*]/g, '') // Caracteres no permitidos en Windows
            .replace(/\s+/g, ' ')
            .trim();

        const newFilename = year ? `${cleanTitle} (${year})${extension}` : `${cleanTitle}${extension}`;

        let finalFilename = filename; // Por defecto mantener el original
        let renamed = false;

        // Solo renombrar si el nombre es diferente
        if (newFilename !== filename) {
            console.log(`📝 Renombrando: "${filename}" → "${newFilename}"`);

            try {
                if (storageConfig.mode === 'local') {
                    // ========== MODO LOCAL ==========
                    const oldPath = path.join(storageConfig.localPath, filename);
                    const newPath = path.join(storageConfig.localPath, newFilename);

                    // Verificar que el archivo original existe
                    if (fsSync.existsSync(oldPath)) {
                        // Verificar que el nuevo nombre no existe ya
                        if (fsSync.existsSync(newPath) && oldPath !== newPath) {
                            console.log(`⚠️ Ya existe un archivo con el nombre: ${newFilename}`);
                        } else {
                            fsSync.renameSync(oldPath, newPath);
                            finalFilename = newFilename;
                            renamed = true;
                            console.log(`✅ Archivo local renombrado: ${newFilename}`);
                        }
                    }
                } else {
                    // ========== MODO FTP ==========
                    const client = new ftp.Client();
                    try {
                        await client.access({
                            ...FTP_CONFIG,
                            secure: false,
                            passive: true
                        });

                        // Verificar que no existe ya un archivo con ese nombre
                        const fileList = await client.list('/volume-1');
                        const exists = fileList.some(f => f.name === newFilename);

                        if (exists && newFilename !== filename) {
                            console.log(`⚠️ Ya existe un archivo con el nombre: ${newFilename}`);
                        } else {
                            await client.rename(`/volume-1/${filename}`, `/volume-1/${newFilename}`);
                            finalFilename = newFilename;
                            renamed = true;
                            console.log(`✅ Archivo FTP renombrado: ${newFilename}`);
                        }
                    } finally {
                        client.close();
                    }
                }
            } catch (renameError) {
                console.error(`⚠️ Error renombrando archivo: ${renameError.message}`);
                // Continuar sin renombrar, no es crítico
            }
        }

        // Actualizar caché del backend
        const cache = await readCache();

        // Si se renombró, eliminar la entrada antigua y crear la nueva
        if (renamed && finalFilename !== filename) {
            delete cache[filename];
        }

        cache[finalFilename] = extendedMetadata;
        await writeCache(cache);

        // Actualizar colección/saga automáticamente si la película pertenece a una
        let collectionUpdated = false;
        if (extendedMetadata.tmdb_id) {
            try {
                const detailsResponse = await tmdbFetch(`${TMDB_BASE_URL}/movie/${extendedMetadata.tmdb_id}`, {
                    params: { api_key: TMDB_API_KEY, language: 'es-ES' },
                    timeout: 5000
                });

                if (detailsResponse.data.belongs_to_collection) {
                    const collection = detailsResponse.data.belongs_to_collection;

                    // Guardar info de colección en el caché
                    cache[finalFilename].collection = {
                        id: collection.id,
                        name: collection.name,
                        poster_path: collection.poster_path,
                        backdrop_path: collection.backdrop_path
                    };
                    await writeCache(cache);

                    // Añadir película a la colección
                    await updateCollectionWithMovie(collection, {
                        ...extendedMetadata,
                        filename: finalFilename,
                        poster_path: extendedMetadata.poster_path
                    });

                    collectionUpdated = true;
                    console.log(`📚 Película añadida a saga: ${collection.name}`);
                }
            } catch (collError) {
                console.error(`⚠️ Error actualizando saga: ${collError.message}`);
            }
        }

        console.log(`✅ Carátula actualizada para: ${finalFilename}`);
        res.json({
            success: true,
            message: renamed ? 'Carátula actualizada y archivo renombrado' : 'Carátula actualizada',
            metadata: extendedMetadata,
            newFilename: finalFilename,
            renamed: renamed,
            collectionUpdated: collectionUpdated
        });

    } catch (error) {
        console.error('Error actualizando carátula:', error.message);
        res.status(500).json({ error: 'Error al actualizar carátula' });
    }
});

// 1.85 Eliminar archivo del servidor (LOCAL o FTP)
app.post('/api/files/delete', async (req, res) => {
    try {
        const { filename } = req.body;

        if (!filename) {
            return res.status(400).json({ error: 'Se requiere el nombre del archivo' });
        }

        console.log(`🗑️ Solicitud de eliminación: ${filename} [${storageConfig.mode.toUpperCase()}]`);

        // ========== MODO LOCAL ==========
        if (storageConfig.mode === 'local') {
            const localPath = path.join(storageConfig.localPath, filename);

            if (!fsSync.existsSync(localPath)) {
                return res.status(404).json({ error: 'El archivo no existe en el servidor' });
            }

            // Eliminar archivo
            fsSync.unlinkSync(localPath);
            console.log(`📂 Archivo local eliminado: ${localPath}`);

        // ========== MODO FTP ==========
        } else {
            const client = new ftp.Client();
            client.ftp.verbose = false;

            try {
                await client.access({
                    host: FTP_CONFIG.host,
                    user: FTP_CONFIG.user,
                    password: FTP_CONFIG.password,
                    port: FTP_CONFIG.port,
                    secure: false
                });

                client.ftp.socket.setTimeout(30000);

                const filePath = `/volume-1/${filename}`;
                console.log(`📂 Ruta FTP: ${filePath}`);
                await client.remove(filePath);
            } catch (ftpError) {
                if (ftpError.message.includes('550') || ftpError.message.includes('No such file')) {
                    return res.status(404).json({ error: 'El archivo no existe en el servidor' });
                }
                throw ftpError;
            } finally {
                client.close();
            }
        }

        // Eliminar del caché local
        const cache = await readCache();
        if (cache[filename]) {
            delete cache[filename];
            await writeCache(cache);
            console.log(`📦 Eliminado del caché: ${filename}`);
        }

        // Eliminar de las colecciones
        await removeMovieFromCollections(filename);

        console.log(`✅ Archivo eliminado exitosamente: ${filename}`);
        res.json({ success: true, message: 'Archivo eliminado correctamente' });

    } catch (error) {
        console.error('❌ Error eliminando archivo:', error.message);
        res.status(500).json({ error: `Error al eliminar: ${error.message}` });
    }
});

// 1.88 Generar colecciones desde el caché existente
app.post('/api/collections/generate', async (req, res) => {
    try {
        console.log('📚 Generando colecciones desde caché existente...');

        const cache = await readCache();
        const filenames = Object.keys(cache);
        let collectionsFound = 0;
        let processed = 0;

        for (const filename of filenames) {
            const movieData = cache[filename];

            // Si ya tiene collection, saltar
            if (movieData.collection) {
                await updateCollectionWithMovie(movieData.collection, {
                    ...movieData,
                    filename,
                    poster_path: movieData.poster_path
                });
                collectionsFound++;
                processed++;
                continue;
            }

            // Si tiene tmdb_id, buscar detalles para obtener colección
            if (movieData.tmdb_id) {
                try {
                    const detailsResponse = await tmdbFetch(`${TMDB_BASE_URL}/movie/${movieData.tmdb_id}`, {
                        params: { api_key: TMDB_API_KEY, language: 'es-ES' },
                        timeout: 5000
                    });

                    if (detailsResponse.data.belongs_to_collection) {
                        const collection = detailsResponse.data.belongs_to_collection;

                        // Guardar collection en el caché de películas
                        cache[filename].collection = {
                            id: collection.id,
                            name: collection.name,
                            poster_path: collection.poster_path,
                            backdrop_path: collection.backdrop_path
                        };

                        await updateCollectionWithMovie(collection, {
                            ...movieData,
                            filename,
                            poster_path: movieData.poster_path
                        });

                        collectionsFound++;
                    }

                    processed++;

                    // Rate limiting
                    if (processed % 10 === 0) {
                        console.log(`📊 Procesadas ${processed}/${filenames.length} películas, ${collectionsFound} colecciones encontradas`);
                    }

                    await new Promise(resolve => setTimeout(resolve, 350));

                } catch (e) {
                    // Ignorar errores individuales
                }
            }
        }

        // Guardar caché actualizado
        await writeCache(cache);

        const collections = await readCollections();
        const totalCollections = Object.keys(collections).length;

        console.log(`✅ Generación completada: ${totalCollections} colecciones, ${collectionsFound} películas en colecciones`);

        res.json({
            success: true,
            message: `Generadas ${totalCollections} colecciones con ${collectionsFound} películas`,
            totalCollections,
            moviesInCollections: collectionsFound
        });

    } catch (error) {
        console.error('Error generando colecciones:', error.message);
        res.status(500).json({ error: 'Error al generar colecciones' });
    }
});

// 1.9 Enriquecer películas con metadata de TMDB (Backend como proxy)
async function enrichMovies(req, res) {
    try {
        const { filenames } = req.body;

        if (!Array.isArray(filenames) || filenames.length === 0) {
            return res.status(400).json({ error: 'Se requiere un array de filenames' });
        }

        console.log(`🎬 Enriqueciendo ${filenames.length} películas desde backend...`);

        const results = [];

        // Procesar de forma secuencial para respetar rate limiting de TMDB
        for (const filename of filenames) {
            try {
                const metadata = await getMovieMetadata(filename);

                if (metadata) {
                    results.push({
                        filename,
                        success: true,
                        metadata: {
                            poster: metadata.poster_path,
                            backdrop: metadata.backdrop_path,
                            overview: metadata.overview,
                            rating: metadata.vote_average,
                            releaseDate: metadata.release_date,
                            title: metadata.title,
                            genreIds: metadata.genre_ids || [],
                            runtime: metadata.runtime,
                            videos: metadata.videos || [],
                            recommendations: metadata.recommendations || [],
                            cast: metadata.cast || []
                        }
                    });
                } else {
                    results.push({
                        filename,
                        success: false,
                        error: 'No se encontró en TMDB'
                    });
                }

                // Esperar 350ms entre peticiones para respetar rate limit
                await new Promise(resolve => setTimeout(resolve, 350));

            } catch (error) {
                console.error(`❌ Error procesando ${filename}:`, error.message);
                results.push({
                    filename,
                    success: false,
                    error: error.message
                });
            }
        }

        console.log(`✅ Enriquecimiento completado: ${results.filter(r => r.success).length}/${filenames.length} exitosos`);
        res.json({ success: true, results });

    } catch (error) {
        console.error('Error en enrich:', error);
        res.status(500).json({ error: 'Error al enriquecer películas' });
    }
}

// Alias para ambas rutas
app.post('/api/movies/enrich', enrichMovies);
app.post('/api/videos/enrich', enrichMovies);

// 2. Detectar pistas de audio de un archivo (soporta LOCAL y FTP)
app.get('/api/audio-tracks/:filename', async (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    console.log(`🔊 Detectando pistas de audio: ${filename} [${storageConfig.mode.toUpperCase()}]`);

    let fileToProbe = null;
    let tempFile = null;
    let client = null;

    try {
        // ========== MODO LOCAL ==========
        if (storageConfig.mode === 'local') {
            const localPath = path.join(storageConfig.localPath, filename);

            if (!fsSync.existsSync(localPath)) {
                return res.status(404).json({ error: 'Archivo no encontrado' });
            }

            fileToProbe = localPath; // Analizar directamente sin copiar

        // ========== MODO FTP ==========
        } else {
            client = new ftp.Client();
            tempFile = path.join(TEMP_DIR, `probe_${Date.now()}_${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`);

            await client.access({ ...FTP_CONFIG, secure: false, passive: true });

            const fileList = await client.list("/volume-1");
            const fileInfo = fileList.find(f => f.name === filename);

            if (!fileInfo) {
                client.close();
                return res.status(404).json({ error: 'Archivo no encontrado' });
            }

            // Descargar solo los primeros 50MB para analizar
            const { PassThrough } = require('stream');
            const writeStream = fsSync.createWriteStream(tempFile);
            const passThrough = new PassThrough();

            let bytesWritten = 0;
            const maxBytes = 50 * 1024 * 1024;

            passThrough.on('data', (chunk) => {
                if (bytesWritten < maxBytes) {
                    const remaining = maxBytes - bytesWritten;
                    const toWrite = chunk.slice(0, Math.min(chunk.length, remaining));
                    writeStream.write(toWrite);
                    bytesWritten += toWrite.length;
                    if (bytesWritten >= maxBytes) {
                        passThrough.destroy();
                        writeStream.end();
                    }
                }
            });

            passThrough.on('end', () => writeStream.end());
            passThrough.on('error', () => writeStream.end());

            await client.downloadTo(passThrough, `/volume-1/${filename}`).catch(() => {});
            client.close();
            client = null;

            await new Promise(resolve => writeStream.on('close', resolve));
            fileToProbe = tempFile;
        }

        // Usar ffprobe para obtener información de pistas
        const ffprobeResult = await new Promise((resolve, reject) => {
            ffmpeg.ffprobe(fileToProbe, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata);
            });
        });

        // Extraer pistas de audio
        const audioTracks = ffprobeResult.streams
            .filter(s => s.codec_type === 'audio')
            .map((track, index) => ({
                index: track.index,
                streamIndex: index,
                codec: track.codec_name,
                language: track.tags?.language || 'und',
                title: track.tags?.title || null,
                channels: track.channels,
                channelLayout: track.channel_layout || `${track.channels}ch`,
                bitrate: track.bit_rate ? Math.round(track.bit_rate / 1000) + ' kbps' : null,
                default: track.disposition?.default === 1,
                label: formatAudioLabel(track)
            }));

        // Limpiar archivo temporal (solo si es FTP)
        if (tempFile) {
            await fs.unlink(tempFile).catch(() => {});
        }

        console.log(`🔊 Encontradas ${audioTracks.length} pistas de audio`);
        res.json({ tracks: audioTracks, filename });

    } catch (error) {
        console.error('Error detectando pistas de audio:', error.message);
        if (tempFile) await fs.unlink(tempFile).catch(() => {});
        if (client) client.close();
        res.status(500).json({ error: 'Error al analizar el archivo' });
    }
});

// Función para formatear etiqueta de pista de audio
function formatAudioLabel(track) {
    const parts = [];

    // Idioma
    const langMap = {
        'spa': 'Español', 'es': 'Español', 'spanish': 'Español',
        'eng': 'English', 'en': 'English', 'english': 'English',
        'fra': 'Français', 'fr': 'Français', 'french': 'Français',
        'deu': 'Deutsch', 'de': 'Deutsch', 'german': 'Deutsch',
        'ita': 'Italiano', 'it': 'Italiano', 'italian': 'Italiano',
        'por': 'Português', 'pt': 'Português', 'portuguese': 'Português',
        'jpn': 'Japanese', 'ja': 'Japanese', 'japanese': 'Japanese',
        'und': 'Desconocido', 'unknown': 'Desconocido'
    };
    const lang = track.tags?.language?.toLowerCase() || 'und';
    parts.push(langMap[lang] || lang.toUpperCase());

    // Título si existe
    if (track.tags?.title) {
        parts.push(`(${track.tags.title})`);
    }

    // Canales
    if (track.channel_layout) {
        parts.push(`- ${track.channel_layout}`);
    } else if (track.channels) {
        parts.push(`- ${track.channels}ch`);
    }

    // Códec
    const codecMap = {
        'aac': 'AAC', 'ac3': 'AC3', 'eac3': 'E-AC3',
        'dts': 'DTS', 'truehd': 'TrueHD', 'flac': 'FLAC',
        'mp3': 'MP3', 'vorbis': 'Vorbis', 'opus': 'Opus'
    };
    const codec = codecMap[track.codec_name?.toLowerCase()] || track.codec_name?.toUpperCase();
    if (codec) parts.push(`[${codec}]`);

    return parts.join(' ');
}

// 3. Transmisión de vídeo (soporta LOCAL y FTP)
// Soporte para HEAD requests (el navegador lo usa para obtener metadatos)
app.head('/stream/:filename', async (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    console.log(`📋 HEAD request: ${filename} [${storageConfig.mode.toUpperCase()}]`);

    try {
        let fileSize = 0;

        // ========== MODO LOCAL ==========
        if (storageConfig.mode === 'local') {
            const localPath = path.join(storageConfig.localPath, filename);
            if (!fsSync.existsSync(localPath)) {
                return res.status(404).end();
            }
            const stats = fsSync.statSync(localPath);
            fileSize = stats.size;

        // ========== MODO FTP ==========
        } else {
            const client = new ftp.Client();
            client.ftp.verbose = false;

            try {
                await client.access({
                    ...FTP_CONFIG,
                    secure: false,
                    passive: true
                });

                const fileList = await client.list("/volume-1");
                const fileInfo = fileList.find(f => f.name === filename);

                if (!fileInfo) {
                    client.close();
                    return res.status(404).end();
                }
                fileSize = fileInfo.size;
            } finally {
                client.close();
            }
        }

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Accept-Ranges', 'bytes');
        res.status(200).end();
    } catch (err) {
        console.error('HEAD error:', err.message);
        res.status(500).end();
    }
});

app.get('/stream/:filename', async (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const ext = filename.split('.').pop().toLowerCase();
    const needsTranscode = ['mkv', 'avi'].includes(ext);
    const audioTrack = parseInt(req.query.audio) || 0;

    console.log(`🎬 Streaming: ${filename} [${storageConfig.mode.toUpperCase()}] (transcode: ${needsTranscode}, audio: ${audioTrack})`);

    // ========== MODO LOCAL ==========
    if (storageConfig.mode === 'local') {
        const localPath = path.join(storageConfig.localPath, filename);

        if (!fsSync.existsSync(localPath)) {
            return res.status(404).send('Video no encontrado');
        }

        const stat = fsSync.statSync(localPath);
        const fileSize = stat.size;
        console.log(`📁 Archivo local: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

        // Si necesita transcodificación (MKV, AVI)
        if (needsTranscode) {
            console.log(`🔄 Transcodificando archivo local a MP4 (pista audio: ${audioTrack})...`);

            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Transfer-Encoding', 'chunked');
            res.setHeader('Cache-Control', 'no-cache');

            const ffmpegProcess = ffmpeg(localPath)
                .inputFormat(ext === 'mkv' ? 'matroska' : 'avi')
                .outputOptions([
                    '-map', '0:v:0',
                    `-map`, `0:a:${audioTrack}`,
                    '-c:v libx264',
                    '-preset ultrafast',
                    '-crf 23',
                    '-c:a aac',
                    '-b:a 192k',
                    '-movflags frag_keyframe+empty_moov+faststart',
                    '-f mp4'
                ])
                .on('start', () => console.log('▶️ FFmpeg iniciado (local)'))
                .on('error', (err) => {
                    if (!err.message.includes('SIGKILL')) {
                        console.error('❌ FFmpeg error:', err.message);
                    }
                })
                .on('end', () => console.log('✅ Transcodificación completada'));

            ffmpegProcess.pipe(res, { end: true });

            res.on('close', () => {
                ffmpegProcess.kill('SIGKILL');
            });

            return;
        }

        // MP4/MOV local - si se solicita una pista de audio específica, usar FFmpeg
        if (audioTrack > 0) {
            console.log(`🔄 Remuxeando MP4 local con pista de audio ${audioTrack}...`);

            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Transfer-Encoding', 'chunked');
            res.setHeader('Cache-Control', 'no-cache');

            const ffmpegProcess = ffmpeg(localPath)
                .outputOptions([
                    '-map', '0:v:0',
                    `-map`, `0:a:${audioTrack}`,
                    '-c:v copy',  // Copiar video sin recodificar
                    '-c:a aac',   // Convertir audio a AAC para compatibilidad
                    '-b:a 192k',
                    '-movflags frag_keyframe+empty_moov+faststart',
                    '-f mp4'
                ])
                .on('start', () => console.log('▶️ FFmpeg remux iniciado (MP4 local)'))
                .on('error', (err) => {
                    if (!err.message.includes('SIGKILL')) {
                        console.error('❌ FFmpeg error:', err.message);
                    }
                })
                .on('end', () => console.log('✅ Remux completado'));

            ffmpegProcess.pipe(res, { end: true });

            res.on('close', () => {
                ffmpegProcess.kill('SIGKILL');
            });

            return;
        }

        // MP4/MOV local - streaming directo con Range requests (pista por defecto)
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const requestedEnd = parts[1] ? parseInt(parts[1], 10) : null;
            const end = requestedEnd !== null ? requestedEnd : Math.min(start + 5 * 1024 * 1024 - 1, fileSize - 1);
            const chunkSize = end - start + 1;

            console.log(`📦 Range local: bytes=${start}-${end}/${fileSize} (${(chunkSize / 1024 / 1024).toFixed(2)} MB)`);

            res.status(206);
            res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Content-Length', chunkSize);
            res.setHeader('Content-Type', 'video/mp4');

            const readStream = fsSync.createReadStream(localPath, { start, end });
            readStream.pipe(res);

            res.on('close', () => readStream.destroy());
        } else {
            console.log(`📥 Request local sin Range - enviando archivo completo`);

            res.status(200);
            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Content-Length', fileSize);
            res.setHeader('Accept-Ranges', 'bytes');

            const readStream = fsSync.createReadStream(localPath);
            readStream.pipe(res);

            res.on('close', () => readStream.destroy());
        }

        return;
    }

    // ========== MODO FTP (código original) ==========
    const client = new ftp.Client();
    client.ftp.timeout = 300000;
    client.ftp.verbose = false;

    try {
        await client.access({
            ...FTP_CONFIG,
            secure: false,
            passive: true
        });

        const fileList = await client.list("/volume-1");
        const fileInfo = fileList.find(f => f.name === filename);

        if (!fileInfo) {
            client.close();
            return res.status(404).send('Video no encontrado');
        }

        const fileSize = fileInfo.size;
        console.log(`📁 Archivo FTP: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

        // Si necesita transcodificación (MKV, AVI)
        if (needsTranscode) {
            console.log(`🔄 Transcodificando a MP4 (pista audio: ${audioTrack})...`);

            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Transfer-Encoding', 'chunked');
            res.setHeader('Cache-Control', 'no-cache');

            // Crear stream desde FTP
            const { Writable } = require('stream');
            const ftpStream = new (require('stream').PassThrough)();

            // FFmpeg transcodifica el stream con la pista de audio seleccionada
            const ffmpegProcess = ffmpeg(ftpStream)
                .inputFormat(ext === 'mkv' ? 'matroska' : 'avi')
                .outputOptions([
                    '-map', '0:v:0',           // Primera pista de video
                    `-map`, `0:a:${audioTrack}`, // Pista de audio seleccionada
                    '-c:v libx264',
                    '-preset ultrafast',
                    '-crf 23',
                    '-c:a aac',
                    '-b:a 192k',
                    '-movflags frag_keyframe+empty_moov+faststart',
                    '-f mp4'
                ])
                .on('start', () => console.log('▶️ FFmpeg iniciado'))
                .on('error', (err) => {
                    if (!err.message.includes('SIGKILL')) {
                        console.error('❌ FFmpeg error:', err.message);
                    }
                })
                .on('end', () => console.log('✅ Transcodificación completada'));

            ffmpegProcess.pipe(res, { end: true });

            // Descargar desde FTP al pipe de FFmpeg
            await client.downloadTo(ftpStream, `/volume-1/${filename}`);
            ftpStream.end();

            // Cleanup cuando el cliente cierra la conexión
            res.on('close', () => {
                ffmpegProcess.kill('SIGKILL');
                client.close();
            });

        } else if (audioTrack > 0) {
            // MP4/MOV FTP - remuxear con pista de audio específica
            console.log(`🔄 Remuxeando MP4 FTP con pista de audio ${audioTrack}...`);

            res.setHeader('Content-Type', 'video/mp4');
            res.setHeader('Transfer-Encoding', 'chunked');
            res.setHeader('Cache-Control', 'no-cache');

            const ftpStream = new (require('stream').PassThrough)();

            const ffmpegProcess = ffmpeg(ftpStream)
                .outputOptions([
                    '-map', '0:v:0',
                    `-map`, `0:a:${audioTrack}`,
                    '-c:v copy',  // Copiar video sin recodificar
                    '-c:a aac',
                    '-b:a 192k',
                    '-movflags frag_keyframe+empty_moov+faststart',
                    '-f mp4'
                ])
                .on('start', () => console.log('▶️ FFmpeg remux iniciado (MP4 FTP)'))
                .on('error', (err) => {
                    if (!err.message.includes('SIGKILL')) {
                        console.error('❌ FFmpeg error:', err.message);
                    }
                })
                .on('end', () => console.log('✅ Remux completado'));

            ffmpegProcess.pipe(res, { end: true });

            await client.downloadTo(ftpStream, `/volume-1/${filename}`);
            ftpStream.end();

            res.on('close', () => {
                ffmpegProcess.kill('SIGKILL');
                client.close();
            });

        } else {
            // MP4/MOV - streaming directo con Range requests (pista por defecto)
            const range = req.headers.range;

            if (range) {
                // Parsear Range header
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                // Si no hay end, enviar chunk de 5MB (o hasta el final)
                const requestedEnd = parts[1] ? parseInt(parts[1], 10) : null;
                const end = requestedEnd !== null ? requestedEnd : Math.min(start + 5 * 1024 * 1024 - 1, fileSize - 1);

                const chunkSize = end - start + 1;

                const isSeekRequest = start > 1024 * 1024; // Más de 1MB desde el inicio = seeking
                console.log(`📦 Range: bytes=${start}-${end}/${fileSize} (${(chunkSize / 1024 / 1024).toFixed(2)} MB) ${isSeekRequest ? '⏩ SEEK' : '▶️ START'}`);

                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Content-Length', chunkSize);
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Cache-Control', 'no-cache');
                res.setHeader('Connection', 'keep-alive');

                // Descargar usando offset nativo de FTP (comando REST)
                const { PassThrough } = require('stream');
                const passThrough = new PassThrough();

                let bytesReceived = 0;
                const bytesNeeded = chunkSize;
                let firstChunk = true;

                passThrough.on('data', (chunk) => {
                    if (firstChunk) {
                        console.log(`   ✓ Recibiendo datos (primer chunk: ${chunk.length} bytes)`);
                        firstChunk = false;
                    }
                    bytesReceived += chunk.length;

                    // Si recibimos más de lo necesario, recortar
                    if (bytesReceived > bytesNeeded) {
                        const excess = bytesReceived - bytesNeeded;
                        const trimmed = chunk.slice(0, chunk.length - excess);
                        if (trimmed.length > 0) {
                            res.write(trimmed);
                        }
                        console.log(`   ✓ Completado: ${bytesReceived} bytes recibidos, ${chunkSize} enviados`);
                        passThrough.destroy();
                        res.end();
                        client.close();
                    } else {
                        res.write(chunk);

                        // Si ya tenemos todo, terminar
                        if (bytesReceived >= bytesNeeded) {
                            console.log(`   ✓ Completado: ${bytesReceived} bytes`);
                            passThrough.destroy();
                            res.end();
                            client.close();
                        }
                    }
                });

                passThrough.on('end', () => {
                    if (!res.writableEnded) {
                        console.log(`   ⚠️ Stream terminó antes de completar (${bytesReceived}/${bytesNeeded})`);
                        res.end();
                    }
                    client.close();
                });

                passThrough.on('error', (err) => {
                    console.error(`   ❌ Stream error: ${err.message}`);
                    client.close();
                });

                res.on('close', () => {
                    passThrough.destroy();
                    client.close();
                });

                // Usar offset nativo de FTP - el tercer parámetro es startAt (byte offset)
                console.log(`   → FTP downloadTo con offset ${start}`);
                client.downloadTo(passThrough, `/volume-1/${filename}`, start).catch((err) => {
                    console.error(`   ❌ FTP error: ${err.message}`);
                    if (!res.headersSent) {
                        res.status(500).end();
                    }
                    client.close();
                });

            } else {
                // Sin Range - responder con 200 y headers para que el navegador sepa que puede usar Range
                console.log(`📥 Request sin Range - enviando headers completos`);

                res.status(200);
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Content-Length', fileSize);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.setHeader('Connection', 'keep-alive');

                // El navegador debería hacer peticiones Range después de recibir estos headers
                // Enviamos el archivo completo si el navegador no usa Range
                const { PassThrough } = require('stream');
                const passThrough = new PassThrough();

                passThrough.pipe(res);

                passThrough.on('error', () => client.close());
                res.on('close', () => {
                    passThrough.destroy();
                    client.close();
                });

                client.downloadTo(passThrough, `/volume-1/${filename}`).catch(() => client.close());
            }
        }

    } catch (err) {
        console.error('❌ Error streaming:', err.message);
        if (!res.headersSent) {
            res.status(500).send('Error al transmitir video');
        }
        client.close();
    }
});

// 3. Conversión de AVI/MKV a MP4
const conversionJobs = new Map(); // Almacena el estado de las conversiones
const TEMP_DIR = path.join(__dirname, 'temp_conversions');

// Asegurar que existe el directorio temporal
(async () => {
    try {
        await fs.mkdir(TEMP_DIR, { recursive: true });
    } catch (e) {}
})();

// Iniciar conversión
app.post('/api/convert', async (req, res) => {
    const { filename } = req.body;

    if (!filename) {
        return res.status(400).json({ error: 'Filename requerido' });
    }

    const ext = filename.split('.').pop().toLowerCase();
    if (!['avi', 'mkv'].includes(ext)) {
        return res.status(400).json({ error: 'Solo se pueden convertir archivos AVI o MKV' });
    }

    const jobId = Date.now().toString();
    const mp4Filename = filename.replace(/\.(avi|mkv)$/i, '.mp4');

    conversionJobs.set(jobId, {
        status: 'starting',
        progress: 0,
        filename,
        mp4Filename,
        message: 'Iniciando conversión...'
    });

    res.json({ jobId, mp4Filename });

    // Ejecutar conversión en background
    processConversion(jobId, filename, mp4Filename);
});

// Progreso de conversión (SSE)
app.get('/api/convert/:jobId/progress', (req, res) => {
    const { jobId } = req.params;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const sendProgress = () => {
        const job = conversionJobs.get(jobId);
        if (job) {
            res.write(`data: ${JSON.stringify(job)}\n\n`);

            if (job.status === 'completed' || job.status === 'error') {
                res.end();
                return false;
            }
        } else {
            res.write(`data: ${JSON.stringify({ status: 'not_found' })}\n\n`);
            res.end();
            return false;
        }
        return true;
    };

    sendProgress();
    const interval = setInterval(() => {
        if (!sendProgress()) {
            clearInterval(interval);
        }
    }, 1000);

    req.on('close', () => clearInterval(interval));
});

async function processConversion(jobId, filename, mp4Filename) {
    const job = conversionJobs.get(jobId);
    const localInput = path.join(TEMP_DIR, filename);
    const localOutput = path.join(TEMP_DIR, mp4Filename);
    const client = new ftp.Client();

    try {
        // Paso 1: Descargar archivo original
        job.status = 'downloading';
        job.message = 'Descargando archivo del servidor...';
        job.progress = 5;

        await client.access({ ...FTP_CONFIG, secure: false, passive: true });

        // Obtener tamaño para calcular progreso de descarga
        const fileList = await client.list("/volume-1");
        const fileInfo = fileList.find(f => f.name === filename);
        const totalSize = fileInfo ? fileInfo.size : 0;

        // Descargar con progreso
        client.trackProgress(info => {
            if (totalSize > 0) {
                const dlProgress = Math.round((info.bytes / totalSize) * 30); // 0-30%
                job.progress = 5 + dlProgress;
                job.message = `Descargando: ${(info.bytes / 1024 / 1024).toFixed(0)} MB / ${(totalSize / 1024 / 1024).toFixed(0)} MB`;
            }
        });

        await client.downloadTo(localInput, `/volume-1/${filename}`);
        client.trackProgress(); // Desactivar tracking

        console.log(`📥 Descargado: ${filename}`);

        // Paso 2: Convertir con FFmpeg
        job.status = 'converting';
        job.message = 'Convirtiendo a MP4...';
        job.progress = 35;

        await new Promise((resolve, reject) => {
            ffmpeg(localInput)
                .outputOptions([
                    '-c:v libx264',
                    '-preset medium',
                    '-crf 22',
                    '-c:a aac',
                    '-b:a 192k',
                    '-movflags +faststart'
                ])
                .on('progress', (progress) => {
                    const convertProgress = Math.round((progress.percent || 0) * 0.4); // 35-75%
                    job.progress = 35 + convertProgress;
                    job.message = `Convirtiendo: ${Math.round(progress.percent || 0)}%`;
                })
                .on('end', () => {
                    console.log(`✅ Convertido: ${mp4Filename}`);
                    resolve();
                })
                .on('error', (err) => {
                    console.error(`❌ Error FFmpeg: ${err.message}`);
                    reject(err);
                })
                .save(localOutput);
        });

        // Paso 3: Subir MP4 al servidor
        job.status = 'uploading';
        job.message = 'Subiendo MP4 al servidor...';
        job.progress = 75;

        const outputStats = await fs.stat(localOutput);
        const outputSize = outputStats.size;

        client.trackProgress(info => {
            const ulProgress = Math.round((info.bytes / outputSize) * 15); // 75-90%
            job.progress = 75 + ulProgress;
            job.message = `Subiendo: ${(info.bytes / 1024 / 1024).toFixed(0)} MB / ${(outputSize / 1024 / 1024).toFixed(0)} MB`;
        });

        await client.uploadFrom(localOutput, `/volume-1/${mp4Filename}`);
        client.trackProgress();

        console.log(`📤 Subido: ${mp4Filename}`);

        // Paso 4: Borrar archivo original del servidor
        job.status = 'deleting';
        job.message = 'Eliminando archivo original...';
        job.progress = 92;

        await client.remove(`/volume-1/${filename}`);
        console.log(`🗑️ Eliminado original: ${filename}`);

        // Paso 5: Actualizar caché
        job.message = 'Actualizando caché...';
        job.progress = 95;

        const cache = await readCache();
        if (cache[filename]) {
            cache[mp4Filename] = { ...cache[filename] };
            delete cache[filename];
            await writeCache(cache);
        }

        // Actualizar colecciones
        const collections = await readCollections();
        let collectionsUpdated = false;
        for (const collectionId in collections) {
            const collection = collections[collectionId];
            const movieIndex = collection.movies.findIndex(m => m.filename === filename);
            if (movieIndex !== -1) {
                collection.movies[movieIndex].filename = mp4Filename;
                collectionsUpdated = true;
            }
        }
        if (collectionsUpdated) {
            await writeCollections(collections);
        }

        // Limpiar archivos temporales
        await fs.unlink(localInput).catch(() => {});
        await fs.unlink(localOutput).catch(() => {});

        job.status = 'completed';
        job.message = 'Conversión completada';
        job.progress = 100;

        console.log(`✅ Conversión completada: ${filename} → ${mp4Filename}`);

    } catch (error) {
        console.error(`❌ Error en conversión: ${error.message}`);
        job.status = 'error';
        job.message = `Error: ${error.message}`;

        // Limpiar archivos temporales en caso de error
        await fs.unlink(localInput).catch(() => {});
        await fs.unlink(localOutput).catch(() => {});
    } finally {
        client.close();

        // Eliminar job después de 5 minutos
        setTimeout(() => {
            conversionJobs.delete(jobId);
        }, 5 * 60 * 1000);
    }
}

// 4. Endpoint para actualizar/limpiar caché de metadatos
app.post('/api/sync-metadata', async (req, res) => {
    try {
        console.log('🔄 Limpiando todo el caché de TMDB...');
        const cache = {};
        await writeCache(cache);
        res.json({ success: true, message: 'Caché limpiado. Los metadatos se volverán a buscar en la próxima carga.' });
    } catch (error) {
        console.error('Error al limpiar caché:', error);
        res.status(500).json({ error: 'Error al limpiar caché' });
    }
});

// 4. Endpoint para actualizar una película específica
app.delete('/api/cache/:filename', async (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const cache = await readCache();

        if (cache[filename]) {
            delete cache[filename];
            await writeCache(cache);
            console.log(`🗑️ Eliminado del caché: ${filename}`);
            res.json({ success: true, message: `Caché de "${filename}" eliminado. Se buscará de nuevo en TMDB.` });
        } else {
            res.json({ success: false, message: `"${filename}" no está en caché.` });
        }
    } catch (error) {
        console.error('Error al eliminar del caché:', error);
        res.status(500).json({ error: 'Error al eliminar del caché' });
    }
});

// 5. Endpoint para renombrar archivo y actualizar metadatos
app.put('/api/rename', async (req, res) => {
    console.log('🎯 Petición PUT /api/rename recibida');
    console.log('📦 Body:', req.body);

    const { oldName, newName } = req.body;

    if (!oldName || !newName) {
        console.log('❌ Faltan parámetros');
        return res.status(400).json({ error: 'Se requieren oldName y newName' });
    }

    const client = new ftp.Client();
    try {
        console.log(`📝 Renombrando: "${oldName}" → "${newName}"`);

        // Conectar al FTP en modo pasivo
        await client.access({
            ...FTP_CONFIG,
            secure: false,
            passive: true
        });

        // Renombrar archivo en el FTP
        await client.rename(`/volume-1/${oldName}`, `/volume-1/${newName}`);
        console.log('✓ Archivo renombrado en el FTP');

        // Limpiar caché de la entrada antigua
        const cache = await readCache();
        if (cache[oldName]) {
            delete cache[oldName];
            await writeCache(cache);
            console.log('✓ Caché antiguo eliminado');
        }

        // Buscar nuevos metadatos en TMDB
        const metadata = await getMovieMetadata(newName);
        console.log('✓ Nuevos metadatos obtenidos de TMDB');

        // Devolver información actualizada
        const updatedVideo = {
            filename: newName,
            title: metadata?.title || newName.replace(/\.(mp4|mkv|avi|mov)$/i, ''),
            url: `http://localhost:${PORT}/stream/${encodeURIComponent(newName)}`,
            poster: metadata?.poster_path || null,
            backdrop: metadata?.backdrop_path || null,
            overview: metadata?.overview || null,
            releaseDate: metadata?.release_date || null,
            rating: metadata?.vote_average || null
        };

        res.json({
            success: true,
            message: `Archivo renombrado y metadatos actualizados`,
            video: updatedVideo
        });

    } catch (error) {
        console.error('❌ Error al renombrar:', error.message);
        res.status(500).json({ error: `Error al renombrar: ${error.message}` });
    } finally {
        client.close();
    }
});

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

const PORT = process.env.PORT || 3002;
// Sin HOST específico - Node escucha en todas las interfaces

// Manejar errores no capturados para evitar que el proceso termine
process.on('uncaughtException', (err) => {
    console.error('❌ Error no capturado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promesa rechazada no manejada:', reason);
});

const server = app.listen(PORT, () => {
    console.log(`🚀 Servidor Hermes activo en puerto ${PORT}`);
    console.log(`📍 Escuchando en http://localhost:${PORT}`);
    console.log('⏳ Servidor en ejecución... (presiona Ctrl+C para detener)');
});

server.on('error', (err) => {
    console.error('❌ Error del servidor:', err);
});