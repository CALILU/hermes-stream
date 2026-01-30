/**
 * IsiPrime Batch Converter - Servidor Web
 * Interfaz visual para conversión masiva de AVI/MKV a MP4
 */

const express = require('express');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ftp = require('basic-ftp');
require('dotenv').config(); // Cargar variables de entorno

// Configuración FTP
const FTP_CONFIG = {
  host: process.env.FTP_HOST || "calilu.mooo.com",
  user: process.env.FTP_USER,
  password: process.env.FTP_PASSWORD,
  port: parseInt(process.env.FTP_PORT) || 21
};
const FTP_DEST_PATH = '/volume-1';

// Archivo de configuración de almacenamiento (compartido con IsiPrime)
const STORAGE_SETTINGS_FILE = path.join(__dirname, 'storage-settings.json');

// Configuración de almacenamiento
let storageConfig = {
  mode: 'ftp',      // 'ftp' o 'local'
  localPath: ''     // Ruta local cuando mode='local'
};

// Cargar configuración de almacenamiento con AUTO-DETECCIÓN
function loadStorageSettings() {
  try {
    if (fs.existsSync(STORAGE_SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(STORAGE_SETTINGS_FILE, 'utf8'));
      storageConfig.localPath = data.localPath || '';

      // AUTO-DETECCIÓN: verificar si la ruta local existe y es accesible
      if (storageConfig.localPath) {
        const localExists = fs.existsSync(storageConfig.localPath);
        const previousMode = data.mode || 'ftp';

        if (localExists) {
          // La ruta local existe → usar modo LOCAL
          storageConfig.mode = 'local';
          if (previousMode !== 'local') {
            console.log(`🔍 Auto-detectado: Disco local conectado`);
            saveStorageSettings();
          }
        } else {
          // La ruta local NO existe → usar modo FTP
          storageConfig.mode = 'ftp';
          if (previousMode !== 'ftp') {
            console.log(`🔍 Auto-detectado: Disco local no disponible`);
            saveStorageSettings();
          }
        }
      } else {
        storageConfig.mode = 'ftp';
      }

      console.log(`📁 Modo almacenamiento: ${storageConfig.mode.toUpperCase()}`);
      if (storageConfig.mode === 'local') {
        console.log(`   Ruta local: ${storageConfig.localPath}`);
      }
    }
  } catch (e) {
    console.log('📁 Usando configuración de almacenamiento por defecto (FTP)');
  }
}

