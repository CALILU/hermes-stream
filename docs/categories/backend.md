# Backend - Historial de Cambios

---

## Sesion: 2026-03-06 (noche)

### Cambios Realizados — Newsletter: Recipient Selection + History Resend

**Base de datos (`db/users-db.js`):**
- Migracion: `ALTER TABLE newsletter_logs ADD COLUMN html_content TEXT`
- `logNewsletter()` actualizado para aceptar y guardar `htmlContent`
- Nueva funcion `getNewsletterById(id)` — SELECT con JOIN a users para `sent_by_username`

**API (`routes/newsletter.js`):**
- `moviesForEmail()` — convierte URLs proxy `/api/img/w342/xxx.jpg` a TMDB publicas via `posterCache.toTMDBURL()` (email clients no acceden a LAN)
- `POST /send` — acepta `recipientIds` array para filtrar destinatarios
- `POST /send` y `POST /test` — guardan `htmlContent` en newsletter_logs
- `GET /:id` (NUEVO) — devuelve newsletter completo con `html_content`
- `POST /:id/resend` (NUEVO) — reenvia HTML guardado a destinatarios seleccionados, loguea como status `resent`

### Archivos Afectados
- `db/users-db.js`: columna `html_content`, `logNewsletter()`, `getNewsletterById()` + exports
- `routes/newsletter.js`: `moviesForEmail()`, recipientIds filtering, 2 nuevos endpoints

### Notas
- Newsletters enviados antes del fix no tienen `html_content` (mostrarán "Preview no disponible")
- `posterCache.toTMDBURL()` extrae el path del poster y construye URL TMDB completa
- Los newsletters reenviados se loguean como nuevas entradas con subject `[Reenvio] ...` y status `resent`

---

## Sesion: 2026-03-06 (tarde)

### Cambios Realizados — Per-user TV Identification
- **`db/users-db.js`**: 2 nuevas funciones para identificar usuario por TV
  - `findTVBySerial(serial)` — busca TV por serial en `user_tvs`, devuelve user info (JOIN users)
  - `findTVByModel(model)` — busca TV por modelo, solo devuelve si hay exactamente 1 match (evita ambiguedad)
- **`lib/auth.js`**: LAN auto-auth mejorado — identifica usuario por headers `X-TV-Serial` / `X-TV-Model` antes de caer al generico `id:1, username:'local'`
- **Resultado**: favoritos, progreso, continue-watching son ahora individuales por TV/usuario en LAN

### Cambios Realizados — Guardianes Vol.3 Fix
- Reemplazado archivo 10-bit H.264 (`yuv420p10le`) con version 8-bit (`yuv420p`) compatible webOS
- Cache SQLite actualizado con nuevo archivo

### Cambios Realizados — Transmission Wrapper
- Bash wrapper para `torrent-done.js` — Node.js crashea con `node::Start` cuando lo llama Transmission desde systemd
- Wrapper establece PATH, HOME, cd al directorio, ejecuta con `exec node`
- Configurado en `/home/isidro/.config/transmission-daemon/settings.json`

### Archivos Afectados
- `db/users-db.js`: `findTVBySerial()`, `findTVByModel()` + exports
- `lib/auth.js`: authMiddleware LAN block — TV serial/model lookup
- `IsiPrime-WebOS-Native/js/api.js`: `_detectTVSerial()` (3 estrategias), `_serialHeader()`, headers en `_fetch()`
- `IsiPrime-WebOS-Native/js/requests.js`: `requestedBy` = username, admin = role-based
- `tv-app/js/api.js`, `tv-app/js/requests.js`: copias sincronizadas

### Notas
- webOS 4.0 `PalmSystem.deviceInfo` NO incluye `serialNumber`, solo `modelName` → fallback por modelo
- webOS 6.0 `PalmSystem.deviceInfo` incluye ambos (serial + model)
- Modelo funciona como identificador unico porque todos los TVs registrados tienen modelos distintos
- Luna Service `com.webos.service.tv.systemproperty` falla en web-type apps sin permisos explícitos

---

## Sesion: 2026-03-06 (manana)

### Cambios Realizados — Backdrop Quality Fix
- **`lib/utils.js` `ensureFullPosterURL()`**: 2 bugs corregidos
  - Paths `/api/img/w342/xxx.jpg` se devolvian sin cambiar size → ahora reemplazan con regex
  - TMDB legacy URLs usaban size de la URL en vez del parametro solicitado
