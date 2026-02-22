# Estrategia de Streaming y Transcodificacion - Migracion a LincStation N2

## Indice

1. [Arquitectura de Streaming Actual](#1-arquitectura-de-streaming-actual)
2. [Acceso Directo a Disco (Post-Migracion)](#2-acceso-directo-a-disco-post-migracion)
3. [Intel N100 Quick Sync Video — Capacidades](#3-intel-n100-quick-sync-video--capacidades)
4. [FFmpeg con VAAPI/QSV en Linux](#4-ffmpeg-con-vaapiqsv-en-linux)
5. [Estrategia de Streaming por Formato](#5-estrategia-de-streaming-por-formato)
6. [Limites de Streams Concurrentes](#6-limites-de-streams-concurrentes)
7. [Estrategia de Pre-Conversion por Lotes](#7-estrategia-de-pre-conversion-por-lotes)
8. [HLS Adaptive Streaming (Opcional/Futuro)](#8-hls-adaptive-streaming-opcionalfuturo)
9. [Cola de Transcodificacion con Prioridad](#9-cola-de-transcodificacion-con-prioridad)
10. [Compatibilidad por Dispositivo](#10-compatibilidad-por-dispositivo)
11. [Calculos de Ancho de Banda](#11-calculos-de-ancho-de-banda)
12. [Verificacion de Compatibilidad Multi-Dispositivo](#12-verificacion-de-compatibilidad-multi-dispositivo)

---

## 1. Arquitectura de Streaming Actual

IsiPrime sirve video a traves de `routes/streaming.js`, que maneja las rutas `/stream/:filename` y `/api/audio-tracks/:filename`.

### Flujo actual por formato

**MP4 (reproduccion directa):**
```
Cliente HTTP (Range request)
    --> Express (routes/streaming.js)
        --> FTP Client (basic-ftp)
            --> NAS Synology (/media/)
                --> PassThrough stream
                    --> res.write() con chunks de 5 MB
```

- Se conecta al NAS via FTP en cada peticion
- Soporta HTTP Range requests (bytes parciales, status 206)
- Chunks por defecto de 5 MB si el navegador no especifica end
- Content-Type: `video/mp4`
- Se cierra la conexion FTP al completar el chunk o al cerrar el cliente

**MKV (reproduccion directa con MIME nativo):**
```
Mismo flujo que MP4, pero:
    Content-Type: video/x-matroska
```

- El soporte del navegador para MKV varia (Chrome lo soporta si el codec interno es H.264)
- No se realiza transcodificacion ni remuxing
- Si el usuario selecciona una pista de audio alternativa (audioTrack > 0), se remuxea con FFmpeg copiando video (`-c:v copy`) y convirtiendo audio a AAC

**AVI (transcodificacion en tiempo real):**
```
FTP download stream
    --> PassThrough
        --> FFmpeg stdin (fluent-ffmpeg)
            --> libx264, preset ultrafast, CRF 23
            --> AAC 192k
            --> movflags frag_keyframe+empty_moov+faststart
                --> pipe a res (Transfer-Encoding: chunked)
```

- Transcodificacion CPU completa con `libx264`
- Preset `ultrafast` para minimizar latencia
- No se cachea la salida transcodificada: cada vez que alguien ve un AVI, se transcodifica de nuevo
- No hay Range requests posibles (el tamano final es desconocido)
- Un solo stream a la vez por la carga de CPU

### Limitaciones del sistema actual

| Limitacion | Impacto |
|------------|---------|
| FTP como transporte | Latencia de conexion en cada peticion, overhead de protocolo |
| Nueva conexion FTP por chunk | Handshake repetido, lento en seeking |
| Transcodificacion CPU (libx264) | Solo 1 stream AVI simultaneo viable |
| Sin cache de transcodificacion | Re-transcodifica cada reproduccion |
| Single user | No hay gestion de concurrencia |

### Modo local existente

El codigo actual **ya soporta modo local** como alternativa al FTP:

```javascript
// Modo local - ya implementado en streaming.js
if (storageConfig.mode === 'local') {
    const localPath = path.join(storageConfig.localPath, filename);
    const readStream = fsSync.createReadStream(localPath, { start, end });
    readStream.pipe(res);
}
```

Este modo usa `fs.createReadStream()` con `start` y `end` para Range requests. Es exactamente lo que necesitamos en el NAS.

---

## 2. Acceso Directo a Disco (Post-Migracion)

### Eliminacion de FTP

Al ejecutar IsiPrime directamente en el LincStation N2, los archivos de video estan en disco local. Se elimina completamente la capa FTP.

**Antes (FTP):**
```
Express --> FTP Client --> Red LAN --> NAS Synology --> Disco
              ~5-20ms latencia por operacion
              Handshake en cada conexion
              Overhead de protocolo FTP
```

**Despues (disco local):**
```
Express --> fs.createReadStream() --> Disco NVMe/HDD
              <1ms latencia
              Sin overhead de red
              I/O directo del kernel
```

### Cambios necesarios en el codigo

Practicamente ninguno. El modo local ya esta implementado en `streaming.js`. Solo hay que:

1. **Configurar `storage-settings.json`** para apuntar al directorio de medios:
```json
{
    "mode": "local",
    "localPath": "/media/movies"
}
```

2. **Eliminar el fallback FTP** como opcion principal (mantenerlo como backup si se desea acceder a un NAS remoto).

3. **Ajustar el directorio de series** que actualmente busca en rutas especificas del Synology.

### Mejora de rendimiento esperada

| Metrica | FTP | Disco Local | Mejora |
|---------|-----|-------------|--------|
| Latencia primer byte | 50-200 ms | <5 ms | 10-40x |
| Throughput lectura | ~100 MB/s (red Gigabit) | ~500 MB/s (HDD) / ~3 GB/s (NVMe) | 5-30x |
| Conexiones simultaneas | Limitadas por servidor FTP | Sin limite practico | N/A |
| Seeking (saltar en video) | 200-500 ms (nueva conexion FTP) | <10 ms | 20-50x |
| CPU overhead | Protocolo FTP + streams | Minimal (kernel I/O) | Significativa |

### Streaming directo con Range requests (codigo existente)

```javascript
// Este codigo YA existe en streaming.js y es exactamente lo que usaremos
const range = req.headers.range;
if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const requestedEnd = parts[1] ? parseInt(parts[1], 10) : null;
    const end = requestedEnd !== null
        ? requestedEnd
        : Math.min(start + 5 * 1024 * 1024 - 1, fileSize - 1);
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Length', chunkSize);
    res.setHeader('Content-Type', mimeType);

    const readStream = fsSync.createReadStream(localPath, { start, end });
    readStream.pipe(res);
    res.on('close', () => readStream.destroy());
}
```

---

## 3. Intel N100 Quick Sync Video -- Capacidades

El Intel N100 (Alder Lake-N) incluye Intel UHD Graphics con soporte de codificacion/decodificacion por hardware (Quick Sync Video).

### Tabla de soporte de codecs por hardware

| Codec | Decodificacion | Codificacion | Notas |
|-------|----------------|--------------|-------|
| H.264 (AVC) | HW | HW | Main/High profile, hasta 4K@60fps |
| H.265 (HEVC) | HW | HW | Main/Main10 (10-bit), hasta 4K@60fps |
| VP9 | HW | No | Solo decodificacion, Profile 0 y 2 |
| AV1 | HW | No | Solo decodificacion (generacion Alder Lake) |
| MPEG-2 | HW | No | Soporte legacy para DVDs/archivos antiguos |
| VC-1 | HW | No | Soporte legacy para WMV |
| VP8 | HW | No | Solo decodificacion |
| JPEG | HW | HW | Para thumbnails |

### Especificaciones relevantes del N100

| Especificacion | Valor |
|----------------|-------|
| Nucleos CPU | 4 (E-cores, sin hyperthreading) |
| Frecuencia base/turbo | 1.0 / 3.4 GHz |
| TDP | 6W (configurable hasta 10W) |
| GPU | Intel UHD (24 EU) |
| Memoria max | 16 GB DDR4/DDR5 |
| Quick Sync | Si (generacion 12) |
| VAAPI | Soportado en Linux |
| Resolucion max encode | 4096x2304 |

### Implicaciones practicas

- **Transcodificacion H.264 por hardware**: consume ~2-3W adicionales, deja la CPU libre
- **Transcodificacion H.265 por hardware**: igual de eficiente, genera archivos ~30% mas pequenos
- **Decodificacion AV1**: puede reproducir contenido AV1 pero no puede re-codificar a AV1
- **Multiples streams HW**: el motor de video puede manejar ~3-4 operaciones simultaneas de encode 1080p

---

## 4. FFmpeg con VAAPI/QSV en Linux

### Instalacion

```bash
# Instalar FFmpeg con soporte VAAPI
apt update
apt install ffmpeg vainfo intel-media-va-driver-non-free

# En distribuciones basadas en Ubuntu 22.04+, el driver non-free
# puede requerir habilitar repositorios adicionales:
apt install intel-media-va-driver-non-free mesa-va-drivers
```

### Verificacion del hardware

```bash
# Verificar que el dispositivo de render existe
ls -la /dev/dri/renderD128

# Verificar perfiles VAAPI soportados
vainfo

# Salida esperada para N100:
# vainfo: VA-API version: 1.18
# vainfo: Supported profile and entrypoints:
#   VAProfileH264Main            : VAEntrypointVLD
#   VAProfileH264Main            : VAEntrypointEncSlice
#   VAProfileH264High            : VAEntrypointVLD
#   VAProfileH264High            : VAEntrypointEncSlice
#   VAProfileHEVCMain            : VAEntrypointVLD
#   VAProfileHEVCMain            : VAEntrypointEncSlice
#   VAProfileHEVCMain10          : VAEntrypointVLD
#   VAProfileHEVCMain10          : VAEntrypointEncSlice
#   VAProfileVP9Profile0         : VAEntrypointVLD
#   VAProfileAV1Profile0         : VAEntrypointVLD
```

### Permisos necesarios

```bash
# El usuario que ejecuta Node.js necesita acceso al dispositivo de render
usermod -aG render nodeuser
usermod -aG video nodeuser

# Verificar permisos
ls -la /dev/dri/
# crw-rw----+ 1 root render 226, 128 ... renderD128
```

### VAAPI vs QSV

| Caracteristica | VAAPI | QSV (Intel Media SDK) |
|----------------|-------|-----------------------|
| API | Estandar de Linux (libva) | Propietaria de Intel |
| Instalacion | Mas sencilla (apt install) | Requiere Intel oneVPL/Media SDK |
| Compatibilidad FFmpeg | Nativa | Requiere compilacion especial |
| Rendimiento | Excelente | Ligeramente mejor en algunos casos |
| Mantenimiento | Estable, amplio soporte | Mas complejo, actualizaciones Intel |
| **Recomendacion** | **Usar este** | Solo si VAAPI da problemas |

**Recomendacion: usar VAAPI.** Es mas estandar, mas facil de instalar y mantener, y el rendimiento es practicamente identico para nuestro caso de uso.

### Comandos FFmpeg con VAAPI

**Transcodificar MKV (H.265) a MP4 (H.264):**
```bash
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
  -hwaccel_output_format vaapi \
  -i input.mkv \
  -vf 'format=nv12|vaapi,hwupload' \
  -c:v h264_vaapi -qp 23 \
  -c:a aac -b:a 128k \
  output.mp4
```

**Transcodificar AVI a MP4 (H.264) con hardware:**
```bash
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
  -hwaccel_output_format vaapi \
  -i input.avi \
  -vf 'format=nv12|vaapi,hwupload' \
  -c:v h264_vaapi -qp 23 \
  -c:a aac -b:a 192k \
  -movflags +faststart \
  output.mp4
```

**Remuxear MKV a MP4 (sin re-codificar, solo cambiar contenedor):**
```bash
ffmpeg -i input.mkv \
  -c:v copy -c:a copy \
  -movflags +faststart \
  output.mp4
```

**Transcodificar en streaming (stdin a stdout, para uso en Node.js):**
```bash
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
  -hwaccel_output_format vaapi \
  -i pipe:0 \
  -vf 'format=nv12|vaapi,hwupload' \
  -c:v h264_vaapi -qp 23 \
  -c:a aac -b:a 192k \
  -movflags frag_keyframe+empty_moov+faststart \
  -f mp4 \
  pipe:1
```

### Integracion con fluent-ffmpeg en Node.js

```javascript
// Transcodificacion con VAAPI en Node.js
const ffmpegProcess = ffmpeg(inputPath)
    .inputOptions([
        '-hwaccel', 'vaapi',
        '-hwaccel_device', '/dev/dri/renderD128',
        '-hwaccel_output_format', 'vaapi'
    ])
    .outputOptions([
        '-vf', 'format=nv12|vaapi,hwupload',
        '-c:v', 'h264_vaapi',
        '-qp', '23',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', 'frag_keyframe+empty_moov+faststart',
        '-f', 'mp4'
    ])
    .on('error', (err) => console.error('FFmpeg error:', err.message))
    .on('end', () => console.log('Transcodificacion completada'));

ffmpegProcess.pipe(res, { end: true });
```

### Fallback a CPU si VAAPI no esta disponible

```javascript
function getTranscodeOptions(audioTrack = 0) {
    const vaapiAvailable = fs.existsSync('/dev/dri/renderD128');

    if (vaapiAvailable) {
        return {
            inputOptions: [
                '-hwaccel', 'vaapi',
                '-hwaccel_device', '/dev/dri/renderD128',
                '-hwaccel_output_format', 'vaapi'
            ],
            outputOptions: [
                '-vf', 'format=nv12|vaapi,hwupload',
                '-c:v', 'h264_vaapi',
                '-qp', '23',
                '-map', '0:v:0',
                `-map`, `0:a:${audioTrack}`,
                '-c:a', 'aac',
                '-b:a', '192k',
                '-movflags', 'frag_keyframe+empty_moov+faststart',
                '-f', 'mp4'
            ]
        };
    }

    // Fallback a CPU (libx264)
    return {
        inputOptions: [],
        outputOptions: [
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-crf', '23',
            '-map', '0:v:0',
            `-map`, `0:a:${audioTrack}`,
            '-c:a', 'aac',
            '-b:a', '192k',
            '-movflags', 'frag_keyframe+empty_moov+faststart',
            '-f', 'mp4'
        ]
    };
}
```

---

## 5. Estrategia de Streaming por Formato

Arbol de decision para servir cada formato de video:

| Formato | Contenedor | Codec Video | Estrategia | Carga en Servidor |
|---------|------------|-------------|------------|-------------------|
| `.mp4` | MP4 | H.264 | Reproduccion directa (sin transcodificacion) | Nula (solo I/O) |
| `.mp4` | MP4 | H.265 | Reproduccion directa si el navegador lo soporta; si no, transcodificacion HW a H.264 | Baja (HW) |
| `.mkv` | MKV | H.264 | Remux a MP4 (rapido, sin re-codificar) o directo si el navegador soporta MKV | Minima |
| `.mkv` | MKV | H.265 | Remux a MP4 o transcodificacion HW segun cliente | Baja-Media |
| `.avi` | AVI | Varios (Xvid, DivX) | Transcodificacion HW a H.264 MP4 (siempre) | Media (HW) |
| `.wmv` | ASF | WMV/VC-1 | Transcodificacion HW a H.264 MP4 (siempre) | Media (HW) |

### Detalle de cada estrategia

**Reproduccion directa (Direct Play):**
- `fs.createReadStream()` con Range requests
- Sin procesamiento, minimo uso de CPU
- Maximo rendimiento, soporte de seeking instantaneo

**Remux (cambio de contenedor):**
- `ffmpeg -c:v copy -c:a copy` (copia bitstream sin re-codificar)
- Extremadamente rapido: velocidad limitada solo por I/O
- Util para MKV con H.264 que el navegador no reproduce directamente
- No pierde calidad

**Transcodificacion HW (VAAPI):**
- Re-codifica video usando la GPU integrada
- Uso de CPU minimo (~5-10%)
- Calidad muy buena a QP 23
- Necesaria para AVI, WMV, y H.265 cuando el navegador no lo soporta

**Transcodificacion CPU (fallback):**
- Solo si VAAPI no esta disponible
- `libx264 -preset ultrafast` para minimizar uso de CPU
- Limita a 1 stream simultaneo en el N100

### Deteccion automatica del codec

Para decidir la estrategia correcta, necesitamos saber el codec del archivo. Implementar deteccion con `ffprobe`:

```javascript
async function getVideoCodec(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) return reject(err);
            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            resolve({
                codec: videoStream?.codec_name,   // 'h264', 'hevc', 'mpeg4', etc.
                width: videoStream?.width,
                height: videoStream?.height,
                container: metadata.format?.format_name  // 'mov,mp4,m4a' o 'matroska' o 'avi'
            });
        });
    });
}
```

---

## 6. Limites de Streams Concurrentes

### Estimaciones para Intel N100

**Reproduccion directa (sin transcodificacion):**
- Limitada solo por I/O de disco y ancho de banda de red
- HDD: ~100 MB/s sostenido = ~12 streams de 1080p a 8 Mbps
- NVMe: ~3 GB/s = practicamente ilimitado
- **Estimacion practica: 10+ streams simultaneos sin problema**

**Transcodificacion hardware (VAAPI H.264 encode):**
- El motor de video del N100 tiene capacidad limitada (24 EU)
- Pruebas tipicas reportan ~3-4 encodes 1080p simultaneos
- A 720p se pueden alcanzar ~5-6 encodes simultaneos
- **Estimacion practica: 3-4 streams 1080p simultaneos**

**Transcodificacion software (CPU, libx264 ultrafast):**
- 4 E-cores a 3.4 GHz turbo, TDP 6W
- ~1 stream 1080p en tiempo real con preset ultrafast
- ~2 streams 720p en tiempo real
- **Estimacion practica: 1 stream 1080p simultaneo**

**Remux (cambio de contenedor):**
- Practicamente sin carga (solo copia de datos)
- Limitado por I/O como la reproduccion directa
- **Estimacion practica: 10+ simultaneos**

### Escenario mixto realista

| Tipo de Stream | Cantidad | Carga GPU | Carga CPU | Carga I/O |
|----------------|----------|-----------|-----------|-----------|
| Direct play (MP4 H.264) | 5 | 0% | ~2% | ~40 MB/s |
| Remux (MKV a MP4) | 2 | 0% | ~5% | ~16 MB/s |
| HW transcode (AVI/H.265) | 2 | ~60% | ~10% | ~20 MB/s |
| **Total** | **9** | **~60%** | **~17%** | **~76 MB/s** |

Este escenario es completamente viable en el N100.

### Recomendacion: monitorizar y limitar

```javascript
// Contador global de transcodes activos
let activeTranscodes = 0;
const MAX_HW_TRANSCODES = 3;  // Configurable

function canStartTranscode() {
    return activeTranscodes < MAX_HW_TRANSCODES;
}

function startTranscode() {
    activeTranscodes++;
    return () => { activeTranscodes--; }; // Retorna funcion de cleanup
}
```

---

## 7. Estrategia de Pre-Conversion por Lotes

### Objetivo

Convertir todos los archivos AVI y WMV a MP4 H.264 **antes** de poner el sistema en produccion. Esto elimina la necesidad de transcodificacion en tiempo real para la mayoria del contenido.

### Plan de conversion

1. **Inventariar la biblioteca**: escanear todos los archivos y clasificar por formato
2. **Priorizar**: convertir primero el contenido mas visto
3. **Ejecutar por la noche**: las conversiones HW consumen poca energia (~8W total)
4. **Verificar y reemplazar**: comprobar calidad y sustituir originales

### Adaptar batch-converter.js existente para VAAPI

El proyecto ya tiene `batch-converter.js` con soporte para deteccion de GPU. Hay que anadir VAAPI como opcion:

```javascript
// Anadir a detectGPU() en batch-converter.js
function detectGPU() {
    // ... deteccion existente de NVIDIA/AMD ...

    // Detectar VAAPI (Intel)
    try {
        const vainfo = execSync('vainfo 2>&1').toString();
        if (vainfo.includes('VAEntrypointEncSlice')) {
            return {
                type: 'vaapi',
                encoder: 'h264_vaapi',
                device: '/dev/dri/renderD128',
                inputOptions: [
                    '-hwaccel', 'vaapi',
                    '-hwaccel_device', '/dev/dri/renderD128',
                    '-hwaccel_output_format', 'vaapi'
                ],
                outputOptions: [
                    '-vf', 'format=nv12|vaapi,hwupload',
                    '-c:v', 'h264_vaapi',
                    '-qp', '23'
                ]
            };
        }
    } catch (e) {}

    // Fallback a CPU
    return { type: 'cpu', encoder: 'libx264', ... };
}
```

### Orden de prioridad para conversion

1. **AVI/WMV mas vistos** (basado en historial de reproducciones si existe)
2. **AVI/WMV restantes** (por tamano, primero los mas pequenos para victoria rapida)
3. **MKV con H.265** a MP4 H.264 (opcional, solo si hay problemas de compatibilidad)

### Ejecucion durante horas muertas

```bash
# Cron job para ejecutar conversiones entre 2:00 y 7:00 AM
# crontab -e
0 2 * * * /usr/local/bin/node /opt/isiprime/batch-converter.js \
    --directory /media/movies \
    --gpu vaapi \
    --quality 23 \
    >> /var/log/isiprime/conversion.log 2>&1

# Script wrapper que se detiene a las 7:00 AM
#!/bin/bash
STOP_HOUR=7
while [ $(date +%H) -lt $STOP_HOUR ]; do
    # Buscar siguiente AVI/WMV sin convertir
    NEXT=$(find /media -name "*.avi" -o -name "*.wmv" | head -1)
    [ -z "$NEXT" ] && break
    node /opt/isiprime/batch-converter.js "$NEXT" --gpu vaapi --quality 23
done
```

### Seguimiento del estado de conversion en SQLite

```sql
CREATE TABLE IF NOT EXISTS conversion_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT NOT NULL UNIQUE,
    target_path TEXT,
    source_format TEXT NOT NULL,      -- 'avi', 'wmv', 'mkv'
    source_codec TEXT,                -- 'mpeg4', 'wmv3', 'hevc'
    status TEXT DEFAULT 'pending',    -- pending, converting, completed, failed
    priority INTEGER DEFAULT 0,       -- mayor = mas prioritario
    file_size_mb REAL,
    duration_seconds INTEGER,
    started_at DATETIME,
    completed_at DATETIME,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_conversion_status ON conversion_queue(status);
CREATE INDEX idx_conversion_priority ON conversion_queue(priority DESC);
```

### Estimacion de tiempos de conversion (N100 VAAPI)

| Formato Origen | Duracion | Tiempo Conversion HW | Ratio |
|----------------|----------|----------------------|-------|
| AVI 720p | 90 min | ~15 min | 6x |
| AVI 1080p | 90 min | ~25 min | 3.6x |
| WMV 720p | 90 min | ~15 min | 6x |
| MKV H.265 1080p | 90 min | ~30 min | 3x |

Con VAAPI, una biblioteca de 200 peliculas AVI podria convertirse en ~2-3 noches.

---

## 8. HLS Adaptive Streaming (Opcional/Futuro)

### Que es HLS

HTTP Live Streaming (HLS) divide el video en segmentos pequenos (tipicamente 6-10 segundos) y ofrece multiples calidades. El reproductor del cliente elige automaticamente la calidad adecuada segun su velocidad de conexion.

### Estructura de archivos HLS

```
pelicula/
├── master.m3u8            # Playlist principal (lista las calidades)
├── 1080p/
│   ├── playlist.m3u8      # Playlist de segmentos 1080p
│   ├── segment_000.ts     # Segmento 0 (6 seg)
│   ├── segment_001.ts     # Segmento 1 (6 seg)
│   └── ...
├── 720p/
│   ├── playlist.m3u8
│   └── *.ts
└── 480p/
    ├── playlist.m3u8
    └── *.ts
```

### Comando FFmpeg para generar HLS

```bash
ffmpeg -hwaccel vaapi -hwaccel_device /dev/dri/renderD128 \
  -hwaccel_output_format vaapi \
  -i input.mp4 \
  -vf 'format=nv12|vaapi,hwupload' \
  -c:v h264_vaapi \
  -c:a aac -b:a 128k \
  -hls_time 6 \
  -hls_list_size 0 \
  -hls_segment_filename 'output/segment_%03d.ts' \
  output/playlist.m3u8
```

### Ventajas de HLS

- Adaptacion automatica a la velocidad de conexion
- Mejor experiencia en conexiones inestables (movil, 4G)
- Estandar soportado por practicamente todos los navegadores y dispositivos
- Permite CDN caching de segmentos

### Desventajas de HLS

- **Almacenamiento**: cada calidad multiplica el espacio (3 calidades = 3x espacio)
- **Complejidad**: generacion de segmentos, gestion de playlists, limpieza
- **Latencia inicial**: debe descargar playlist + primer segmento antes de reproducir
- **Pre-procesamiento**: cada video debe segmentarse previamente o segmentarse en tiempo real

### Cuando implementar

| Situacion | Necesita HLS? |
|-----------|---------------|
| Usuarios en red local (LAN) | No |
| 2-3 usuarios remotos con buena fibra | No |
| 5+ usuarios remotos con conexiones variadas | Si |
| Usuarios moviles (4G/5G) | Si |
| Buffering frecuente reportado | Si |

**Recomendacion**: empezar con reproduccion directa + transcodificacion on-demand. Implementar HLS solo si los usuarios reportan problemas de buffering en conexiones lentas. La complejidad adicional no se justifica a menos que haya una necesidad real.

---

## 9. Cola de Transcodificacion con Prioridad

Cuando multiples peticiones de transcodificacion llegan al servidor, necesitamos gestionarlas con un sistema de prioridad.

### Niveles de prioridad

| Prioridad | Nivel | Descripcion | Ejemplo |
|-----------|-------|-------------|---------|
| 1 (maxima) | LIVE | Usuario viendo en tiempo real | Streaming de AVI/WMV |
| 2 | PRECACHE | Pre-cachear contenido popular | Pelicula detectada como tendencia |
| 3 (minima) | BATCH | Conversiones en lote | batch-converter.js nocturno |

### Implementacion de la cola

```javascript
class TranscodeQueue {
    constructor(maxConcurrent = 3) {
        this.maxConcurrent = maxConcurrent;
        this.active = new Map();    // id -> { process, priority, filename }
        this.pending = [];          // Cola ordenada por prioridad
    }

    enqueue(job) {
        // job = { id, filename, priority, inputPath, outputOptions, onData, onEnd, onError }

        // Si hay espacio, ejecutar inmediatamente
        if (this.active.size < this.maxConcurrent) {
            this._execute(job);
            return { status: 'started', position: 0 };
        }

        // Si es LIVE y hay BATCH ejecutandose, preemptar
        if (job.priority === 1) {
            const batchJob = [...this.active.values()]
                .find(j => j.priority === 3);
            if (batchJob) {
                this._cancel(batchJob.id, 'Preemptado por stream en vivo');
                this._execute(job);
                return { status: 'started', preempted: batchJob.id };
            }
        }

        // Encolar ordenado por prioridad
        this.pending.push(job);
        this.pending.sort((a, b) => a.priority - b.priority);

        const position = this.pending.indexOf(job) + 1;

        // Si la cola esta llena y es prioridad baja, rechazar
        if (this.pending.length > 10 && job.priority === 3) {
            this.pending.pop();
            return { status: 'rejected', reason: 'Cola llena' };
        }

        return { status: 'queued', position };
    }

    _execute(job) {
        const process = ffmpeg(job.inputPath)
            .inputOptions(job.inputOptions || [])
            .outputOptions(job.outputOptions);

        if (job.onData) process.on('data', job.onData);
        if (job.onEnd) process.on('end', () => {
            this.active.delete(job.id);
            this._processNext();
            job.onEnd();
        });
        if (job.onError) process.on('error', (err) => {
            this.active.delete(job.id);
            this._processNext();
            job.onError(err);
        });

        this.active.set(job.id, { process, priority: job.priority, filename: job.filename });
    }

    _processNext() {
        if (this.pending.length > 0 && this.active.size < this.maxConcurrent) {
            const next = this.pending.shift();
            this._execute(next);
        }
    }

    _cancel(id, reason) {
        const job = this.active.get(id);
        if (job) {
            job.process.kill('SIGKILL');
            this.active.delete(id);
            console.log(`Transcodificacion ${id} cancelada: ${reason}`);
        }
    }

    getStatus() {
        return {
            active: this.active.size,
            pending: this.pending.length,
            maxConcurrent: this.maxConcurrent,
            jobs: [...this.active.values()].map(j => ({
                filename: j.filename,
                priority: j.priority
            }))
        };
    }
}

// Instancia global
const transcodeQueue = new TranscodeQueue(3);
```

### Configuracion del limite de transcodificaciones concurrentes

```javascript
// Configurable via variable de entorno o archivo de configuracion
const MAX_HW_TRANSCODES = parseInt(process.env.MAX_TRANSCODES) || 3;

// Endpoint para consultar estado
router.get('/api/transcode-status', (req, res) => {
    res.json(transcodeQueue.getStatus());
});
```

### Respuesta cuando el servidor esta saturado

```javascript
// En streaming.js, cuando se necesita transcodificacion
if (!transcodeQueue.canAccept()) {
    return res.status(503).json({
        error: 'Servidor ocupado',
        message: 'Demasiadas transcodificaciones en curso. Intenta en unos minutos.',
        activeTranscodes: transcodeQueue.getStatus().active,
        maxTranscodes: MAX_HW_TRANSCODES
    });
}
```

---

## 10. Compatibilidad por Dispositivo

Como funciona el streaming en cada dispositivo objetivo:

| Dispositivo | Metodo de Acceso | H.264 MP4 | H.265 MP4 | MKV | AVI |
|-------------|-----------------|-----------|-----------|-----|-----|
| PC Chrome | Navegador | Direct play | Direct play* | Remux a MP4 | Transcode HW |
| PC Firefox | Navegador | Direct play | No soportado** | Remux a MP4 | Transcode HW |
| PC Edge | Navegador | Direct play | Direct play* | Remux a MP4 | Transcode HW |
| Android Chrome | Navegador | Direct play | Direct play | Remux a MP4 | Transcode HW |
| iPhone Safari | Navegador | Direct play | Direct play | Remux a MP4 | Transcode HW |
| iPad Safari | Navegador | Direct play | Direct play | Remux a MP4 | Transcode HW |
| Smart TV (navegador) | Navegador | Direct play | Varia segun modelo | Transcode HW | Transcode HW |
| DLNA/UPnP | App nativa | Direct play | Direct play | Direct play | Transcode HW |

**Notas:**
- (*) Chrome soporta H.265 en dispositivos con decodificacion hardware (la mayoria de PCs modernos)
- (**) Firefox tiene soporte H.265 limitado y experimental (detras de flag en versiones recientes)
- MKV con H.264 puede reproducirse directamente en Chrome, pero no en todos los navegadores
- Para maxima compatibilidad, servir siempre como MP4 H.264

### Deteccion del navegador para elegir estrategia

```javascript
function getClientCapabilities(userAgent) {
    const ua = userAgent.toLowerCase();

    return {
        canPlayH265: ua.includes('chrome') || ua.includes('safari') || ua.includes('edg'),
        canPlayMKV: ua.includes('chrome'),
        canPlayHLS: ua.includes('safari') || ua.includes('mobile'),
        preferMP4: true  // Siempre preferir MP4 por compatibilidad
    };
}

// Uso en streaming.js
router.get('/stream/:filename', async (req, res) => {
    const capabilities = getClientCapabilities(req.headers['user-agent']);
    const fileInfo = await getVideoCodec(filePath);

    if (fileInfo.codec === 'hevc' && !capabilities.canPlayH265) {
        // Transcodificar H.265 a H.264
        return transcodeAndStream(filePath, res, 'h264_vaapi');
    }

    if (ext === 'mkv' && !capabilities.canPlayMKV) {
        // Remuxear MKV a MP4
        return remuxAndStream(filePath, res);
    }

    // Direct play
    return directStream(filePath, res, req.headers.range);
});
```

---

## 11. Calculos de Ancho de Banda

Para streaming remoto, la velocidad de subida de la conexion a Internet del NAS es el cuello de botella principal.

### Bitrates tipicos por calidad

| Calidad | Resolucion | Bitrate Video | Bitrate Audio | Total |
|---------|------------|---------------|---------------|-------|
| SD | 480p | ~1.5 Mbps | 128 kbps | ~1.6 Mbps |
| HD | 720p | ~4 Mbps | 128 kbps | ~4.1 Mbps |
| Full HD | 1080p | ~8 Mbps | 192 kbps | ~8.2 Mbps |
| Full HD (alta calidad) | 1080p | ~12 Mbps | 320 kbps | ~12.3 Mbps |
| 4K | 2160p | ~25 Mbps | 320 kbps | ~25.3 Mbps |

### Usuarios concurrentes segun velocidad de subida

| Velocidad de Subida | 720p (4 Mbps) | 1080p (8 Mbps) | 1080p Alta (12 Mbps) | 4K (25 Mbps) |
|---------------------|---------------|-----------------|----------------------|---------------|
| 20 Mbps (ADSL) | 5 usuarios | 2 usuarios | 1 usuario | No viable |
| 30 Mbps (VDSL) | 7 usuarios | 3 usuarios | 2 usuarios | 1 usuario |
| 50 Mbps | 12 usuarios | 6 usuarios | 4 usuarios | 2 usuarios |
| 100 Mbps (fibra) | 25 usuarios | 12 usuarios | 8 usuarios | 4 usuarios |
| 300 Mbps (fibra simetrica) | 75 usuarios | 37 usuarios | 25 usuarios | 12 usuarios |
| 600 Mbps (fibra simetrica) | 150 usuarios | 75 usuarios | 50 usuarios | 24 usuarios |

### Situacion tipica en Espana

| Tipo de Conexion | Subida | Usuarios 1080p | Nota |
|------------------|--------|----------------|------|
| ADSL clasico | 1-3 Mbps | 0 | No viable para streaming remoto |
| VDSL/Fibra basica | 20-30 Mbps | 2-3 | Justo para uso familiar |
| Fibra 300 simetrica | 300 Mbps | 37 | Mas que suficiente para 10 usuarios |
| Fibra 600 simetrica | 600 Mbps | 75 | Sobrado para cualquier escenario |

**La fibra simetrica de 300+ Mbps (comun en Espana con Movistar, Orange, etc.) es mas que suficiente para 10 usuarios simultaneos a 1080p.**

### Recomendaciones practicas

1. **Verificar velocidad de subida real**: ejecutar test de velocidad desde el NAS
   ```bash
   # Instalar speedtest-cli
   apt install speedtest-cli
   speedtest --simple
   # O usar fast.com desde el navegador del NAS
   ```

2. **Si la subida es < 50 Mbps**:
   - Limitar a 5 usuarios concurrentes
   - Considerar transcodificar a bitrate mas bajo (4-6 Mbps para 1080p)
   - Activar limitacion de bitrate por usuario

3. **Si la subida es >= 100 Mbps**:
   - Sin restricciones necesarias para 10 usuarios
   - Considerar servir calidad original sin re-comprimir

4. **Limitacion de bitrate por usuario** (opcional):
   ```javascript
   // En FFmpeg, limitar bitrate de salida
   ffmpegProcess.outputOptions([
       '-maxrate', '6M',     // Maximo 6 Mbps
       '-bufsize', '12M',    // Buffer de 12 Mbps
   ]);
   ```

5. **Monitor de ancho de banda**:
   ```javascript
   // Rastrear bytes enviados por usuario
   let totalBytesSent = 0;
   res.on('pipe', (src) => {
       src.on('data', (chunk) => {
           totalBytesSent += chunk.length;
       });
   });
   ```

---

## Resumen de Acciones Prioritarias

### Fase 1 — Pre-migracion (hacer antes de mover al NAS)

1. Inventariar todos los AVI/WMV de la biblioteca
2. Iniciar pre-conversion a MP4 H.264 (en equipo actual si tiene GPU, o directamente en el N2)
3. Verificar velocidad de subida de Internet del NAS

### Fase 2 — Configuracion del NAS

4. Instalar FFmpeg + drivers VAAPI en el LincStation N2
5. Verificar soporte VAAPI con `vainfo`
6. Configurar permisos de `/dev/dri/renderD128`
7. Configurar `storage-settings.json` en modo local

### Fase 3 — Adaptacion del codigo

8. Modificar `streaming.js` para detectar codec y elegir estrategia
9. Implementar cola de transcodificacion con prioridad
10. Anadir contador de streams activos y limite configurable
11. Adaptar `batch-converter.js` para VAAPI

### Fase 4 — Pruebas de carga

12. Probar 5 streams directos simultaneos
13. Probar 3 transcodes HW simultaneos
14. Probar escenario mixto (direct play + transcode)
15. Verificar estabilidad bajo carga sostenida (4+ horas)

### Fase 5 — Opcional/Futuro

16. Implementar HLS si hay problemas de buffering
17. Anadir panel de monitorizacion de streams activos
18. Cache de transcodificaciones frecuentes

---

## 12. Verificacion de Compatibilidad Multi-Dispositivo

Analisis completo del stack tecnologico para confirmar que permite acceso desde todos los dispositivos objetivo (TVs, PCs, moviles).

### 12.1 HTML5 Video por dispositivo

| API / Feature | PC Chrome | PC Firefox | Smart TV Browser (2021+) | Safari iOS | DLNA nativo |
|---------------|----------|-----------|--------------------------|-----------|-------------|
| `<video>` MP4 H.264 | SI | SI | SI | SI | SI |
| HTTP Range (206) | SI | SI | SI | SI | SI |
| MKV playback | SI (H.264 dentro) | NO | NO | NO | SI |
| H.265/HEVC | SI (con HW) | Parcial | Varia | SI | SI |
| Fullscreen API | SI | SI | SI (mayoria) | SI | N/A |
| Picture-in-Picture | SI | SI | NO (mayoria TVs) | SI | N/A |
| Web Audio API (GainNode) | SI | SI | Parcial | SI | N/A |
| MediaSource Extensions | SI | SI | SI (2019+) | SI | N/A |
| Server-Sent Events (SSE) | SI | SI | SI | SI | N/A |

### 12.2 Frontend React por navegador de TV

| Navegador TV | Motor | Chromium | React 19 | Tailwind | Framer Motion |
|--------------|-------|----------|----------|----------|---------------|
| LG WebOS 6+ (2021+) | Chromium | 79-87 | SI | SI | SI |
| Samsung Tizen 5+ (2019+) | Chromium | 69-85 | SI | SI | SI |
| Android TV | Chrome | 80+ | SI | SI | SI |
| Fire TV Silk | Chromium | 80+ | SI | SI | SI |
| LG WebOS 4-5 (2019-2020) | Chromium | 53-68 | NO | Parcial | NO |
| Samsung Tizen 4 (2018) | Chromium | 56 | NO | Parcial | NO |

**TVs pre-2019** (Chromium <68): React 19 requiere ES2017+ (async/await nativo, optional chaining). Framer Motion 12 usa ResizeObserver y Web Animations API no disponibles. Estas TVs acceden via DLNA, que no necesita el frontend.

### 12.3 Conclusion por componente del stack

| Componente | Compatible? | Detalle |
|------------|------------|---------|
| **SQLite WAL** | SI | WAL permite lecturas concurrentes ilimitadas. Escrituras serializadas pero cada una <1ms. better-sqlite3 funciona correctamente con PM2 cluster (multiples procesos accediendo al mismo .db). Los dispositivos nunca tocan SQLite — acceden via API HTTP. |
| **Node.js/Express** | SI | APIs REST + SSE sobre HTTP estandar. Funciona en cualquier cliente que hable HTTP. CORS ya configurado. |
| **React 19 + Tailwind** | SI | Compatible con navegadores 2019+ (Chromium 69+). TVs antiguas usan DLNA en vez del navegador. |
| **Framer Motion** | SI | Degradacion elegante: si el navegador no soporta Web Animations API, las animaciones simplemente no se muestran. La app sigue funcionando. |
| **MP4 H.264 streaming** | SI | Formato universal. 100% de dispositivos lo reproducen. La estrategia actual (transcode AVI, remux MKV) es correcta. |
| **JWT auth** | SI | Token en header `Authorization: Bearer`. Estandar HTTP, funciona en cualquier cliente. |
| **HTTPS (Let's Encrypt)** | SI | TLS 1.2/1.3 soportado en todas las TVs 2019+. Certificados Let's Encrypt reconocidos por todas las root CAs. |
| **SSE (Server-Sent Events)** | SI | Soportado en todos los navegadores modernos incluidos los de Smart TV. nginx lo proxea correctamente con `X-Accel-Buffering: no`. |
| **DLNA/UPnP** | SI | Funciona en la LAN del NAS para TVs conectadas a la misma red local. `node-ssdp` y `upnp-mediarenderer-client` no dependen de Windows. |

### 12.4 Consideraciones por tipo de acceso

**Acceso remoto (internet, HTTPS):**
- El usuario abre `https://calilu.mooo.com` en el navegador de su PC, movil o Smart TV
- nginx termina SSL, proxea a Node.js
- JWT autentica al usuario
- Video se sirve como MP4 H.264 con HTTP Range requests
- SSE mantiene actualizaciones en tiempo real

**Acceso local (LAN del NAS):**
- Si el NAS esta en la misma red que la TV, DLNA permite enviar video directamente sin navegador
- DLNA opera sobre HTTP sin cifrar (correcto para LAN)
- El modulo existente (`lib/dlna.js`) funciona en Linux sin cambios
- TVs que no soporten el navegador web pueden usar DLNA como alternativa

**Features que NO funcionan en Smart TVs (y por que no importa):**
- **Picture-in-Picture**: en una TV ya estas a pantalla completa. Ocultar el boton PiP cuando se detecte TV.
- **Web Audio API (volume boost)**: el usuario controla volumen con el mando de la TV.
- **backdrop-filter CSS**: efecto visual menor, degradacion sin impacto funcional.

### 12.5 Accion requerida: DLNA en el NAS

La seccion 9 de `architecture.md` marca DLNA como "Eliminado" porque se asumia que el NAS solo serviria por internet. Sin embargo, si el NAS esta conectado a la red local del propietario (administrador), DLNA tiene sentido para las TVs de su hogar.

**Recomendacion**: mantener el modulo DLNA como **opcional**, activable por configuracion:

```javascript
// storage-settings.json o .env
DLNA_ENABLED=true    // Solo si el NAS tiene TVs en su LAN

// server.js
if (process.env.DLNA_ENABLED === 'true') {
    const dlna = require('./lib/dlna');
    dlna.init(PORT);
    // Montar rutas DLNA
}
```

Esto permite:
- Admin local: usa DLNA para su TV + navegador para gestion
- Usuarios remotos: usan exclusivamente el navegador web via HTTPS