// Guardar configuración de almacenamiento
function saveStorageSettings() {
  try {
    const data = {
      mode: storageConfig.mode,
      localPath: storageConfig.localPath,
      ftpPath: '/volume-1'
    };
    fs.writeFileSync(STORAGE_SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    console.error('Error guardando configuración:', e.message);
  }
}

// Cargar al iniciar
loadStorageSettings();

const app = express();
const PORT = 4000;

// TMDB API (con fallback a key de respaldo)
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_API_KEY_BACKUP = process.env.TMDB_API_KEY_BACKUP;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
let usingBackupKey = false;

if (!TMDB_API_KEY) {
  console.warn('⚠️  TMDB_API_KEY no configurada en .env - La búsqueda de películas no funcionará');
}

// Función helper para obtener la key actual
function getCurrentApiKey() {
  return usingBackupKey ? TMDB_API_KEY_BACKUP : TMDB_API_KEY;
}

// URL del servidor principal de IsiPrime
const MAIN_SERVER_URL = 'http://localhost:8080';

// Normalizar texto para comparación (quitar acentos, puntuación, etc.)
function normalizeForComparison(text) {
  return text
    .toLowerCase()
    // Reemplazar fracciones unicode por números
    .replace(/⅓/g, '1 3').replace(/⅔/g, '2 3').replace(/½/g, '1 2').replace(/¼/g, '1 4').replace(/¾/g, '3 4')
    // Quitar acentos
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Quitar puntuación y caracteres especiales
    .replace(/[^a-z0-9\s]/g, ' ')
    // Normalizar espacios
    .replace(/\s+/g, ' ')
    .trim();
}

// Actualizar estado de petición en el servidor principal
async function updateRequestStatus(movieTitle, movieYear, newStatus, tmdbId = null) {
  try {
    // Obtener todas las peticiones
    const response = await axios.get(`${MAIN_SERVER_URL}/api/requests`);
    const requests = response.data.requests || [];

    // Normalizar título para comparación
    const normalizedTitle = normalizeForComparison(movieTitle);
    console.log(`📋 Buscando petición: "${movieTitle}" → normalizado: "${normalizedTitle}" (año: ${movieYear || '-'}, tmdbId: ${tmdbId || '-'})`);

    // Buscar petición que coincida (prioridad: tmdbId > título+año)
    let matchingRequest = null;

    // 1. Primero intentar por TMDB ID (más fiable)
    if (tmdbId) {
      matchingRequest = requests.find(req => req.tmdbId === tmdbId);
      if (matchingRequest) {
        console.log(`   ✓ Match por TMDB ID: "${matchingRequest.title}"`);
      }
    }

    // 2. Si no hay match por tmdbId, buscar por título
    if (!matchingRequest) {
      matchingRequest = requests.find(req => {
        const reqTitle = normalizeForComparison(req.title || '');
        const reqYear = req.year?.toString();

        // Comparar títulos normalizados (uno contiene al otro o son iguales)
        const titlesMatch = reqTitle === normalizedTitle ||
                            reqTitle.includes(normalizedTitle) ||
                            normalizedTitle.includes(reqTitle);

        // Si hay año en ambos, verificar que coincida
        if (movieYear && reqYear && titlesMatch) {
          return reqYear === movieYear.toString();
        }

        return titlesMatch;
      });

      if (matchingRequest) {
        console.log(`   ✓ Match por título: "${matchingRequest.title}"`);
      }
    }

    if (matchingRequest) {
      await axios.put(`${MAIN_SERVER_URL}/api/requests/${matchingRequest.id}`, { status: newStatus });
      console.log(`📋 Petición #${matchingRequest.id} actualizada a "${newStatus}": ${matchingRequest.title}`);
      return matchingRequest;
    } else {
      console.log(`📋 No se encontró petición para: ${movieTitle} (${movieYear || 'sin año'})`);
      return null;
    }
  } catch (error) {
    console.error('Error buscando peticiones:', error.message);
    return null;
  }
}

// Formatear bytes a tamaño legible
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Subir archivo convertido al servidor FTP
async function uploadToFTP(localFilePath, filename) {
  const client = new ftp.Client();
  client.ftp.verbose = false;
  currentFtpClient = client;

  // Obtener tamaño del archivo
  const fileStats = fs.statSync(localFilePath);
  const totalBytes = fileStats.size;

  // Inicializar estado de subida
  conversionState.upload = {
    isUploading: true,
    fileName: filename,
    progress: 0,
    bytesTransferred: 0,
    totalBytes: totalBytes,
    cancelled: false
  };
  broadcastUpdate();
  console.log(`📤 Iniciando subida a FTP: ${filename} (${formatBytes(totalBytes)})`);

  try {
    await client.access({
      ...FTP_CONFIG,
      secure: false,
      passive: true
    });

    // Verificar si ya existe en el servidor
    const fileList = await client.list(FTP_DEST_PATH);
    const exists = fileList.some(f => f.name === filename);

    if (exists) {
      console.log(`⚠️ Ya existe en servidor: ${filename}`);
      conversionState.upload.isUploading = false;
      broadcastUpdate();
      return { success: true, alreadyExists: true };
    }

    // Configurar tracking de progreso
    client.trackProgress(info => {
      if (conversionState.upload.cancelled) {
        client.close();
        return;
      }
      const progress = Math.round((info.bytesOverall / totalBytes) * 100);
      conversionState.upload.bytesTransferred = info.bytesOverall;
      conversionState.upload.progress = progress;
      broadcastUpdate();

      // Log cada 10%
      if (progress % 10 === 0 && progress !== conversionState.upload.lastLoggedProgress) {
        console.log(`📤 Subiendo ${filename}: ${progress}% (${formatBytes(info.bytesOverall)} / ${formatBytes(totalBytes)})`);
        conversionState.upload.lastLoggedProgress = progress;
      }
    });

    // Verificar cancelación antes de subir
    if (conversionState.upload.cancelled) {
      throw new Error('Subida cancelada por el usuario');
    }

    // Subir el archivo
    await client.uploadFrom(localFilePath, `${FTP_DEST_PATH}/${filename}`);

    client.trackProgress(); // Desactivar tracking
    console.log(`✅ Subido a FTP: ${filename}`);

    conversionState.upload.isUploading = false;
    conversionState.upload.progress = 100;
    broadcastUpdate();

    return { success: true, alreadyExists: false };
  } catch (error) {
    const wasCancelled = conversionState.upload.cancelled;
    console.error(`❌ ${wasCancelled ? 'Subida cancelada' : 'Error subiendo a FTP'}: ${error.message}`);

    conversionState.upload.isUploading = false;
    conversionState.upload.progress = 0;
    broadcastUpdate();

    return { success: false, error: wasCancelled ? 'Cancelado' : error.message, cancelled: wasCancelled };
  } finally {
    client.close();
    currentFtpClient = null;
  }
}

// Copiar archivo a ruta local (cuando está en modo local)
async function copyToLocal(localFilePath, filename, destPath) {
  const destFilePath = path.join(destPath, filename);

  // Verificar si origen y destino son el mismo
  if (path.dirname(localFilePath) === destPath) {
    console.log(`📂 Archivo ya está en destino: ${filename}`);
    return { success: true, alreadyInPlace: true };
  }

  // Verificar si ya existe en el destino
  if (fs.existsSync(destFilePath)) {
    console.log(`⚠️ Ya existe en destino: ${filename}`);
    return { success: true, alreadyExists: true };
  }

  // Obtener tamaño del archivo
  const fileStats = fs.statSync(localFilePath);
  const totalBytes = fileStats.size;

  // Inicializar estado de copia
  conversionState.upload = {
    isUploading: true,
    fileName: filename,
    progress: 0,
    bytesTransferred: 0,
    totalBytes: totalBytes,
    cancelled: false,
    isLocalCopy: true  // Indicador de que es copia local
  };
  broadcastUpdate();
  console.log(`📂 Copiando localmente: ${filename} (${formatBytes(totalBytes)})`);

  return new Promise((resolve) => {
    const readStream = fs.createReadStream(localFilePath);
    const writeStream = fs.createWriteStream(destFilePath);
    let bytesWritten = 0;

    readStream.on('data', (chunk) => {
      bytesWritten += chunk.length;
      const progress = Math.round((bytesWritten / totalBytes) * 100);
      conversionState.upload.bytesTransferred = bytesWritten;
      conversionState.upload.progress = progress;

      // Broadcast menos frecuente para no saturar
      if (progress % 5 === 0 || progress === 100) {
        broadcastUpdate();
      }
    });

    writeStream.on('finish', () => {
      console.log(`✅ Copiado localmente: ${filename}`);
      conversionState.upload.isUploading = false;
      conversionState.upload.progress = 100;
      broadcastUpdate();
      resolve({ success: true });
    });

    writeStream.on('error', (error) => {
      console.error(`❌ Error copiando: ${error.message}`);
      conversionState.upload.isUploading = false;
      broadcastUpdate();
      // Limpiar archivo parcial
      if (fs.existsSync(destFilePath)) {
        try { fs.unlinkSync(destFilePath); } catch (e) {}
      }
      resolve({ success: false, error: error.message });
    });

    readStream.pipe(writeStream);
  });
}

// Función para hacer peticiones a TMDB con fallback
async function tmdbRequest(url, params = {}) {
  params.api_key = getCurrentApiKey();

  try {
    const response = await axios.get(url, { params, timeout: 10000 });
    return response;
  } catch (error) {
    // Si falla, intentar con key de respaldo
    if (!usingBackupKey && TMDB_API_KEY_BACKUP &&
        (error.code === 'ECONNABORTED' || error.message?.includes('timeout') ||
         error.response?.status === 401 || error.response?.status === 429)) {
      console.log('🔄 Cambiando a API key de respaldo...');
      usingBackupKey = true;
      params.api_key = TMDB_API_KEY_BACKUP;
      return await axios.get(url, { params, timeout: 10000 });
    }
    throw error;
  }
}

// Limpiar nombre de archivo para búsqueda TMDB (versión mejorada)
function cleanFilenameForSearch(filename) {
  // Extraer año ANTES de limpiar (buscar patrones como (2024), .2024., 2024)
  const yearPatterns = [
    /\((\d{4})\)/,           // (2024)
    /\[(\d{4})\]/,           // [2024]
    /\.(\d{4})\./,           // .2024.
    /\s(\d{4})\s/,           // espacio 2024 espacio
    /[\.\s\-_](\d{4})$/,     // termina en .2024 o _2024
  ];

  let year = null;
  for (const pattern of yearPatterns) {
    const match = filename.match(pattern);
    if (match) {
      const possibleYear = parseInt(match[1]);
      if (possibleYear >= 1900 && possibleYear <= 2030) {
        year = match[1];
        break;
      }
    }
  }

  let name = filename
    // Quitar extensión
    .replace(/\.(avi|mkv|mp4|mov|wmv|m4v|webm)$/i, '')
    // Quitar URLs y dominios (www.xxx.com, xxx.com, etc.)
    .replace(/www\.[a-z0-9\-]+\.(com|net|org|es|info|to|io|tv|cc|me)/gi, '')
    .replace(/[a-z0-9\-]+\.(com|net|org|es|info|to|io|tv|cc|me)\b/gi, '')
    // Quitar sitios de descarga comunes
    .replace(/\b(newpct|pctmix|pctreload|elitetorrent|mejortorrent|divxtotal|gnula|pelisplus|cuevana|plusdede|seriesblanco|seriesdanko|todotorrents|grantorrent|dontorrent|atomixhq)\b/gi, '')
    // Quitar contenido entre corchetes [xxx]
    .replace(/\[[^\]]*\]/g, '')
    // Quitar contenido entre llaves {xxx}
    .replace(/\{[^\}]*\}/g, '')
    // Reemplazar separadores por espacios
    .replace(/[\._-]/g, ' ')
    // Quitar año entre paréntesis
    .replace(/\(\d{4}\)/g, '')
    // Quitar patrones de calidad tipo M1080, M720, etc.
    .replace(/\b[HM]\d{3,4}p?\b/gi, '')
    // Quitar resoluciones sueltas al final (1080, 720, etc.)
    .replace(/\s+(1080|720|480|2160)\s*$/gi, '')
    // Quitar resoluciones y calidad
    .replace(/\b(480p|576p|720p|1080p|1080i|2160p|4k|uhd|hd|sd|fullhd)\b/gi, '')
    // Quitar codecs de video (incluye variantes con punto/espacio como H.264, H 264)
    .replace(/\b(x264|x265|h[\.\s]?264|h[\.\s]?265|hevc|avc|xvid|divx|mpeg|mpeg2|av1|vp9|10bit|8bit|hdr|hdr10|dolby\s*vision|dv)\b/gi, '')
    // Quitar codecs y canales de audio (DDP = Dolby Digital Plus)
    .replace(/\b(aac|ac3|eac3|dts|dts-hd|dts-hdma|dtshd|truehd|flac|mp3|ogg|opus|atmos|ddp?\d?[\.\s]?\d?|5[\.\s]1|7[\.\s]1|2[\.\s]0|stereo|mono|dual|multi|ma)\b/gi, '')
    // Quitar fuentes (incluye variaciones separadas como DL, Rip)
    .replace(/\b(bluray|blu-ray|bdrip|brrip|dvdrip|dvdscr|dvd|hdtv|pdtv|dsr|webrip|web-dl|webdl|web|hdrip|hdcam|cam|ts|telesync|telecine|screener|r5|r6|vod|amzn|amazon|nf|netflix|hbo|hbomax|dsnp|disney|atvp|apple|hulu|pcok|peacock|rip|dl)\b/gi, '')
    // Quitar idiomas
    .replace(/\b(spanish|español|espanol|castellano|latino|latin|english|ingles|french|frances|german|aleman|italian|italiano|portuguese|hindi|russian|japanese|korean|chinese|multi|multilingual|dual\s*audio|dubbed|subbed|subs|subtitles|subtitulado|sub\s*esp|spa|eng|lat|ita|fre|ger)\b/gi, '')
    // Quitar grupos de release y tags
    .replace(/\b(yify|yts|rarbg|sparks|geckos|amiable|fgt|ntb|cmrg|evo|tigole|qxr|psa|ion10|megusta|stuttershit|edge2020|fleet|hqc|mkvcage|etrg|ettv|ethd|1337x|torrent|scene|release|proper|repack|rerip|internal|real|readnfo|nfo|sample|proof|mkvtv|crazy4ad|crazyhd|flux|ntg|nogrp|syncopy|cinephiles|playweb|ggez|dvsux|slowhd)\b/gi, '')
    // Quitar versiones
    .replace(/\b(extended|unrated|theatrical|directors?\s*cut|final\s*cut|special\s*edition|remastered|restored|anniversary|collectors|criterion|imax|3d|uncut|uncensored|limited|complete|proper|v2|v3)\b/gi, '')
    // Quitar números de temporada/episodio (por si acaso)
    .replace(/\bs\d{1,2}e\d{1,2}\b/gi, '')
    .replace(/\bseason\s*\d+\b/gi, '')
    .replace(/\bepisode\s*\d+\b/gi, '')
    // Quitar guiones bajos y puntos restantes
    .replace(/[_\.]/g, ' ')
    // Quitar paréntesis vacíos
    .replace(/\(\s*\)/g, '')
    // Quitar múltiples espacios
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Quitar el año del nombre si ya fue detectado (evitar duplicación)
  if (year) {
    name = name.replace(new RegExp('\\b' + year + '\\b', 'g'), '').replace(/\s{2,}/g, ' ').trim();
  }

  // Si el nombre quedó muy corto, intentar extraer algo del original
  if (name.length < 2) {
    name = filename
      .replace(/\.(avi|mkv|mp4|mov|wmv)$/i, '')
      .replace(/[\._-]/g, ' ')
      .trim();
  }

  // Última limpieza: quitar palabras muy cortas al final (residuos)
  name = name.replace(/\s+[a-z]{1,2}$/i, '').trim();

  console.log(`[TMDB] Limpieza: "${filename}" → "${name}" (año: ${year || 'no detectado'})`);
  return { name, year };
}