- **`lib/normalizers.js`**: backdrop size cambiado a `w780` (equilibrio calidad/peso)
- **`lib/poster-cache.js`**: prewarm descarga backdrops en `w780` (antes `w342`)
- Prewarm ejecutado en NAS: 837 backdrops en 11s

### Cambios Realizados — HEVC Conversion
- **`scripts/reencode-beauty.sh`** (NUEVO): conversion HEVC 4K → H.264 1080p para 5 episodios "The Beauty"
  - Queued: espera fin de `reencode-heavy-movies` antes de empezar
  - ffmpeg libx264 preset faster crf 20
  - Email de notificacion al completar

### Archivos Afectados
- `lib/utils.js`: fix `ensureFullPosterURL()` — size replacement
- `lib/normalizers.js`: backdrop `w780`
- `lib/poster-cache.js`: prewarm backdrop `w780`
- `scripts/reencode-beauty.sh`: HEVC→H.264 conversion (NUEVO)

---

## Sesion: 2026-03-05

### Cambios Realizados — Streaming Mejorado
- **Dynamic Buffer (Phase 4)**: tv-player mide throughput con sliding window 10s, ajusta buffers automáticamente (fast >5Mbps: 45s/20s, normal 1-5Mbps: 30s/15s, slow <1Mbps: 60s/30s)
- **ABR Adaptive Bitrate (Phase 2)**: endpoint `/video-profiles/:filename` devuelve perfiles según bitrate. `/stream-fmp4/` acepta `?quality=medium|low` para re-encode on-the-fly (720p 2500k / 480p 1000k)
- **Probe on-demand (Phase 3)**: `/stream-fmp4/` handler async, ejecuta FFprobe si película no tiene bitrate en SQLite (~200ms), guarda resultado en DB
- **Viewport `/tv` para PC**: meta viewport `width=device-width`, CSS transform `scale(Math.min(w/1920, h/1080))` con `transform-origin: 0 0`

### Cambios Realizados — API Usuarios
- `GET /api/auth/users` enriquecido con TVs (join `user_tvs`) + watching status (`getActiveViewers()`)
- `PUT /api/auth/users/:id` acepta `displayName`, `role`, `emailNotifications` además de `email`
- `POST /api/auth/users/:id/tvs` — añadir TV a usuario
- `DELETE /api/auth/users/:id/tvs/:tvId` — eliminar TV de usuario
- Fix: `/api/auth/refresh` devuelve objeto `user` completo (antes causaba role=viewer)

### Archivos Afectados
- `server.js`: ABR endpoint, quality param en fMP4, dynamic buffer en tv-player inline, viewport `/tv`, probe on-demand async
- `routes/auth.js`: endpoints TV CRUD, GET /users enriquecido, PUT /:id genérico
- `db/media-db.js`: query extendida `OR bitrate IS NULL` (837 películas re-probed en startup)
- `db/users-db.js`: `getActiveViewers()` — detecta usuarios viendo (progress <3min)
- `IsiPrime-WebOS-Native/js/player.js`: handling `quality-change` + `_reloadWithQuality`

### Cambios Realizados — Conversión Batch (scripts NAS)
- `scripts/convert-series-batch.js` (NUEVO): conversión recursiva MKV/AVI→MP4 en `/mnt/peliculas/Series/`
- `scripts/reencode-heavy-movies.js` (NUEVO): re-encode 27 películas >12000kbps a 8000k target
- `scripts/run-all-conversions.sh` (NUEVO): cadena automática series→películas con emails via nodemailer
- Lanzado en NAS con `setsid nohup` (sobrevive desconexión SSH)

### Notas
- 837 películas tenían video_codec pero no bitrate → re-probed en startup (~56s). Distribución: 830 h264+aac, 7 hevc+aac
- ABR: checkABR en tv-player evalúa throughput cada medición, postMessage `quality-change` al parent
- Re-encode películas: ~206GB ahorro estimado, safety checks (ratio output/input, probe result)

---

## Sesion: 2026-02-22 11:57

