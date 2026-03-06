# IsiPrime — API de Conversión para APK Móvil

Documentación completa para que una aplicación Android se conecte al servidor IsiPrime y consuma la API de conversión de video.

---

## Conexión al servidor

| Dato | Valor |
|------|-------|
| **URL LAN** | `http://192.168.1.45:8080` |
| **URL Remota (HTTPS)** | `https://calilu.mooo.com` |
| **Puerto** | `8080` (configurable via env `PORT`) |
| **Protocolo** | HTTP (LAN) / HTTPS (remoto via nginx) |
| **CORS** | Habilitado para todos los orígenes |

---

## Autenticación (JWT)

| Parámetro | Valor |
|-----------|-------|
| **Access Token** | Expira en **15 minutos** |
| **Refresh Token** | Expira en **30 días** (hex 80 chars) |
| **Header** | `Authorization: Bearer <accessToken>` |
| **SSE/Streaming** | Token via query string: `?token=<accessToken>` |
| **LAN auto-auth** | IPs `192.168.*`, `10.*`, `127.*` → admin automático (sin login) |
| **Rate limit login** | 5 intentos / 15 min por IP |

### POST /api/auth/login

```json
// Request
{ "username": "string (3-30 chars)", "password": "string (min 8 chars)" }

// Response 200
{
  "success": true,
  "accessToken": "eyJhbGci...",
  "refreshToken": "a0b1c2d3e4f5...",
  "user": { "id": 1, "username": "nombre", "role": "admin|viewer" }
}

// Error 401
{ "error": "Credenciales invalidas", "code": "INVALID_CREDENTIALS" }

// Error 429
{ "error": "Demasiados intentos de login. Intenta mas tarde.", "code": "RATE_LIMITED", "retryAfter": 600 }
```

### POST /api/auth/refresh

```json
// Request
{ "refreshToken": "a0b1c2d3e4f5..." }

// Response 200
{ "success": true, "accessToken": "nuevo_jwt...", "refreshToken": "nuevo_refresh..." }

// Error 401
{ "error": "Sesion expirada", "code": "SESSION_EXPIRED" }
```

### POST /api/auth/logout

```json
// Request
{ "refreshToken": "a0b1c2d3e4f5..." }

// Response 200
{ "success": true }
```

### GET /api/auth/status

```
Header: Authorization: Bearer <accessToken>

// Response 200
{ "authenticated": true, "user": { "id": 1, "username": "...", "role": "admin" }, "isLocal": false }
```

### Estrategia recomendada para la APK

1. Guardar `refreshToken` en almacenamiento seguro (`EncryptedSharedPreferences` / Keychain)
2. `accessToken` solo en memoria (no persistir)
3. Si recibe HTTP 401 → `POST /api/auth/refresh` automático → reintentar request original
4. Si refresh falla → forzar pantalla de re-login
5. Al cerrar sesión → `POST /api/auth/logout` + borrar tokens

---

## API de Conversión — `/api/convert`

Todos los endpoints requieren `Authorization: Bearer <accessToken>` en el header (excepto SSE que usa `?token=`).

### GET /api/convert/pending

Lista archivos MKV/AVI pendientes de convertir en disco.

```json
// Response 200
{
  "success": true,
  "files": [
    { "filename": "Pelicula.mkv", "extension": "mkv", "size": 5368709120, "sizeFormatted": "5.00 GB" },
    { "filename": "Video.avi", "extension": "avi", "size": 1073741824, "sizeFormatted": "1.00 GB" }
  ]
}

// Error 500
{ "success": false, "error": "Error al leer directorio de almacenamiento" }
```

### POST /api/convert

Inicia conversión individual de un archivo.

```json
// Request
{ "filename": "Pelicula.mkv" }

// Response 200 (nueva conversión)
{ "jobId": "1740000000000", "mp4Filename": "Pelicula.mp4" }

// Response 200 (ya hay conversión activa del mismo archivo)
{ "jobId": "1740000000000", "mp4Filename": "Pelicula.mp4", "duplicate": true }

// Error 400
{ "error": "Filename requerido" }
{ "error": "Solo se pueden convertir archivos AVI o MKV" }
```

### GET /api/convert/:jobId/progress — SSE

Stream de progreso en tiempo real (Server-Sent Events). Intervalo: **1 segundo**.

**Conexión:** `GET /api/convert/{jobId}/progress?token=<accessToken>`

```
Content-Type: text/event-stream

data: {"status":"starting","progress":0,"filename":"Pelicula.mkv","mp4Filename":"Pelicula.mp4","message":"Iniciando conversion..."}

data: {"status":"converting","progress":45,"filename":"Pelicula.mkv","mp4Filename":"Pelicula.mp4","message":"Convirtiendo: 50%"}

data: {"status":"finalizing","progress":92,"filename":"Pelicula.mkv","mp4Filename":"Pelicula.mp4","message":"Verificando archivo convertido..."}

data: {"status":"completed","progress":100,"filename":"Pelicula.mkv","mp4Filename":"Pelicula.mp4","message":"Conversion completada"}
```

Se cierra automáticamente al completar o fallar. Si el job no existe:

```
data: {"status":"not_found"}
```

### GET /api/convert/status

Estado de todas las conversiones activas + batch.