// Buscar película en TMDB con múltiples estrategias (usando axios como server.js)
async function searchTMDB(query, year = null) {
  const searchStrategies = [
    { q: query, y: year },                    // Búsqueda exacta con año
    { q: query, y: null },                    // Sin año (a veces el año está mal)
    { q: query.split(' ').slice(0, 3).join(' '), y: year },  // Primeras 3 palabras con año
    { q: query.split(' ').slice(0, 3).join(' '), y: null },  // Primeras 3 palabras sin año
    { q: query.split(' ')[0], y: year },      // Solo primera palabra con año
  ];

  for (const strategy of searchStrategies) {
    if (!strategy.q || strategy.q.length < 2) continue;

    try {
      const params = {
        api_key: TMDB_API_KEY,
        language: 'es-ES',
        query: strategy.q
      };
      if (strategy.y) {
        params.year = strategy.y;
      }

      console.log(`[TMDB] Buscando: "${strategy.q}" (año: ${strategy.y || 'cualquiera'})`);
      const response = await tmdbRequest(`${TMDB_BASE_URL}/search/movie`, params);
      const data = response.data;

      if (data.results && data.results.length > 0) {
        const movie = data.results[0];
        const releaseYear = movie.release_date ? movie.release_date.substring(0, 4) : '';

        // Limpiar título para nombre de archivo
        const cleanTitle = movie.title
          .replace(/[<>:"/\\|?*]/g, '') // Caracteres no permitidos en Windows
          .replace(/\s+/g, ' ')
          .trim();

        console.log(`[TMDB] ✓ Encontrado: "${cleanTitle}" (${releaseYear})`);
        return {
          found: true,
          title: cleanTitle,
          year: releaseYear,
          originalTitle: movie.original_title,
          tmdbId: movie.id,
          overview: movie.overview
        };
      }
    } catch (error) {
      console.error('[TMDB] Error en búsqueda:', error.message);
    }
  }

  // Último intento: buscar en inglés
  try {
    console.log(`[TMDB] Buscando en inglés: "${query}"`);
    const response = await tmdbRequest(`${TMDB_BASE_URL}/search/movie`, {
      language: 'en-US',
      query: query
    });
    const data = response.data;

    if (data.results && data.results.length > 0) {
      const movie = data.results[0];
      const releaseYear = movie.release_date ? movie.release_date.substring(0, 4) : '';

      // Obtener título en español
      const detailResponse = await tmdbRequest(`${TMDB_BASE_URL}/movie/${movie.id}`, {
        language: 'es-ES'
      });
      const detailData = detailResponse.data;

      const spanishTitle = detailData.title || movie.title;
      const cleanTitle = spanishTitle
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      console.log(`[TMDB] ✓ Encontrado (EN→ES): "${cleanTitle}" (${releaseYear})`);
      return {
        found: true,
        title: cleanTitle,
        year: releaseYear,
        originalTitle: movie.original_title,
        tmdbId: movie.id,
        overview: detailData.overview || movie.overview
      };
    }
  } catch (error) {
    console.error('[TMDB] Error en búsqueda inglés:', error.message);
  }

  console.log(`[TMDB] ✗ No encontrado: "${query}"`);
  return { found: false };
}

// Generar nombre de archivo seguro
function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'converter-ui')));

// Favicon vacío para evitar 404
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Estado global
let conversionState = {
  isRunning: false,
  currentFile: null,
  progress: 0,
  pending: [],
  completed: [],
  failed: [],
  settings: {
    directory: '',
    deleteOriginals: false,
    gpu: 'auto',
    quality: 'balanced',  // fast, balanced, quality
    renameWithTMDB: true,  // Renombrar con nombre de TMDB
    mode: 'convert'  // 'convert' (recodificar) o 'remux' (solo cambiar contenedor)
  },
  stats: {
    totalFiles: 0,
    totalSize: 0,
    savedBytes: 0,
    startTime: null
  },
  // Estado de subida FTP
  upload: {
    isUploading: false,
    fileName: null,
    progress: 0,
    bytesTransferred: 0,
    totalBytes: 0,
    cancelled: false
  }
};

// Proceso FFmpeg actual (para poder matarlo)
let currentFFmpegProcess = null;

// Cliente FTP actual (para poder cancelar subida)
let currentFtpClient = null;

// Clientes SSE conectados
let sseClients = [];

// Enviar actualización a todos los clientes
function broadcastUpdate() {
  const data = JSON.stringify(conversionState);
  sseClients.forEach(client => {
    client.write(`data: ${data}\n\n`);
  });
}

