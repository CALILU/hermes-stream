# Backend - Historial de Cambios

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
