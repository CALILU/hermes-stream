# Arquitectura Tecnica: Migracion de IsiPrime a LincStation N2

## 1. Diagrama de Componentes

```
                                INTERNET
                                   |
                            +------+------+
                            |   ROUTER    |
                            | Port 443    |
                            | (NAT/DDNS) |
                            +------+------+
                                   |
                            +------+------+
                            |   nginx     |
                            | HTTPS/TLS   |
                            | Let's Enc.  |
                            | :443 -> :8080
                            | Static files|
                            | Rate limit  |
                            | Gzip        |
                            +------+------+
                                   |
                    +--------------+--------------+
                    |              |              |
              +-----+----+  +-----+----+  +-----+----+
              | Node.js  |  | Node.js  |  | Node.js  |  ... x4
              | Worker 0 |  | Worker 1 |  | Worker 2 |  (PM2 cluster)
              | :8080    |  | :8080    |  | :8080    |
              +-----+----+  +-----+----+  +-----+----+
                    |              |              |
         +----------+--------------+--------------+---------+
         |          |              |              |         |
    +----+----+ +---+---+  +------+------+  +----+----+ +--+--+
    | SQLite  | | TMDB  |  |   FFmpeg    |  | my-ui/  | | SSE |
    | WAL     | | API   |  | VAAPI/QSV   |  | build/  | |     |
    | mode    | | (ext) |  | transcode   |  | static  | |     |
    +---------+ +-------+  +------+------+  +---------+ +-----+
         |                        |
    +----+----+            +------+------+
    | NVMe    |            | SATA Disks  |
    | /var/lib|            | /media/     |
    | isiprime|            | movies/     |
    | /*.db   |            | series/     |
    +---------+            +-------------+

    +------------------------------------------------------------------+
    |                    LincStation N2 NAS                             |
    |  Intel N100 (4C/4T) | 16GB DDR5 | 128GB eMMC | NVMe + 2x SATA  |
    |  Debian 12 Bookworm | 10GbE LAN                                 |
    +------------------------------------------------------------------+
```

**Flujo de una peticion de streaming:**

```
Usuario (navegador)
  |
  | HTTPS GET /stream/Pelicula.mp4
  |
  v
nginx (:443)
  |-- Termina SSL
  |-- Verifica rate limit
  |-- proxy_pass http://127.0.0.1:8080
  v
PM2 -> Node.js Worker (Express)
  |-- authMiddleware: verifica sesion JWT
  |-- storageConfig.mode === 'local'
  |-- fs.stat('/media/movies/Pelicula.mp4')
  |
  |-- Si MP4: fs.createReadStream() con Range headers
  |-- Si MKV: directo con mime video/x-matroska
  |-- Si AVI: FFmpeg transcode on-the-fly (VAAPI/QSV)
  |
  v
Respuesta HTTP 206 Partial Content -> navegador
```

---

## 2. Sistema Operativo: Debian 12 Bookworm

### Por que Debian 12

Debian 12 (Bookworm) es la eleccion optima para ejecutar IsiPrime en el N2. Se descartaron las alternativas mas comunes para NAS:

| Alternativa | Por que se descarta |
|-------------|---------------------|
| **TrueNAS SCALE** | Overkill para este caso de uso. Pensado para almacenamiento empresarial con ZFS, que necesita ECC RAM para funcionar de forma fiable. Consume ~4GB solo de base. La capa Kubernetes/Docker agrega complejidad innecesaria. No tenemos pools redundantes ni datasets ZFS -- solo queremos servir archivos. |
| **OpenMediaVault** | Basado en Debian pero agrega una capa de administracion web que no necesitamos. Limita la flexibilidad: las configuraciones hechas por CLI pueden entrar en conflicto con la interfaz web. Para IsiPrime solo necesitamos nginx + Node.js, no un panel de control de NAS. |
| **Ubuntu Server** | Mas pesado que Debian (snap, motd, paquetes extra). Ciclo de soporte LTS de 5 anios vs 5+ anios de Debian. Canonical prioriza snap para paquetes como Node.js, complicando las instalaciones. Debian es la base de Ubuntu -- mejor ir a la fuente. |