```json
// Response 200
{
  "success": true,
  "jobs": [
    {
      "jobId": "1740000000000",
      "status": "converting",
      "progress": 45,
      "filename": "Pelicula.mkv",
      "mp4Filename": "Pelicula.mp4",
      "message": "Convirtiendo: 50%"
    }
  ],
  "activeCount": 1,
  "totalCount": 2,
  "batch": {
    "batchId": "1740000000001",
    "total": 25,
    "completed": 5,
    "errors": 0,
    "status": "running"
  }
}
```

`batch` es `null` si no hay batch activo.

### POST /api/convert/all

Convierte TODOS los archivos pendientes en secuencia. Solo 1 batch activo a la vez.

```json
// Response 200
{ "success": true, "batchId": "1740000000001", "total": 25 }

// Response 200 (sin archivos pendientes)
{ "success": true, "message": "No hay archivos pendientes", "total": 0 }

// Error 409 (batch ya en progreso)
{ "success": false, "error": "Ya hay un batch en progreso", "batchId": "1740000000001" }
```

### GET /api/convert/batch/:batchId/progress — SSE

Progreso global del batch (Server-Sent Events). Intervalo: **2 segundos**.

**Conexión:** `GET /api/convert/batch/{batchId}/progress?token=<accessToken>`

```
data: {"batchId":"1740000000001","total":25,"completed":5,"current":{"filename":"movie5.mkv","mp4Filename":"movie5.mp4"},"errors":[],"status":"running"}

data: {"batchId":"1740000000001","total":25,"completed":25,"current":null,"errors":[{"filename":"roto.avi","error":"Error: Output sospechosamente pequeno (12.3% del original)"}],"status":"completed"}
```

`current: null` + `status: "completed"` indica que el batch terminó. La conexión se cierra automáticamente.

---

## Lógica de conversión FFmpeg

| Formato origen | Video | Audio | Velocidad estimada |
|----------------|-------|-------|--------------------|
| **MKV** | `-c:v copy` (sin re-encode) | `-c:a aac -ar 48000 -ac 2 -b:a 192k` | ~30-50% de la duración |
| **AVI** | `-c:v libx264 -preset medium -crf 22` | Mismo audio normalizado | ~2-3x la duración |

Ambos añaden `-movflags +faststart` para streaming óptimo.

### Fases del job

| Fase | Status | Progreso | Descripción |
|------|--------|----------|-------------|
| 1 | `starting` | 0% | Setup inicial, detección de duración via FFprobe |
| 2 | `converting` | 0-90% | Proceso FFmpeg principal con progreso en tiempo real |
| 3 | `finalizing` | 90-95% | Verificación output, probe codecs, mover archivo, eliminar original |
| 4 | `completed` | 100% | Base de datos SQLite actualizada con nuevo filename y codec info |
| — | `error` | — | Fallo en cualquier fase. Archivo temporal limpiado automáticamente |

### Verificaciones post-conversión

- Tamaño del output > 30% del original (evita archivos corruptos)
- FFprobe valida que el video tiene codec válido
- Metadata copiada del filename viejo al nuevo en SQLite
- Info de codec actualizada (video_codec, audio_codec, channels, sample_rate)

### Limpieza

- Archivo temporal: `{filename}.tmp_convert.mp4` (eliminado tras mover o en error)
- Job data: se elimina automáticamente 5 minutos después de completar/fallar

---

## Endpoints complementarios útiles

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/videos` | GET | Catálogo completo de películas |
| `/api/series` | GET | Lista de series |
| `/api/genres` | GET | Géneros disponibles |
| `/stream/:filename?token=xxx` | GET | Streaming de película (video) |
| `/api/requests` | GET | Peticiones de usuarios |

---

## Códigos de error HTTP

| Código | Significado |
|--------|-------------|
| 200 | OK — Request exitoso |
| 400 | Bad Request — Input inválido |
| 401 | Unauthorized — Token inválido/expirado |
| 409 | Conflict — Batch ya en progreso |
| 429 | Too Many Requests — Rate limited (login) |
| 500 | Internal Server Error — Error del servidor |

---

## Flujo completo de ejemplo

### Conversión individual

```
1. POST /api/auth/login
   Body: { "username": "admin", "password": "..." }
   → Guardar accessToken y refreshToken

2. GET /api/convert/pending
   Header: Authorization: Bearer <accessToken>
   → Ver lista de MKV/AVI disponibles

3. POST /api/convert
   Header: Authorization: Bearer <accessToken>
   Body: { "filename": "Pelicula.mkv" }
   → Recibir jobId

4. GET /api/convert/{jobId}/progress?token=<accessToken>
   → Abrir SSE, escuchar eventos hasta status="completed" o "error"

5. GET /api/convert/status
   → Verificar que no queden jobs activos
```

### Conversión batch (todos los pendientes)

```
1. POST /api/auth/login → obtener tokens

2. GET /api/convert/pending → ver cuántos archivos hay

3. POST /api/convert/all
   → Recibir batchId y total

4. GET /api/convert/batch/{batchId}/progress?token=<accessToken>
   → SSE con progreso global: total, completed, current, errors

5. Esperar hasta status="completed"
   → Revisar array errors[] para archivos que fallaron
```

### Manejo de auto-refresh en medio de un flujo

```
1. GET /api/convert/pending → 401 Unauthorized
2. POST /api/auth/refresh → { refreshToken: "..." }
3. Si 200 → Guardar nuevos tokens, reintentar request original
4. Si 401 → Refresh expirado, mostrar login
```