// Formatear tamaño
function formatSize(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(2)} ${units[i]}`;
}

// Detectar GPU
function detectGPU() {
  const gpus = { nvidia: false, intel: false, amd: false };

  try {
    execSync('nvidia-smi', { stdio: 'pipe' });
    gpus.nvidia = true;
  } catch (e) {}

  try {
    const result = execSync('wmic path win32_VideoController get name', { stdio: 'pipe' }).toString();
    if (result.toLowerCase().includes('intel')) gpus.intel = true;
    if (result.toLowerCase().includes('amd') || result.toLowerCase().includes('radeon')) gpus.amd = true;
  } catch (e) {}

  return gpus;
}

// Obtener encoder
function getEncoder(gpuType, quality = 'balanced') {
  const gpus = detectGPU();

  if (gpuType === 'auto') {
    if (gpus.nvidia) gpuType = 'nvidia';
    else if (gpus.intel) gpuType = 'intel';
    else if (gpus.amd) gpuType = 'amd';
    else gpuType = 'none';
  }

  // Perfiles de calidad para NVIDIA
  const nvidiaProfiles = {
    fast: {
      extraArgs: ['-preset', 'p1', '-rc', 'constqp', '-qp', '24', '-b_ref_mode', '0', '-spatial-aq', '0', '-temporal-aq', '0']
    },
    balanced: {
      extraArgs: ['-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '23']
    },
    quality: {
      extraArgs: ['-preset', 'p6', '-tune', 'hq', '-rc', 'vbr', '-cq', '20', '-spatial-aq', '1', '-temporal-aq', '1', '-b_ref_mode', '2']
    }
  };

  // Perfiles para Intel
  const intelProfiles = {
    fast: { extraArgs: ['-preset', 'veryfast', '-global_quality', '25'] },
    balanced: { extraArgs: ['-preset', 'medium', '-global_quality', '23'] },
    quality: { extraArgs: ['-preset', 'slower', '-global_quality', '20'] }
  };

  // Perfiles para AMD
  const amdProfiles = {
    fast: { extraArgs: ['-quality', 'speed', '-rc', 'cqp', '-qp_i', '24', '-qp_p', '24'] },
    balanced: { extraArgs: ['-quality', 'balanced', '-rc', 'vbr_latency', '-qp_i', '22', '-qp_p', '22'] },
    quality: { extraArgs: ['-quality', 'quality', '-rc', 'vbr_latency', '-qp_i', '20', '-qp_p', '20'] }
  };

  // Perfiles para CPU
  const cpuProfiles = {
    fast: { extraArgs: ['-preset', 'veryfast', '-crf', '25'] },
    balanced: { extraArgs: ['-preset', 'medium', '-crf', '23'] },
    quality: { extraArgs: ['-preset', 'slow', '-crf', '20'] }
  };

  switch (gpuType) {
    case 'nvidia':
      return { video: 'h264_nvenc', hwaccel: 'cuda', name: 'NVIDIA NVENC', ...nvidiaProfiles[quality] };
    case 'intel':
      return { video: 'h264_qsv', hwaccel: 'qsv', name: 'Intel QSV', ...intelProfiles[quality] };
    case 'amd':
      return { video: 'h264_amf', hwaccel: 'dxva2', name: 'AMD AMF', ...amdProfiles[quality] };
    default:
      return { video: 'libx264', hwaccel: null, name: 'CPU', ...cpuProfiles[quality] };
  }
}

// Escanear directorio
function scanDirectory(directory) {
  const extensions = ['.avi', '.mkv', '.mp4'];
  const files = [];

  function scan(dir) {
    try {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        // Excluir archivos de la Papelera de Reciclaje ($I y $R)
        if (item.startsWith('$I') || item.startsWith('$R')) {
          continue;
        }

        const fullPath = path.join(dir, item);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            // Excluir carpetas del sistema
            if (item !== '$RECYCLE.BIN' && item !== 'System Volume Information') {
              scan(fullPath);
            }
          } else if (stat.isFile()) {
            const ext = path.extname(item).toLowerCase();
            if (extensions.includes(ext)) {
              // Para AVI/MKV: incluir solo si no existe MP4
              if (ext === '.avi' || ext === '.mkv') {
                const mp4Path = fullPath.replace(/\.(avi|mkv)$/i, '.mp4');
                if (!fs.existsSync(mp4Path)) {
                  files.push({
                    path: fullPath,
                    name: item,
                    size: stat.size,
                    sizeHuman: formatSize(stat.size),
                    status: 'pending'
                  });
                }
              }
              // Para MP4: incluir solo si codec NO es compatible con navegadores
              else if (ext === '.mp4') {
                const videoCodec = getVideoCodec(fullPath);
                if (!videoCodec.isCompatible) {
                  files.push({
                    path: fullPath,
                    name: item,
                    size: stat.size,
                    sizeHuman: formatSize(stat.size),
                    status: 'pending',
                    needsReencode: true,
                    codec: videoCodec.codec
                  });
                }
              }
            }
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  scan(directory);
  return files;
}

// Codecs de video compatibles con navegadores web
const BROWSER_COMPATIBLE_CODECS = ['h264', 'avc1', 'avc', 'hevc', 'h265', 'hvc1', 'hev1'];

// Detectar codec de video y verificar compatibilidad con navegadores
function getVideoCodec(filePath) {
  try {
    const result = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }
    ).toString().trim().toLowerCase();

    const isCompatible = BROWSER_COMPATIBLE_CODECS.includes(result);
    return { codec: result, isCompatible };
  } catch (e) {
    console.log('[Video] Error detectando codec:', e.message);
    return { codec: 'unknown', isCompatible: false };
  }
}

// Detectar pistas de audio y priorizar español
function getAudioMapping(filePath) {
  try {
    const result = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${filePath}"`,
      { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }
    ).toString();

    const data = JSON.parse(result);
    const audioTracks = data.streams
      .filter(s => s.codec_type === 'audio')
      .map((track, idx) => ({
        index: idx,
        language: (track.tags?.language || 'und').toLowerCase(),
        title: (track.tags?.title || '').toLowerCase()
      }));

    if (audioTracks.length <= 1) {
      return { maps: ['-map', '0:a?'], spanishFound: false, totalTracks: audioTracks.length, selectedTracks: 1 };
    }

    // Buscar pista en español
    const spanishIdx = audioTracks.findIndex(t =>
      t.language.includes('spa') || t.language.includes('esp') ||
      t.language === 'es' || t.language.includes('spanish') ||
      t.title.includes('español') || t.title.includes('spanish') ||
      t.title.includes('castellano')
    );

    // Buscar pista en inglés (backup)
    const englishIdx = audioTracks.findIndex(t =>
      t.language.includes('eng') || t.language === 'en' ||
      t.language.includes('english') || t.title.includes('english')
    );

    const maps = [];

    if (spanishIdx >= 0) {
      // Solo español
      maps.push('-map', `0:a:${spanishIdx}`);
      console.log(`[Audio] Español seleccionado (pista ${spanishIdx + 1})`);
      return { maps, spanishFound: true, totalTracks: audioTracks.length, selectedTracks: 1 };
    }

    // Sin español: usar primera pista
    maps.push('-map', '0:a:0');
    console.log(`[Audio] Primera pista seleccionada (no hay español)`);
    return { maps, spanishFound: false, totalTracks: audioTracks.length, selectedTracks: 1 };

  } catch (e) {
    console.log('[Audio] Error detectando pistas:', e.message);
    return { maps: ['-map', '0:a?'], spanishFound: false, totalTracks: 0, selectedTracks: 1 };
  }
}