### Ventajas de Debian 12 para este proyecto

- **Ligero**: instalacion minima ~1.5GB, sin GUI ni servicios innecesarios
- **Soporte hardware N100**: kernel 6.1 LTS incluye drivers Intel i915 para Quick Sync, controladores de red para 10GbE, soporte completo para NVMe y SATA
- **Repositorios**: `ffmpeg`, `nginx`, `sqlite3`, `certbot` disponibles directamente en repos oficiales
- **Estabilidad**: paquetes probados exhaustivamente, actualizaciones de seguridad por 5+ anios
- **systemd**: gestion nativa de servicios, timers para tareas periodicas, journald para logs
- **Familiar**: mismo ecosistema `apt` que usamos en desarrollo, mismos paths, misma logica

### Instalacion base

```bash
# Paquetes esenciales post-instalacion
apt update && apt install -y \
    nginx \
    certbot python3-certbot-nginx \
    ffmpeg \
    sqlite3 \
    curl \
    git \
    htop \
    ufw

# Node.js 20 LTS via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# PM2 global
npm install -g pm2

# Verificar VAAPI (aceleracion Intel)
ls /dev/dri/renderD128  # Debe existir
vainfo                  # Debe listar H.264/HEVC encode/decode
```

---

## 3. Arquitectura Backend

### Reutilizacion del codigo existente

La base de codigo actual de IsiPrime se reutiliza casi en su totalidad. El backend mantiene la misma estructura modular:

```
/opt/isiprime/
  server.js              # Express principal (puerto 8080)
  routes/
    videos.js            # Listado peliculas, enriquecimiento TMDB
    streaming.js         # Streaming con range requests + transcode
    series.js            # Series TV, episodios, progreso
    requests.js          # Peticiones de usuarios (CRUD + SSE)
    tmdb.js              # Busqueda TMDB, cast, filmografia
    collections.js       # Colecciones de peliculas
    downloads.js         # Cola de descargas
    conversion.js        # Conversion de video con progreso SSE
    storage.js           # Configuracion de almacenamiento
    movies.js            # Actualizacion posters, gestion archivos
    misc.js              # Endpoints utilidad
    dlna.js              # Casting DLNA
  lib/
    tmdb.js              # Cliente TMDB con rate limiting
    cache.js             # Gestion cache peliculas  -> MIGRA A SQLITE
    series.js            # Escaneo series, parseo S01E01
    normalizers.js       # Conversion formato cache -> API
    utils.js             # Normalizacion titulos, regex, constantes
    collections.js       # CRUD colecciones        -> MIGRA A SQLITE
    requests-helpers.js  # Operaciones peticiones
    download-helpers.js  # Cola descargas           -> MIGRA A SQLITE
    local-storage.js     # NUEVO: wrappers fs para lectura directa
  db/
    requests-db.js       # SQLite con better-sqlite3 (ya existe)
    media-db.js          # NUEVO: cache, series, colecciones en SQLite
    users-db.js          # NUEVO: usuarios + sesiones en SQLite
  my-ui/
    build/               # Frontend React compilado
```

### Cambio principal: eliminacion de FTP

El cambio mas significativo es eliminar toda la capa FTP. Actualmente, `lib/ftp-helper.js` proporciona `createFTPClient()` y `withFTPClient()` que conectan al NAS Synology via `basic-ftp`. En el N2, los archivos estan en disco local.

**Antes (FTP):**
```javascript
// lib/ftp-helper.js - ELIMINADO
const files = await withFTPClient(FTP_CONFIG, async (client) => {
    return await client.list('/volume-1/Peliculas');
});
```