### Cambios Realizados
- Nuevo endpoint `GET /api/storage/disk-usage` con cache de 5 minutos
- Nuevo endpoint `POST /api/storage/nas-ip` para guardar IP local del NAS
- Endpoint `GET /api/storage/config` ampliado con `nasLocalIP`
- Helper `getLocalDiskUsage()`: fs.statfs (Node 18.15+) → PowerShell (Windows) → df (Linux/WSL)
- Helper `getFTPUsedSpace()`: listado recursivo FTP hasta 3 niveles de profundidad
- Helper `getSynologyDiskUsage()`: login + consulta API DSM (Storage.CGI + FileStation.List)
- Helper `discoverSynologyNAS()`: escaneo multi-subnet (puertos 5000/5001, 253 IPs en paralelo)
- Helper `httpGet()`: HTTP/HTTPS GET con timeout y soporte self-signed certs
- Invalidacion de cache al cambiar modo de almacenamiento

### Archivos Afectados
- `routes/storage.js`: Todos los endpoints y helpers nuevos (~180 lineas añadidas)
- `storage-settings.json`: Añadido campo `nasTotalSize: 4000000000000`

### Codigo Relevante

**Listado recursivo FTP:**
```javascript
async function getFTPUsedSpace(ftpConfig, ftpPath) {
    return await withFTPClient(ftpConfig, async (client) => {
        let totalSize = 0, fileCount = 0;
        async function listRecursive(path, depth = 0) {
            if (depth > 2) return;
            const entries = await client.list(path);
            for (const entry of entries) {
                if (entry.name === '.' || entry.name === '..') continue;
                if (entry.type === 2) await listRecursive(`${path}/${entry.name}`, depth + 1);
                else if (entry.size) { totalSize += entry.size; fileCount++; }
            }
        }
        await listRecursive(ftpPath);
        return { used: totalSize, fileCount };
    }, { timeout: 120000 });
}
```

**Calculo con capacidad total configurable:**
```javascript
result = {
    used: ftpUsed.used,
    fileCount: ftpUsed.fileCount,
    total: storageConfig.nasTotalSize || null,
    free: storageConfig.nasTotalSize ? storageConfig.nasTotalSize - ftpUsed.used : null,
    percentage: storageConfig.nasTotalSize ? Math.round((ftpUsed.used / storageConfig.nasTotalSize) * 100) : null,
    fromListing: true
};
```

**Auto-descubrimiento NAS multi-subnet:**
```javascript
async function discoverSynologyNAS() {
    const subnets = new Set();
    // Subnets del servidor + comunes
    subnets.add('192.168.1');
    subnets.add('192.168.0');
    for (const subnet of subnets) {
        const promises = [];
        for (let i = 2; i <= 254; i++) {
            for (const port of [5000, 5001]) {
                // TCP connect + JSON parse en paralelo (~400ms timeout)
            }
        }
        const found = (await Promise.all(promises)).find(ip => ip !== null);
        if (found) return found;
    }
}
```

### Notas
- FTP nativo no soporta consultas de espacio (AVBL, SITE DF, STAT fallaron en Synology)
- PASV devuelve IP publica (37.14.56.55) - el NAS tiene configurada IP externa para modo pasivo
- DSM API (puertos 5000/5001) no accesible: puertos no abiertos en router Livebox 6
- Servidor en subnet 192.168.0.x, router Livebox en 192.168.1.1 (subnets diferentes)
- Solucion final: listado FTP + capacidad total manual (4 TB) = barra con 61% usado

---

## Sesion: 2026-02-21 14:05

### Cambios Realizados
- Sistema `pendingRequestId` para vincular busqueda UI con descarga de extension Chrome
- Matching de peticiones por `originalTitle` (ingles) ademas de `title` (espanol)
- Reestructuracion del flujo POST /download-queue: matching antes de duplicados
- URLs duplicadas se re-crean en la cola (delete + push)
- Monitor `checkCompletedDownloads` mejorado con requestId directo
- Items de cola incluyen `requestId` para matching fiable al completar descarga

### Archivos Afectados
- `routes/downloads.js`: Nuevo endpoint `POST /api/download-queue/pending-request`, matching con originalTitle, re-creacion de duplicados, items con requestId
- `lib/download-helpers.js`: `checkCompletedDownloads` con match por requestId + originalTitle

### Codigo Relevante

**Nuevo endpoint pendingRequestId (routes/downloads.js):**
```javascript
let pendingRequestId = null;
let pendingRequestTimestamp = 0;
const PENDING_REQUEST_TTL = 5 * 60 * 1000; // 5 minutos

router.post('/download-queue/pending-request', (req, res) => {
    const { requestId } = req.body;
    pendingRequestId = requestId;
    pendingRequestTimestamp = Date.now();
    res.json({ success: true });
});
```