// Obtener info del video (duración y frames)
async function getVideoInfo(filePath) {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-count_packets',
      '-show_entries', 'stream=nb_read_packets,r_frame_rate,duration',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => { output += data.toString(); });
    ffprobe.on('close', () => {
      try {
        const data = JSON.parse(output);
        let totalFrames = 0;
        let duration = 0;

        // Intentar obtener duración del formato
        if (data.format && data.format.duration) {
          duration = parseFloat(data.format.duration);
        }

        // Intentar obtener frames del stream
        if (data.streams && data.streams[0]) {
          const stream = data.streams[0];
          if (stream.nb_read_packets) {
            totalFrames = parseInt(stream.nb_read_packets);
          } else if (stream.duration && stream.r_frame_rate) {
            // Calcular frames desde duración y fps
            const streamDuration = parseFloat(stream.duration);
            const fpsMatch = stream.r_frame_rate.match(/(\d+)\/(\d+)/);
            if (fpsMatch) {
              const fps = parseInt(fpsMatch[1]) / parseInt(fpsMatch[2]);
              totalFrames = Math.round(streamDuration * fps);
            }
          }
        }

        // Si no tenemos frames pero tenemos duración, estimar a 24fps
        if (!totalFrames && duration) {
          totalFrames = Math.round(duration * 24);
        }

        console.log(`[Info] ${filePath}: ${totalFrames} frames, ${duration}s`);
        resolve({ totalFrames, duration });
      } catch (e) {
        console.log(`[Info] No se pudo obtener info de ${filePath}`);
        resolve({ totalFrames: 0, duration: 0 });
      }
    });
    ffprobe.on('error', () => resolve({ totalFrames: 0, duration: 0 }));
  });
}

// Convertir archivo
async function convertFile(file, encoder, deleteOriginal, renameWithTMDB) {
  const inputPath = file.path;
  const inputDir = path.dirname(inputPath);
  const inputExt = path.extname(inputPath).toLowerCase();
  const isMP4Input = inputExt === '.mp4';

  // Para MP4 con codec incompatible: usar sufijo temporal, luego reemplazar
  let outputPath = isMP4Input
    ? inputPath.replace(/\.mp4$/i, '.reencoded.mp4')
    : inputPath.replace(/\.(avi|mkv)$/i, '.mp4');
  let finalName = isMP4Input
    ? file.name  // Mantener nombre original para MP4
    : file.name.replace(/\.(avi|mkv)$/i, '.mp4');
  let tmdbInfo = null;

  // Usar el match de TMDB si existe y está habilitado el renombrado
  if (renameWithTMDB && file.tmdbMatch) {
    tmdbInfo = { found: true, ...file.tmdbMatch };
    finalName = file.tmdbMatch.newName;
    outputPath = path.join(inputDir, finalName);
    console.log(`[TMDB] Usando match guardado: "${file.tmdbMatch.title}" (${file.tmdbMatch.year})`);

    // Verificar si ya existe un archivo con ese nombre
    const defaultOutput = isMP4Input
      ? inputPath.replace(/\.mp4$/i, '.reencoded.mp4')
      : inputPath.replace(/\.(avi|mkv)$/i, '.mp4');
    if (fs.existsSync(outputPath) && outputPath !== defaultOutput) {
      console.log(`[TMDB] Ya existe: ${finalName}, usando nombre original`);
      outputPath = defaultOutput;
      finalName = isMP4Input ? file.name : file.name.replace(/\.(avi|mkv)$/i, '.mp4');
      tmdbInfo = null;
    }
  } else if (renameWithTMDB && !file.tmdbMatch) {
    console.log(`[TMDB] Sin match para: ${file.name}, usando nombre original`);
  }

  const tempPath = outputPath + '.converting';

  return new Promise(async (resolve) => {
    const { totalFrames, duration } = await getVideoInfo(inputPath);

    conversionState.currentFile = file.name + (tmdbInfo?.found ? ` → ${tmdbInfo.title}` : '');
    conversionState.progress = 0;
    broadcastUpdate();

    const ffmpegArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-stats'];
    let isRemuxMode = conversionState.settings.mode === 'remux';

    // Determinar si es MKV (puede tener subtítulos problemáticos como PGS y audio DTS)
    const isMKV = inputPath.toLowerCase().endsWith('.mkv');

    // Detectar codec de video para verificar compatibilidad con navegadores
    const videoCodec = getVideoCodec(inputPath);
    console.log(`[Video] Codec: ${videoCodec.codec} - Compatible con navegadores: ${videoCodec.isCompatible ? 'SÍ' : 'NO'}`);

    // Si modo remux pero codec no compatible, forzar conversión
    if (isRemuxMode && !videoCodec.isCompatible) {
      console.log(`[!] Codec "${videoCodec.codec}" no compatible con navegadores → Forzando CONVERSIÓN`);
      isRemuxMode = false; // Cambiar a modo convert
    }

    if (isRemuxMode) {
      // ========== MODO REMUX (copiar video, convertir audio a AAC) ==========
      console.log(`\n[REMUX] ${file.name} (video copiado, audio → AAC)`);

      // Detectar pistas de audio y priorizar español
      const audioInfo = getAudioMapping(inputPath);
      console.log(`[Audio] ${audioInfo.totalTracks} pista(s) detectada(s), español: ${audioInfo.spanishFound ? 'SÍ' : 'NO'}`);

      ffmpegArgs.push(
        '-i', inputPath,
        '-map', '0:v:0',       // Video principal
        ...audioInfo.maps,     // Pistas de audio (español primero si existe)
        '-c:v', 'copy',        // Copiar video sin recodificar (RÁPIDO)
        '-c:a', 'aac',         // Convertir audio a AAC (compatible con navegadores)
        '-b:a', '192k',        // Bitrate de audio
        '-ac', '2',            // Forzar stereo (evita problemas con 5.1/7.1)
        '-movflags', '+faststart',  // Índice al principio para streaming
        '-sn'                  // Sin subtítulos (pueden ser incompatibles)
      );
    } else {
      // ========== MODO CONVERSIÓN (recodificar) ==========
      if (encoder.hwaccel) {
        ffmpegArgs.push('-hwaccel', encoder.hwaccel);
      }

      ffmpegArgs.push(
        '-i', inputPath,
        '-c:v', encoder.video,
        ...(encoder.extraArgs || []),
        '-movflags', '+faststart',
        '-map', '0:v:0'
      );

      // Detectar pistas de audio y priorizar español
      const audioInfo = getAudioMapping(inputPath);
      console.log(`[Audio] ${audioInfo.totalTracks} pista(s) detectada(s), español: ${audioInfo.spanishFound ? 'SÍ' : 'NO'}`);

      // Añadir mapeo de audio (español primero si existe)
      ffmpegArgs.push(...audioInfo.maps);

      // Configuración de audio
      ffmpegArgs.push(
        '-c:a', 'aac',
        '-b:a', '192k'
      );

      if (isMKV) {
        // Para MKV: forzar stereo y sin subtítulos bitmap
        ffmpegArgs.push(
          '-ac', '2',            // Forzar stereo (evita problemas con 7.1/5.1)
          '-sn'                  // Sin subtítulos (PGS/VobSub no son compatibles con MP4)
        );
      } else {
        // Para AVI: intentar copiar subtítulos
        ffmpegArgs.push(
          '-map', '0:s?',
          '-c:s', 'mov_text'
        );
      }
    }

    ffmpegArgs.push('-f', 'mp4', tempPath);

    console.log(`\n[${isRemuxMode ? 'REMUX' : 'Convirtiendo'}] ${file.name}`);
    console.log(`[Comando] ffmpeg ${ffmpegArgs.join(' ')}\n`);

    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    currentFFmpegProcess = ffmpeg;

    let errorOutput = '';

    ffmpeg.stderr.on('data', (data) => {
      const output = data.toString();
      errorOutput += output;

      // Intentar obtener progreso por frames
      const frameMatch = output.match(/frame=\s*(\d+)/);
      if (frameMatch && totalFrames > 0) {
        const currentFrame = parseInt(frameMatch[1]);
        const newProgress = Math.min(99, Math.round((currentFrame / totalFrames) * 100));
        if (newProgress !== conversionState.progress) {
          conversionState.progress = newProgress;
          broadcastUpdate();
        }
      } else {
        // Fallback: intentar por tiempo
        const timeMatch = output.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (timeMatch && duration > 0) {
          const currentTime = parseInt(timeMatch[1]) * 3600 + parseInt(timeMatch[2]) * 60 + parseInt(timeMatch[3]);
          const newProgress = Math.min(99, Math.round((currentTime / duration) * 100));
          if (newProgress !== conversionState.progress) {
            conversionState.progress = newProgress;
            broadcastUpdate();
          }
        }
      }
    });

    ffmpeg.on('close', async (code) => {
      currentFFmpegProcess = null;

      // Si fue detenido por el usuario, limpiar y salir
      if (!conversionState.isRunning && code !== 0) {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch(e) {}
        }
        console.log(`[Detenido] ${file.name}`);
        resolve({ success: false, error: 'Detenido por el usuario' });
        return;
      }

      if (code === 0 && fs.existsSync(tempPath)) {
        try {
          fs.renameSync(tempPath, outputPath);
          const newSize = fs.statSync(outputPath).size;
          const savedBytes = file.size - newSize;

          conversionState.stats.savedBytes += savedBytes;

          if (deleteOriginal) {
            fs.unlinkSync(inputPath);
          }

          const modeUsed = isRemuxMode ? 'remux' : 'convert';
          resolve({
            success: true,
            newSize,
            newSizeHuman: formatSize(newSize),
            savedBytes,
            savedBytesHuman: formatSize(savedBytes),
            finalName,
            outputPath,
            tmdbInfo,
            mode: modeUsed
          });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      } else {
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch(e) {}
        }

        // Analizar el error para dar mejor feedback
        let errorMsg = `FFmpeg error (code ${code})`;
        const errorLower = errorOutput.toLowerCase();

        if (isRemuxMode) {
          // Errores comunes en modo remux
          if (errorLower.includes('dts') || errorLower.includes('dca')) {
            errorMsg = 'REMUX FALLIDO: Audio DTS no compatible con MP4. Usa modo "Convertir" en su lugar.';
          } else if (errorLower.includes('truehd')) {
            errorMsg = 'REMUX FALLIDO: Audio TrueHD no compatible con MP4. Usa modo "Convertir" en su lugar.';
          } else if (errorLower.includes('hdmv_pgs') || errorLower.includes('pgs')) {
            errorMsg = 'REMUX FALLIDO: Subtítulos PGS no compatibles. Usa modo "Convertir" en su lugar.';
          } else if (errorLower.includes('codec') || errorLower.includes('incompatible')) {
            errorMsg = 'REMUX FALLIDO: Codec incompatible con MP4. Usa modo "Convertir" en su lugar.';
          } else {
            errorMsg = `REMUX FALLIDO: ${errorOutput.slice(-150)}. Prueba con modo "Convertir".`;
          }
          console.error(`[REMUX Error] ${file.name}: ${errorMsg}`);
        } else {
          console.error(`[Error] Conversion failed for ${file.name}:`, errorOutput.slice(-500));
          errorMsg = `Error de conversión: ${errorOutput.slice(-150)}`;
        }

        resolve({ success: false, error: errorMsg, mode: isRemuxMode ? 'remux' : 'convert' });
      }
    });

    ffmpeg.on('error', (error) => {
      resolve({ success: false, error: error.message });
    });
  });
}