**Despues (disco local):**
```javascript
// lib/local-storage.js - NUEVO
const fs = require('fs').promises;
const path = require('path');

function createLocalStorage(basePath) {
    async function listFiles(subdir) {
        const fullPath = path.join(basePath, subdir);
        const entries = await fs.readdir(fullPath, { withFileTypes: true });
        return entries.map(e => ({
            name: e.name,
            isDirectory: e.isDirectory(),
            size: e.isFile() ? fs.stat(path.join(fullPath, e.name)).then(s => s.size) : 0
        }));
    }

    function createReadStream(filePath, options) {
        const fsSync = require('fs');
        return fsSync.createReadStream(path.join(basePath, filePath), options);
    }

    async function getFileSize(filePath) {
        const stat = await fs.stat(path.join(basePath, filePath));
        return stat.size;
    }

    async function fileExists(filePath) {
        try {
            await fs.access(path.join(basePath, filePath));
            return true;
        } catch {
            return false;
        }
    }

    return { listFiles, createReadStream, getFileSize, fileExists };
}

module.exports = { createLocalStorage };
```

### Simplificacion de storage-settings.json

```json
{
    "mode": "local",
    "localPath": "/media",
    "moviesDir": "movies",
    "seriesDir": "series"
}
```

Ya no se necesitan `ftpPath`, `nasTotalSize`, ni credenciales FTP. La deteccion de modo `ftp`/`local` desaparece -- siempre es local.

### Dependencias: que cambia en package.json

```diff
  "dependencies": {
    "axios": "^1.13.2",
-   "basic-ftp": "^5.1.0",
+   "bcrypt": "^5.1.1",
    "better-sqlite3": "^12.6.2",
    "cors": "^2.8.5",
    "dotenv": "^17.2.3",
    "express": "^5.2.1",
    "fluent-ffmpeg": "^2.1.3",
+   "jsonwebtoken": "^9.0.2",
-   "node-ssdp": "^4.0.1",
-   "upnp-mediarenderer-client": "^1.4.0"
  }
```

Se elimina `basic-ftp` (ya no hay FTP), `node-ssdp` y `upnp-mediarenderer-client` (DLNA no aplica en NAS remoto). Se agrega `bcrypt` (hashing seguro) y `jsonwebtoken` (sesiones persistentes).

---

## 4. Migracion de Base de Datos: JSON -> SQLite

### Estado actual

IsiPrime usa 6 archivos JSON como almacenamiento y 1 base de datos SQLite:

| Archivo | Tamanio aprox. | Problema con multiples usuarios |
|---------|---------------|--------------------------------|
| `cache.json` | ~500KB | Lecturas/escrituras concurrentes corrompen datos |
| `cache-series.json` | ~100KB | Mismo problema |
| `series-episodes.json` | ~200KB | Mismo problema |
| `collections.json` | ~50KB | Mismo problema |
| `download-queue.json` | ~10KB | Mismo problema |
| `users.json` | ~1KB | Contrasenas SHA256, sin roles granulares |
| `requests.db` (SQLite) | ~50KB | Ya funciona bien con WAL mode |

Con 5-10 usuarios concurrentes, los archivos JSON se corrompen. Un usuario leyendo mientras otro escribe produce JSON truncado o datos perdidos. SQLite con WAL mode soporta multiples lectores simultaneos y un escritor sin conflictos.

### Plan de migracion

| Archivo JSON | Tabla(s) SQLite | Justificacion |
|-------------|----------------|---------------|
| `cache.json` | `movies_cache` | Lecturas concurrentes de multiples usuarios navegando |
| `cache-series.json` | `series_cache` | Mismo caso |
| `series-episodes.json` | `series_episodes` | Consultas por serie + temporada + episodio |
| `collections.json` | `collections` + `collection_items` | Relaciones N:M, consultas por genero/anio |
| `download-queue.json` | `download_queue` | Unificar con requests.db existente |
| `users.json` | `users` | Multi-usuario con bcrypt, roles, auditoria |

**Tablas nuevas adicionales:**