**Matching con effectiveRequestId:**
```javascript
const effectiveRequestId = requestId || (
    pendingRequestId && (Date.now() - pendingRequestTimestamp) < PENDING_REQUEST_TTL
        ? pendingRequestId : null
);

if (effectiveRequestId) {
    requestToUpdate = requestsData.requests.find(r => r.id === effectiveRequestId);
    if (requestToUpdate) pendingRequestId = null; // Consumir
}
```

**Re-creacion de duplicados:**
```javascript
if (isDuplicate) {
    const idx = queue.findIndex(item => item.url === url);
    if (idx !== -1) queue.splice(idx, 1);
}
const queueItem = {
    url, format: 'mp4', status: 'pending',
    added_at: new Date().toISOString(),
    title: queueTitle,
    requestId: updatedRequest ? updatedRequest.id : null
};
queue.push(queueItem);
```

**checkCompletedDownloads con requestId (lib/download-helpers.js):**
```javascript
// 1. Match directo por requestId guardado en la cola
if (item.requestId) {
    bestMatch = requestsData.requests.find(r => r.id === item.requestId);
    if (bestMatch) { bestScore = 1; }
}
// 2. Fallback: similitud titulo + originalTitle
if (!bestMatch) {
    for (const r of requestsData.requests) {
        let similarity = calculateSimilarity(cleanedTitle, r.title);
        if (r.originalTitle) {
            const simOrig = calculateSimilarity(cleanedTitle, r.originalTitle);
            if (simOrig > similarity) similarity = simOrig;
        }
    }
}
```

### Notas
- La extension Chrome extrae titulos incorrectos de OK.ru (nombre de canal/playlist). El sistema pendingRequestId soluciona esto.
- El TTL de 5 minutos es suficiente para buscar en OK.ru y usar clic derecho.
- Las peticiones se almacenan en FTP (`/volume-1/movie-requests.json`), no en SQLite local.

---

## Sesion: 2026-02-16 15:00

### Cambios Realizados
- Nuevo servicio DLNA/UPnP completo para Cast a TV
- Nuevas rutas REST para control remoto de reproduccion en TVs
- Inicializacion del servicio DLNA al arrancar el servidor

### Archivos Afectados
- `lib/dlna.js`: Servicio DLNA con SSDP discovery y MediaRenderer control
- `routes/dlna.js`: 8 endpoints REST montados en `/api/dlna/`
- `server.js`: Montaje de rutas DLNA + `dlnaService.init(PORT)` en callback de listen
- `package.json`: Dependencias `node-ssdp@4.0.1`, `upnp-mediarenderer-client@1.4.0`

### Codigo Relevante

**lib/dlna.js** - Deteccion IP del servidor para URLs absolutas:
```javascript
function detectServerIP(port) {
  const interfaces = os.networkInterfaces();
  for (const [, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && addr.address.startsWith('192.168')) {
        return `http://${addr.address}:${port}`;
      }
    }
  }
  return `http://localhost:${port}`;
}
```

**routes/dlna.js** - Endpoint play con URL absoluta:
```javascript
router.post('/play', async (req, res) => {
  const { deviceUrl, filename, title } = req.body;
  const streamUrl = `${dlnaService.serverUrl}/stream/${encodeURIComponent(filename)}`;
  const posterUrl = req.body.poster || null;
  await dlnaService.play(deviceUrl, { title, streamUrl, mimeType: 'video/mp4', posterUrl });
  res.json({ success: true });
});
```

**server.js** - Montaje e inicializacion:
```javascript
const dlnaService = require('./lib/dlna');
app.use('/api/dlna', require('./routes/dlna').initRoutes({ storageConfig }));

// Dentro de app.listen callback:
try {
  dlnaService.init(PORT);
} catch (err) {
  console.error('DLNA: Error al iniciar:', err.message);
}
```

### Notas
- Las TVs acceden a `/stream/:filename` sin autenticacion porque IsiPrime auto-autentica IPs locales
- SSDP usa multicast UDP en 239.255.255.250:1900
- El servicio mantiene un Map de dispositivos descubiertos y un cliente activo
- Polling de estado cada 2s gestionado desde el frontend (no SSE)

---