// Proceso de conversión
async function runConversion() {
  if (conversionState.isRunning) return;

  conversionState.isRunning = true;
  conversionState.stats.startTime = Date.now();
  const encoder = getEncoder(conversionState.settings.gpu, conversionState.settings.quality);

  console.log(`[Config] GPU: ${encoder.name}, Calidad: ${conversionState.settings.quality}`);
  broadcastUpdate();

  while (conversionState.pending.length > 0 && conversionState.isRunning) {
    const file = conversionState.pending.shift();

    // Saltar archivos excluidos
    console.log(`🔍 Verificando exclusión: "${file.name}" - Excluidos: ${excludedFiles.size} - ¿Está excluido?: ${excludedFiles.has(file.name)}`);
    if (excludedFiles.has(file.name)) {
      console.log(`⏭️  Saltando (excluido): ${file.name}`);
      file.status = 'skipped';
      continue;
    }

    file.status = 'converting';
    conversionState.currentFile = file.name;
    broadcastUpdate();

    const result = await convertFile(file, encoder, conversionState.settings.deleteOriginals, conversionState.settings.renameWithTMDB);

    if (result.success) {
      file.status = 'completed';
      file.newSize = result.newSizeHuman;
      file.saved = result.savedBytesHuman;
      if (result.finalName && result.finalName !== file.name.replace(/\.(avi|mkv)$/i, '.mp4')) {
        file.newName = result.finalName;
      }
      conversionState.completed.push(file);

      // Extraer título, año y tmdbId para buscar petición
      const { name: movieTitle, year: movieYear } = cleanFilenameForSearch(result.finalName || file.name);
      const tmdbId = result.tmdbInfo?.tmdbId || file.tmdbMatch?.tmdbId || null;

      // Actualizar estado de la petición a 'mp4'
      updateRequestStatus(movieTitle, movieYear, 'mp4', tmdbId);

      // Recargar configuración de almacenamiento (puede haber cambiado)
      loadStorageSettings();

      // Transferir al destino según modo de almacenamiento
      if (storageConfig.mode === 'local' && storageConfig.localPath) {
        // MODO LOCAL: copiar al destino local (o no hacer nada si ya está ahí)
        const outputDir = path.dirname(result.outputPath);
        const normalizedOutputDir = path.normalize(outputDir).toLowerCase();
        const normalizedLocalPath = path.normalize(storageConfig.localPath).toLowerCase();

        // Verificar si el archivo ya está en la ruta de destino
        if (normalizedOutputDir === normalizedLocalPath || normalizedOutputDir.startsWith(normalizedLocalPath + path.sep)) {
          // El archivo ya está en el destino local, no hay que copiarlo
          console.log(`📂 Archivo ya está en destino local: ${result.finalName}`);
          file.status = 'uploaded';
          file.localMode = true;
          // Actualizar estado de la petición a 'server' (ya está en destino)
          updateRequestStatus(movieTitle, movieYear, 'server', tmdbId);
        } else {
          // El archivo está en otra ubicación, copiarlo al destino local
          file.status = 'uploading';
          broadcastUpdate();

          const copyResult = await copyToLocal(result.outputPath, result.finalName, storageConfig.localPath);
          if (copyResult.success) {
            file.status = 'uploaded';
            file.localMode = true;
            // Actualizar estado de la petición a 'server'
            updateRequestStatus(movieTitle, movieYear, 'server', tmdbId);

            // Borrar archivo original después de copiar exitosamente
            if (!copyResult.alreadyInPlace && !copyResult.alreadyExists) {
              try {
                fs.unlinkSync(result.outputPath);
                console.log(`🗑️ Borrado origen: ${result.finalName}`);
              } catch (delErr) {
                console.error(`⚠️ No se pudo borrar origen ${result.finalName}: ${delErr.message}`);
              }
            }
          } else {
            file.uploadError = copyResult.error;
            console.error(`❌ No se pudo copiar ${result.finalName}: ${copyResult.error}`);
          }
        }
      } else if (FTP_CONFIG.user && FTP_CONFIG.password) {
        // MODO FTP: subir al servidor FTP
        file.status = 'uploading';
        broadcastUpdate();

        const uploadResult = await uploadToFTP(result.outputPath, result.finalName);
        if (uploadResult.success) {
          file.status = 'uploaded';
          // Actualizar estado de la petición a 'server'
          updateRequestStatus(movieTitle, movieYear, 'server', tmdbId);

          // Borrar archivo local después de subir exitosamente
          try {
            fs.unlinkSync(result.outputPath);
            console.log(`🗑️ Borrado local: ${result.finalName}`);
          } catch (delErr) {
            console.error(`⚠️ No se pudo borrar ${result.finalName}: ${delErr.message}`);
          }
        } else {
          file.uploadError = uploadResult.error;
          console.error(`❌ No se pudo subir ${result.finalName}: ${uploadResult.error}`);
        }
      } else {
        // Sin configuración de transferencia, mantener archivo donde está
        console.log(`📁 Sin destino configurado, archivo conservado: ${result.finalName}`);
      }
    } else {
      file.status = 'failed';
      file.error = result.error;
      conversionState.failed.push(file);
    }

    broadcastUpdate();
  }

  conversionState.isRunning = false;
  conversionState.currentFile = null;
  conversionState.progress = 0;
  broadcastUpdate();
}