| Tabla | Proposito |
|-------|-----------|
| `sessions` | Sesiones persistentes (reemplaza Map() en RAM) |
| `user_progress` | Progreso de visualizacion por usuario por video |
| `user_favorites` | Favoritos por usuario |

### Schema SQL

```sql
-- =============================================
-- Base de datos principal: isiprime.db
-- Motor: SQLite 3.x con WAL mode
-- =============================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ----- USUARIOS Y SESIONES -----

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,          -- bcrypt, NO sha256
    role TEXT NOT NULL DEFAULT 'user'
        CHECK(role IN ('admin', 'viewer')),
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
);

CREATE TABLE sessions (
    token TEXT PRIMARY KEY,               -- JWT o random hex
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ----- CACHE DE PELICULAS -----

CREATE TABLE movies_cache (
    filename TEXT PRIMARY KEY,            -- nombre del archivo (clave unica)
    tmdb_id INTEGER,
    title TEXT,
    original_title TEXT,
    year INTEGER,
    overview TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    vote_average REAL,
    genres TEXT,                           -- JSON array: ["Accion","Drama"]
    runtime INTEGER,
    director TEXT,
    cast_json TEXT,                        -- JSON array con top cast
    tmdb_raw TEXT,                         -- JSON completo de TMDB (backup)
    cached_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT                        -- TTL de cache
);

CREATE INDEX idx_movies_tmdb ON movies_cache(tmdb_id);
CREATE INDEX idx_movies_year ON movies_cache(year);

-- ----- CACHE DE SERIES -----

CREATE TABLE series_cache (
    folder_name TEXT PRIMARY KEY,         -- nombre carpeta serie
    tmdb_id INTEGER,
    title TEXT,
    original_title TEXT,
    overview TEXT,
    poster_path TEXT,
    backdrop_path TEXT,
    vote_average REAL,
    genres TEXT,                           -- JSON array
    first_air_date TEXT,
    total_seasons INTEGER,
    cached_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE series_episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    series_folder TEXT NOT NULL REFERENCES series_cache(folder_name) ON DELETE CASCADE,
    season INTEGER NOT NULL,
    episode INTEGER NOT NULL,
    filename TEXT NOT NULL,
    title TEXT,
    overview TEXT,
    still_path TEXT,
    UNIQUE(series_folder, season, episode)
);

CREATE INDEX idx_episodes_series ON series_episodes(series_folder);
CREATE INDEX idx_episodes_season ON series_episodes(series_folder, season);

-- ----- COLECCIONES -----

CREATE TABLE collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL DEFAULT 'manual'
        CHECK(type IN ('manual', 'genre', 'year', 'decade', 'auto')),
    poster_path TEXT,
    auto_criteria TEXT,                   -- JSON: criterios para colecciones auto
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE collection_items (
    collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,               -- referencia a movies_cache.filename
    position INTEGER DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (collection_id, filename)
);

CREATE INDEX idx_collection_items_file ON collection_items(filename);

-- ----- COLA DE DESCARGAS -----

CREATE TABLE download_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL,
    filename TEXT,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK(status IN ('pending', 'downloading', 'completed', 'failed', 'cancelled')),
    progress REAL DEFAULT 0,
    error_message TEXT,
    added_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ----- PROGRESO DE USUARIO -----

CREATE TABLE user_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'episode')),
    media_key TEXT NOT NULL,              -- filename (pelicula) o series/S01E01 (episodio)
    current_time REAL NOT NULL DEFAULT 0, -- segundos
    duration REAL,                        -- duracion total
    completed INTEGER DEFAULT 0,          -- 1 si vio >90%
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, media_type, media_key)
);

CREATE TABLE user_favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'series')),
    media_key TEXT NOT NULL,              -- filename o folder_name
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, media_type, media_key)
);

-- ----- PETICIONES (ya existe, se conserva) -----
-- La tabla 'requests' actual se mantiene tal cual.
-- Solo se agrega al mismo archivo .db para unificar.
```

### Script de migracion

Cada archivo JSON se migra con un script Node.js que lee el JSON y lo inserta en SQLite:

```javascript
// scripts/migrate-json-to-sqlite.js
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = '/var/lib/isiprime/isiprime.db';
const DATA_DIR = '/opt/isiprime';

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Migrar cache.json -> movies_cache
function migrateMoviesCache() {
    const cache = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'cache.json'), 'utf8'));
    const insert = db.prepare(`
        INSERT OR REPLACE INTO movies_cache
        (filename, tmdb_id, title, original_title, year, overview, poster_path,
         backdrop_path, vote_average, genres, runtime, director, cast_json, tmdb_raw, cached_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const tx = db.transaction(() => {
        for (const [filename, data] of Object.entries(cache)) {
            insert.run(
                filename,
                data.id || data.tmdb_id || null,
                data.title || null,
                data.original_title || null,
                data.release_date ? parseInt(data.release_date) : null,
                data.overview || null,
                data.poster_path || null,
                data.backdrop_path || null,
                data.vote_average || null,
                JSON.stringify(data.genres || []),
                data.runtime || null,
                data.director || null,
                JSON.stringify(data.cast || []),
                JSON.stringify(data),
                null
            );
        }
    });

    tx();
    console.log(`Migradas ${Object.keys(cache).length} peliculas al cache SQLite`);
}

// Ejecutar migraciones
migrateMoviesCache();
// migrateSeries();
// migrateCollections();
// ... etc

db.close();
```

---

## 5. Reverse Proxy: nginx

### Funciones de nginx en esta arquitectura

1. **Terminacion SSL**: certificados Let's Encrypt via certbot
2. **Servir estaticos**: `my-ui/build/` directamente (mas rapido que Node.js)
3. **Proxy reverso**: reenvio a Node.js en puerto 8080
4. **Proxy SSE/WebSocket**: conexiones long-lived para actualizaciones en tiempo real
5. **Rate limiting**: proteccion contra fuerza bruta en login y abuso de API
6. **Compresion gzip**: reduccion de trafico en respuestas JSON y HTML

### Configuracion nginx

```nginx
# /etc/nginx/sites-available/isiprime

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;

# Upstream: PM2 cluster
upstream isiprime_backend {
    server 127.0.0.1:8080;
    keepalive 64;
}