// API Endpoints

// Estado actual
app.get('/api/state', (req, res) => {
  res.json(conversionState);
});

// SSE para actualizaciones en tiempo real
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  sseClients.push(res);

  res.write(`data: ${JSON.stringify(conversionState)}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// Estado de escaneo para SSE
let scanProgress = {
  isScanning: false,
  phase: '',
  current: 0,
  total: 0,
  currentFile: ''
};

// Enviar progreso de escaneo a todos los clientes
function broadcastScanProgress() {
  const data = JSON.stringify({ type: 'scan-progress', ...scanProgress });
  sseClients.forEach(client => {
    client.write(`data: ${data}\n\n`);
  });
}

// Escanear carpeta
app.post('/api/scan', async (req, res) => {
  const { directory } = req.body;

  if (!directory || !fs.existsSync(directory)) {
    return res.status(400).json({ error: 'Directorio no valido' });
  }

  // Iniciar progreso de escaneo
  scanProgress = { isScanning: true, phase: 'scanning', current: 0, total: 0, currentFile: '' };
  broadcastScanProgress();

  const files = scanDirectory(directory);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  // Actualizar progreso - fase de archivos encontrados
  scanProgress.phase = 'tmdb';
  scanProgress.total = files.length;
  scanProgress.current = 0;
  broadcastScanProgress();

  // Buscar en TMDB para cada archivo (vista previa)
  console.log(`[Scan] Buscando ${files.length} archivos en TMDB...`);
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const { name, year } = cleanFilenameForSearch(file.name);

    // Actualizar progreso
    scanProgress.current = i + 1;
    scanProgress.currentFile = file.name.substring(0, 40) + (file.name.length > 40 ? '...' : '');
    broadcastScanProgress();

    const tmdbResult = await searchTMDB(name, year);

    if (tmdbResult.found) {
      file.tmdbMatch = {
        title: tmdbResult.title,
        year: tmdbResult.year,
        tmdbId: tmdbResult.tmdbId,
        originalTitle: tmdbResult.originalTitle,
        newName: `${tmdbResult.title} (${tmdbResult.year}).mp4`
      };
      file.searchQuery = name;
    } else {
      file.tmdbMatch = null;
      file.searchQuery = name;
    }
  }
  console.log(`[Scan] Búsqueda TMDB completada`);

  // Finalizar escaneo
  scanProgress.isScanning = false;
  scanProgress.phase = 'done';
  broadcastScanProgress();

  conversionState.settings.directory = directory;
  conversionState.pending = files;
  conversionState.completed = [];
  conversionState.failed = [];
  conversionState.stats.totalFiles = files.length;
  conversionState.stats.totalSize = totalSize;
  conversionState.stats.savedBytes = 0;

  // Limpiar archivos excluidos del escaneo anterior
  excludedFiles.clear();

  broadcastUpdate();

  res.json({
    success: true,
    count: files.length,
    totalSize: formatSize(totalSize),
    files
  });
});

// Buscar película en TMDB manualmente (usando tmdbRequest con fallback)
app.get('/api/tmdb/search', async (req, res) => {
  const { query, year } = req.query;

  if (!query) {
    return res.status(400).json({ error: 'Query requerido' });
  }

  try {
    const params = {
      language: 'es-ES',
      query: query
    };
    if (year) {
      params.year = year;
    }

    console.log(`[TMDB] Buscando manualmente: "${query}"`);
    const response = await tmdbRequest(`${TMDB_BASE_URL}/search/movie`, params);
    const data = response.data;
    console.log(`[TMDB] Encontrados: ${data.results ? data.results.length : 0} resultados`);

    const results = (data.results || []).slice(0, 10).map(movie => ({
      tmdbId: movie.id,
      title: (movie.title || '').replace(/[<>:"/\\|?*]/g, ''),
      originalTitle: movie.original_title || '',
      year: movie.release_date ? movie.release_date.substring(0, 4) : '',
      overview: movie.overview ? movie.overview.substring(0, 150) + '...' : '',
      poster: movie.poster_path ? `https://image.tmdb.org/t/p/w92${movie.poster_path}` : null
    }));

    res.json({ success: true, results });
  } catch (error) {
    console.error('[TMDB Search Error]', error.message, error.stack);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

// Actualizar match de TMDB para un archivo
app.post('/api/files/update-match', (req, res) => {
  const { filename, tmdbMatch } = req.body;

  const file = conversionState.pending.find(f => f.name === filename);
  if (!file) {
    return res.status(404).json({ error: 'Archivo no encontrado' });
  }

  if (tmdbMatch) {
    file.tmdbMatch = {
      title: tmdbMatch.title,
      year: tmdbMatch.year,
      tmdbId: tmdbMatch.tmdbId,
      originalTitle: tmdbMatch.originalTitle,
      newName: `${tmdbMatch.title} (${tmdbMatch.year}).mp4`
    };
  } else {
    file.tmdbMatch = null;
  }

  broadcastUpdate();
  res.json({ success: true });
});

// Lista de archivos excluidos de la conversión
let excludedFiles = new Set();

// Establecer archivos excluidos
app.post('/api/exclude', (req, res) => {
  const { excludedFiles: files } = req.body;
  excludedFiles = new Set(files || []);
  console.log(`⏭️  Archivos excluidos: ${excludedFiles.size}`);
  if (excludedFiles.size > 0) {
    console.log(`   Lista: ${Array.from(excludedFiles).join(', ')}`);
  }
  res.json({ success: true, count: excludedFiles.size });
});

// Configurar opciones
app.post('/api/settings', (req, res) => {
  const { deleteOriginals, gpu, quality, renameWithTMDB, mode } = req.body;

  if (deleteOriginals !== undefined) {
    conversionState.settings.deleteOriginals = deleteOriginals;
  }
  if (gpu !== undefined) {
    conversionState.settings.gpu = gpu;
  }
  if (quality !== undefined) {
    conversionState.settings.quality = quality;
  }
  if (renameWithTMDB !== undefined) {
    conversionState.settings.renameWithTMDB = renameWithTMDB;
  }
  if (mode !== undefined) {
    conversionState.settings.mode = mode;
  }

  broadcastUpdate();
  res.json({ success: true, settings: conversionState.settings });
});

// Iniciar conversión
app.post('/api/start', (req, res) => {
  if (conversionState.isRunning) {
    return res.status(400).json({ error: 'Ya hay una conversion en curso' });
  }

  if (conversionState.pending.length === 0) {
    return res.status(400).json({ error: 'No hay archivos pendientes' });
  }

  runConversion();
  res.json({ success: true });
});

// Pausar conversión
app.post('/api/stop', (req, res) => {
  console.log('[Stop] Deteniendo conversión...');
  conversionState.isRunning = false;

  // Matar el proceso FFmpeg actual
  if (currentFFmpegProcess) {
    try {
      currentFFmpegProcess.kill('SIGKILL');
      console.log('[Stop] Proceso FFmpeg terminado');
    } catch (e) {
      console.log('[Stop] Error al matar proceso:', e.message);
    }
    currentFFmpegProcess = null;
  }

  broadcastUpdate();
  res.json({ success: true });
});

// Cancelar subida FTP
app.post('/api/cancel-upload', (req, res) => {
  console.log('[Cancel] Cancelando subida FTP...');

  if (!conversionState.upload.isUploading) {
    return res.status(400).json({ error: 'No hay subida en progreso' });
  }

  conversionState.upload.cancelled = true;

  // Cerrar conexión FTP si existe
  if (currentFtpClient) {
    try {
      currentFtpClient.close();
      console.log('[Cancel] Conexión FTP cerrada');
    } catch (e) {
      console.log('[Cancel] Error al cerrar FTP:', e.message);
    }
    currentFtpClient = null;
  }

  conversionState.upload.isUploading = false;
  broadcastUpdate();

  res.json({ success: true, message: 'Subida cancelada' });
});

// Detectar GPUs
app.get('/api/gpus', (req, res) => {
  const gpus = detectGPU();
  res.json(gpus);
});

// Obtener configuración de almacenamiento
app.get('/api/storage/config', (req, res) => {
  // Recargar configuración por si ha cambiado
  loadStorageSettings();
  res.json({
    mode: storageConfig.mode,
    localPath: storageConfig.localPath,
    ftpConfigured: !!(FTP_CONFIG.user && FTP_CONFIG.password),
    ftpHost: FTP_CONFIG.host
  });
});

// Abrir diálogo de selección de carpeta (Windows 11 moderno)
app.get('/api/browse-folder', (req, res) => {
  const initialPath = req.query.initial || '';

  // PowerShell script usando IFileOpenDialog (diálogo moderno de Windows 11)
  const psScript = `
[System.Reflection.Assembly]::LoadWithPartialName("System.windows.forms") | Out-Null

$source = @"
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("DC1C5A9C-E88A-4dde-A5A1-60F82A20AEF7")]
internal class FileOpenDialogInternal { }

[ComImport, Guid("42f85136-db7e-439c-85f1-e4075d135fc8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IFileOpenDialog {
    [PreserveSig] int Show([In] IntPtr parent);
    void SetFileTypes();
    void SetFileTypeIndex([In] uint iFileType);
    void GetFileTypeIndex(out uint piFileType);
    void Advise();
    void Unadvise();
    void SetOptions([In] uint fos);
    void GetOptions(out uint pfos);
    void SetDefaultFolder(IShellItem psi);
    void SetFolder(IShellItem psi);
    void GetFolder(out IShellItem ppsi);
    void GetCurrentSelection(out IShellItem ppsi);
    void SetFileName([In, MarshalAs(UnmanagedType.LPWStr)] string pszName);
    void GetFileName([MarshalAs(UnmanagedType.LPWStr)] out string pszName);
    void SetTitle([In, MarshalAs(UnmanagedType.LPWStr)] string pszTitle);
    void SetOkButtonLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszText);
    void SetFileNameLabel([In, MarshalAs(UnmanagedType.LPWStr)] string pszLabel);
    void GetResult(out IShellItem ppsi);
    void AddPlace(IShellItem psi, int alignment);
    void SetDefaultExtension([In, MarshalAs(UnmanagedType.LPWStr)] string pszDefaultExtension);
    void Close(int hr);
    void SetClientGuid();
    void ClearClientData();
    void SetFilter([MarshalAs(UnmanagedType.Interface)] IntPtr pFilter);
    void GetResults();
    void GetSelectedItems();
}

[ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IShellItem {
    void BindToHandler();
    void GetParent();
    void GetDisplayName([In] uint sigdnName, [MarshalAs(UnmanagedType.LPWStr)] out string ppszName);
    void GetAttributes();
    void Compare();
}

public class FolderPicker {
    public static string Show(string title, string initialPath) {
        var dialog = (IFileOpenDialog)new FileOpenDialogInternal();
        dialog.SetOptions(0x20); // FOS_PICKFOLDERS
        dialog.SetTitle(title);

        if (!string.IsNullOrEmpty(initialPath)) {
            IShellItem item;
            SHCreateItemFromParsingName(initialPath, IntPtr.Zero, typeof(IShellItem).GUID, out item);
            if (item != null) dialog.SetFolder(item);
        }

        if (dialog.Show(IntPtr.Zero) == 0) {
            IShellItem result;
            dialog.GetResult(out result);
            string path;
            result.GetDisplayName(0x80058000, out path);
            return path;
        }
        return null;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    static extern int SHCreateItemFromParsingName(string pszPath, IntPtr pbc, [In] Guid riid, out IShellItem ppv);
}
"@

Add-Type -TypeDefinition $source -Language CSharp -ErrorAction SilentlyContinue

try {
    $result = [FolderPicker]::Show("Selecciona la carpeta con peliculas", "${initialPath.replace(/\\/g, '\\\\')}")
    if ($result) { Write-Output $result }
} catch {
    # Fallback al diálogo clásico si falla
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = "Selecciona la carpeta con peliculas"
    $dialog.RootFolder = [System.Environment+SpecialFolder]::MyComputer
    if ("${initialPath.replace(/\\/g, '\\\\')}") { $dialog.SelectedPath = "${initialPath.replace(/\\/g, '\\\\')}" }
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
        Write-Output $dialog.SelectedPath
    }
}
`.trim();

  const powershell = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', psScript], {
    windowsHide: false
  });

  let output = '';

  powershell.stdout.on('data', (data) => {
    output += data.toString();
  });

  powershell.on('close', (code) => {
    const selectedPath = output.trim();
    if (selectedPath && fs.existsSync(selectedPath)) {
      res.json({ success: true, path: selectedPath });
    } else {
      res.json({ success: false, cancelled: true });
    }
  });

  powershell.on('error', (error) => {
    console.error('Error abriendo diálogo:', error);
    res.status(500).json({ success: false, error: error.message });
  });
});