server {
    listen 80;
    server_name tu-dominio.mooo.com;

    # Redirigir todo HTTP -> HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tu-dominio.mooo.com;

    # --- SSL (Let's Encrypt) ---
    ssl_certificate /etc/letsencrypt/live/tu-dominio.mooo.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/tu-dominio.mooo.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # --- Archivos estaticos (frontend React) ---
    root /opt/isiprime/my-ui/build;

    location / {
        try_files $uri $uri/ /index.html;

        # Cache agresivo para assets con hash en nombre
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
            expires 30d;
            add_header Cache-Control "public, immutable";
        }
    }

    # --- API proxy a Node.js ---
    location /api/ {
        limit_req zone=api burst=50 nodelay;

        proxy_pass http://isiprime_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        # Timeouts generosos para operaciones largas
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # --- Login con rate limiting estricto ---
    location /api/login {
        limit_req zone=login burst=3 nodelay;

        proxy_pass http://isiprime_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # --- Streaming de video ---
    location /stream/ {
        proxy_pass http://isiprime_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Range $http_range;
        proxy_set_header If-Range $http_if_range;

        # Sin buffering para streaming
        proxy_buffering off;
        proxy_request_buffering off;

        # Timeout largo para streams
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;

        # Tamanio maximo de archivo (peliculas grandes)
        client_max_body_size 0;
    }

    # --- SSE (Server-Sent Events) ---
    location ~* /api/(requests-stream|convert/.*/progress) {
        proxy_pass http://isiprime_backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Connection "";

        # Critico para SSE: sin buffering
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;

        # Mantener conexion abierta
        proxy_read_timeout 86400s;
    }

    # --- Compresion gzip ---
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/xml
        image/svg+xml;
}
```

### Configuracion SSL con certbot

```bash
# Instalar y configurar certificado
certbot --nginx -d tu-dominio.mooo.com

# Renovacion automatica (certbot instala un timer systemd)
systemctl status certbot.timer

# Verificar renovacion
certbot renew --dry-run
```

---

## 6. Gestion de Procesos: PM2

### Por que PM2

- **Cluster mode**: aprovecha los 4 cores del N100 ejecutando 4 instancias de Node.js
- **Auto-restart**: si un worker muere, PM2 lo reinicia automaticamente
- **Zero-downtime reload**: `pm2 reload` reinicia workers uno a uno sin interrumpir servicio
- **Startup**: se integra con systemd para arrancar con el sistema
- **Logs**: rotacion automatica, consolidacion de logs de todos los workers

### ecosystem.config.js

```javascript
// /opt/isiprime/ecosystem.config.js

module.exports = {
    apps: [{
        name: 'isiprime',
        script: 'server.js',
        cwd: '/opt/isiprime',

        // Cluster mode: 4 instancias (1 por core del N100)
        instances: 4,
        exec_mode: 'cluster',

        // Auto-restart
        autorestart: true,
        watch: false,
        max_restarts: 10,
        min_uptime: '10s',
        restart_delay: 1000,

        // Memoria maxima por worker (restart si excede)
        max_memory_restart: '512M',

        // Variables de entorno
        env: {
            NODE_ENV: 'production',
            PORT: 8080,

            // Rutas
            MEDIA_PATH: '/media',
            DB_PATH: '/var/lib/isiprime/isiprime.db',
            TEMP_DIR: '/tmp/transcode',

            // TMDB
            TMDB_API_KEY: 'tu-api-key-aqui',

            // JWT
            JWT_SECRET: 'generar-con-openssl-rand-hex-64',
            JWT_EXPIRY: '7d',

            // FFmpeg
            FFMPEG_HW_ACCEL: 'vaapi',
            VAAPI_DEVICE: '/dev/dri/renderD128'
        },

        // Logs
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        error_file: '/var/log/isiprime/error.log',
        out_file: '/var/log/isiprime/access.log',
        merge_logs: true,

        // Rotacion de logs
        log_type: 'json',

        // Graceful shutdown
        kill_timeout: 5000,
        listen_timeout: 10000,

        // Cluster especifico
        instance_var: 'INSTANCE_ID'
    }]
};
```

### Comandos PM2

```bash
# Iniciar aplicacion
pm2 start ecosystem.config.js

# Ver estado
pm2 status

# Ver logs en tiempo real
pm2 logs isiprime

# Reload sin downtime (despliegues)
pm2 reload isiprime

# Restart completo
pm2 restart isiprime

# Configurar arranque con el sistema
pm2 startup systemd
pm2 save

# Monitoreo
pm2 monit

# Rotacion de logs (instalar modulo)
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

### Nota sobre SQLite y cluster mode

SQLite con WAL mode soporta multiples lectores concurrentes (los 4 workers de PM2 pueden leer simultaneamente). Las escrituras son serializadas pero son tan rapidas (<1ms para operaciones tipicas) que no suponen un cuello de botella con 5-10 usuarios. `better-sqlite3` es sincronico por diseno, lo que simplifica el manejo de concurrencia.

---

## 7. Layout de Almacenamiento

```
NVMe (rapido, baja latencia):
  /                           -- Debian 12 OS (~3GB)
  /opt/isiprime/              -- Codigo de la aplicacion (~50MB)
  /opt/isiprime/my-ui/build/  -- Frontend compilado (~5MB)
  /var/lib/isiprime/          -- Bases de datos SQLite
    isiprime.db               -- Cache, usuarios, colecciones, descargas
    requests.db               -- Peticiones (si se mantiene separada)
  /var/log/isiprime/          -- Logs PM2
  /tmp/transcode/             -- Archivos temporales FFmpeg

SATA Bay 1 (disco grande, bulk storage):
  /media/movies/              -- Peliculas (archivos .mp4, .mkv, .avi)

SATA Bay 2 (disco grande, bulk storage):
  /media/series/              -- Series TV (estructura: Serie/S01E01.mp4)

```

> **Nota:** El N2 solo tiene 2 bahias SATA de 2.5". Si se necesita mas almacenamiento, considerar NVMe de alta capacidad o almacenamiento externo USB.

### Montaje y permisos

```bash
# /etc/fstab (ejemplo con discos SATA)
/dev/sda1  /media/movies  ext4  defaults,noatime  0  2
/dev/sdb1  /media/series  ext4  defaults,noatime  0  2

# Permisos
chown -R isiprime:isiprime /opt/isiprime
chown -R isiprime:isiprime /var/lib/isiprime
chown -R isiprime:isiprime /var/log/isiprime
chmod 755 /media/movies /media/series

# Usuario dedicado (sin shell, sin login)
useradd --system --home /opt/isiprime --shell /usr/sbin/nologin isiprime
usermod -aG video isiprime   # Acceso a /dev/dri para VAAPI
usermod -aG render isiprime  # Idem, necesario en Debian 12
```

### Directorio temporal de transcodificacion

```bash
# Crear con tmpfs (en RAM, mas rapido, se borra al reiniciar)
echo "tmpfs /tmp/transcode tmpfs defaults,size=2G,mode=1777 0 0" >> /etc/fstab
mount /tmp/transcode

# O en NVMe si se necesitan archivos grandes
mkdir -p /tmp/transcode
```

---

## 8. Mapa de Utilizacion de Hardware

| Componente | Uso actual (Windows PC) | Uso en NAS (LincStation N2) |
|-----------|------------------------|----------------------------|
| **CPU: Intel N100** (4C/4T, 3.4GHz boost) | -- | Node.js (4 workers PM2) + FFmpeg transcode (Quick Sync VAAPI) + nginx |
| **RAM: 16GB DDR5** | -- | ~2GB Node.js (4 workers x 512MB max) + ~1GB/stream FFmpeg + ~200MB nginx + ~500MB OS + ~200MB SQLite cache = **~4GB uso tipico** |
| **128GB eMMC** | -- | Boot de emergencia / recovery (Debian se instala en NVMe) |
| **NVMe** (a instalar) | -- | SO Debian (~3GB) + App (~50MB) + DBs SQLite + cache transcode |
| **SATA Bay 1** | -- | Peliculas (.mp4, .mkv) |
| **SATA Bay 2** | -- | Series TV |
| **10GbE RJ45** | -- | Solo para transferencias LAN (copiar peliculas desde PC). Los usuarios remotos acceden via router 1Gbps |
| **2.5GbE RJ45** | -- | Conexion principal al router / internet |

### Estimacion de capacidad concurrente

```
Streaming directo MP4 (sin transcode):
  - CPU: <1% por stream
  - RAM: ~50MB buffer por stream
  - Limite: ancho de banda de subida del ISP (~20 streams a 10Mbps = 200Mbps)

Streaming con transcode (AVI/MKV -> MP4):
  - CPU: ~25% por stream con VAAPI (Quick Sync)
  - RAM: ~500MB-1GB por stream
  - Limite: 3-4 transcodes simultaneos con N100

Capacidad total estimada:
  - 5-10 usuarios con streaming directo: sin problema
  - 2-3 usuarios con transcode simultaneo: viable
  - Mezcla tipica (8 directos + 2 transcode): viable
```

---

## 9. Que Cambia vs Que Se Mantiene

### Se reutiliza sin cambios

| Componente | Archivos | Notas |
|-----------|----------|-------|
| **Frontend React completo** | `my-ui/src/`, `my-ui/build/` | Se compila una vez y se sirve desde nginx. Cero cambios en codigo React |
| **Logica TMDB** | `lib/tmdb.js` | Rate limiting, multi-estrategia de busqueda, fallback a API key backup -- todo se mantiene |
| **Normalizers y utils** | `lib/normalizers.js`, `lib/utils.js` | Conversion de formatos, normalizacion de titulos, regex -- funciones puras sin dependencias de I/O |
| **Sistema de streaming** | `routes/streaming.js` (logica de range requests) | La logica de HTTP 206, range headers, y mime types se mantiene identica |
| **Rutas API** | `routes/*.js` (estructura y endpoints) | Los endpoints, parametros y respuestas JSON no cambian. Solo cambia la fuente de datos interna |
| **SSE para actualizaciones** | Logica de Server-Sent Events en `routes/requests.js` y `routes/conversion.js` | Los clientes SSE funcionan igual, nginx los proxea correctamente |
| **Escaneo de series** | `lib/series.js` (parseo S01E01, estructura carpetas) | Misma logica de deteccion de temporadas y episodios, solo cambia la fuente (fs en vez de FTP) |
| **Sistema de peticiones** | `routes/requests.js`, `lib/requests-helpers.js`, `db/requests-db.js` | SQLite ya funciona, se mantiene el schema actual |

### Cambia

| Componente actual | Componente nuevo | Impacto |
|-------------------|-----------------|---------|
| **FTP** (`lib/ftp-helper.js`, `basic-ftp`) | **Lectura directa de disco** (`lib/local-storage.js`, `fs`) | Elimina latencia de red, elimina reconexiones FTP, simplifica codigo. Afecta: `routes/videos.js`, `routes/streaming.js`, `routes/series.js`, `routes/movies.js` |
| **6 archivos JSON** (cache, series, colecciones, descargas, usuarios) | **SQLite unificado** (`isiprime.db`) | Soporta concurrencia, consultas SQL, integridad referencial. Afecta: `lib/cache.js`, `lib/series.js`, `lib/collections.js`, `lib/download-helpers.js` |
| **SHA256** (`crypto.createHash('sha256')`) | **bcrypt** (`bcrypt.hash()`, `bcrypt.compare()`) | Hashing seguro con salt automatico. Afecta: `server.js` (login/registro) |
| **Map() en RAM** (sesiones en memoria) | **SQLite sessions + JWT** | Sesiones persisten entre reinicios, funcionan con PM2 cluster (multiples workers comparten la misma DB). Afecta: `server.js` (authMiddleware) |
| **`node server.js`** (proceso unico) | **PM2 cluster** (4 workers) | Aprovecha los 4 cores, auto-restart, zero-downtime reload. Afecta: despliegue y operaciones |
| **HTTP directo** (puerto 8080 expuesto) | **nginx + HTTPS** (SSL/TLS, Let's Encrypt) | Encriptacion en transito, certificados automaticos, servir estaticos mas rapido. Afecta: configuracion de red |
| **FFmpeg CPU** (`fluent-ffmpeg` con codec por defecto) | **FFmpeg VAAPI/QSV** (aceleracion hardware Intel) | Transcode 3-5x mas rapido, menor uso de CPU. Afecta: `routes/streaming.js`, `routes/conversion.js` |
| **DLNA** (`lib/dlna.js`, `routes/dlna.js`, `node-ssdp`) | **Opcional** (config `DLNA_ENABLED`) | Desactivado por defecto. Si el NAS esta en la misma LAN que una TV, se puede activar para cast local. Los usuarios remotos usan exclusivamente el navegador. Ver `streaming.md` seccion 12.5 |
| **Deteccion FTP/local** (`storage-settings.json` con dual mode) | **Solo local** (`storage-settings.json` simplificado) | Se elimina toda la logica de deteccion y fallback. Afecta: `routes/storage.js`, `server.js` |