// Abrir carpeta en el Explorador de Windows
app.get('/api/open-folder', (req, res) => {
  const directory = conversionState.settings.directory;

  if (!directory || !fs.existsSync(directory)) {
    return res.status(400).json({ error: 'No hay carpeta seleccionada o no existe' });
  }

  try {
    // Abrir el Explorador de Windows en la carpeta
    spawn('explorer', [directory], { detached: true, stdio: 'ignore' });
    res.json({ success: true, path: directory });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reiniciar
app.post('/api/reset', (req, res) => {
  conversionState = {
    isRunning: false,
    currentFile: null,
    progress: 0,
    pending: [],
    completed: [],
    failed: [],
    settings: conversionState.settings,
    stats: { totalFiles: 0, totalSize: 0, savedBytes: 0, startTime: null }
  };
  broadcastUpdate();
  res.json({ success: true });
});

// Crear directorio UI si no existe
const uiDir = path.join(__dirname, 'converter-ui');
if (!fs.existsSync(uiDir)) {
  fs.mkdirSync(uiDir);
}

// Capturar errores no manejados
process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesa rechazada:', reason);
});

// Iniciar servidor (solo localhost para evitar bloqueos de firewall)
const CONVERTER_VERSION = '2.1.0'; // 2.1.0 = solo 1 pista audio (español o primera)

const server = app.listen(PORT, '127.0.0.1', () => {
  console.log(`\n  IsiPrime Batch Converter v${CONVERTER_VERSION}`);
  console.log(`  ================================`);
  console.log(`  Servidor: http://localhost:${PORT}`);
  console.log(`  Modo: ${storageConfig.mode === 'local' ? 'LOCAL (' + storageConfig.localPath + ')' : 'FTP (' + FTP_CONFIG.host + ')'}`);
  console.log(`  \n  Abre el navegador en la URL anterior\n`);
});

server.on('error', (err) => {
  console.error('Error del servidor:', err);
});
