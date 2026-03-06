/**
 * lib/utils.js - Funciones utilitarias compartidas entre server.js y converter-server.js
 */

// Regex para detectar archivos de video
const VIDEO_EXTENSIONS_REGEX = /\.(mp4|mkv|avi|mov)$/i;

// Base URL para imágenes de TMDB
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

// Límite de actores en el cast
const CAST_LIMIT = 15;

/**
 * Normalizar texto para comparación de títulos.
 * Maneja fracciones unicode, acentos, apóstrofes, guiones, &.
 */
function normalizeText(str) {
    return (str || '')
        .toLowerCase()
        .replace(/⅓/g, '1 3').replace(/⅔/g, '2 3').replace(/½/g, '1 2').replace(/¼/g, '1 4').replace(/¾/g, '3 4')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[''´`]/g, '')
        .replace(/[:\-–—]/g, ' ')
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Obtener solo el título principal (antes de : o -)
 */
function getMainTitle(str) {
    return (str || '')
        .split(/[:\-–—]/)[0]
        .trim();
}

/**
 * Calcular similitud entre dos strings (0-1) basada en palabras coincidentes.
 */
function calculateSimilarity(str1, str2) {
    const s1 = normalizeText(str1);
    const s2 = normalizeText(str2);

    if (s1 === s2) return 1;
    if (!s1 || !s2) return 0;

    const words1 = s1.split(' ').filter(w => w.length > 1);
    const words2 = s2.split(' ').filter(w => w.length > 1);

    if (words1.length === 0 || words2.length === 0) return 0;

    const matches = words1.filter(w => words2.includes(w)).length;
    const maxWords = Math.max(words1.length, words2.length);

    return matches / maxWords;
}

/**
 * Limpiar nombre de archivo para búsqueda TMDB.
 * Versión robusta que elimina URLs, codecs, resoluciones, idiomas, grupos de release, etc.
 * Devuelve { name, year }.
 */
function cleanFilenameForSearch(filename) {
    // Extraer año ANTES de limpiar
    const yearPatterns = [
        /\((\d{4})\)/,
        /\[(\d{4})\]/,
        /\.(\d{4})\./,
        /\s(\d{4})\s/,
        /[\.\s\-_](\d{4})$/,
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
        .replace(/\.(avi|mkv|mp4|mov|wmv|m4v|webm)$/i, '')
        .replace(/www\.[a-z0-9\-]+\.(com|net|org|es|info|to|io|tv|cc|me)/gi, '')
        .replace(/[a-z0-9\-]+\.(com|net|org|es|info|to|io|tv|cc|me)\b/gi, '')
        .replace(/\b(newpct|pctmix|pctreload|elitetorrent|mejortorrent|divxtotal|gnula|pelisplus|cuevana|plusdede|seriesblanco|seriesdanko|todotorrents|grantorrent|dontorrent|atomixhq)\b/gi, '')
        .replace(/\[[^\]]*\]/g, '')
        .replace(/\{[^\}]*\}/g, '')
        .replace(/[\._-]/g, ' ')
        .replace(/\(\d{4}\)/g, '')
        .replace(/\b[HM]\d{3,4}p?\b/gi, '')
        .replace(/\s+(1080|720|480|2160)\s*$/gi, '')
        .replace(/\b(480p|576p|720p|1080p|1080i|2160p|4k|uhd|hd|sd|fullhd)\b/gi, '')
        .replace(/\b(x264|x265|h[\.\s]?264|h[\.\s]?265|hevc|avc|xvid|divx|mpeg|mpeg2|av1|vp9|10bit|8bit|hdr|hdr10|dolby\s*vision|dv)\b/gi, '')
        .replace(/\b(aac|ac3|eac3|dts|dts-hd|dts-hdma|dtshd|truehd|flac|mp3|ogg|opus|atmos|ddp?\d?[\.\s]?\d?|5[\.\s]1|7[\.\s]1|2[\.\s]0|stereo|mono|dual|multi|ma)\b/gi, '')
        .replace(/\b(bluray|blu-ray|bdrip|brrip|dvdrip|dvdscr|dvd|hdtv|pdtv|dsr|webrip|web-dl|webdl|web|hdrip|hdcam|cam|ts|telesync|telecine|screener|r5|r6|vod|amzn|amazon|nf|netflix|hbo|hbomax|dsnp|disney|atvp|apple|hulu|pcok|peacock|rip|dl)\b/gi, '')
        .replace(/\b(spanish|español|espanol|castellano|latino|latin|english|ingles|french|frances|german|aleman|italian|italiano|portuguese|hindi|russian|japanese|korean|chinese|multi|multilingual|dual\s*audio|dubbed|subbed|subs|subtitles|subtitulado|sub\s*esp|spa|eng|lat|ita|fre|ger)\b/gi, '')
        .replace(/\b(yify|yts|rarbg|sparks|geckos|amiable|fgt|ntb|cmrg|evo|tigole|qxr|psa|ion10|megusta|stuttershit|edge2020|fleet|hqc|mkvcage|etrg|ettv|ethd|1337x|torrent|scene|release|proper|repack|rerip|internal|real|readnfo|nfo|sample|proof|mkvtv|crazy4ad|crazyhd|flux|ntg|nogrp|syncopy|cinephiles|playweb|ggez|dvsux|slowhd)\b/gi, '')
        .replace(/\b(extended|unrated|theatrical|directors?\s*cut|final\s*cut|special\s*edition|remastered|restored|anniversary|collectors|criterion|imax|3d|uncut|uncensored|limited|complete|proper|v2|v3)\b/gi, '')
        .replace(/\bs\d{1,2}e\d{1,2}\b/gi, '')
        .replace(/\bseason\s*\d+\b/gi, '')
        .replace(/\bepisode\s*\d+\b/gi, '')
        .replace(/[_\.]/g, ' ')
        .replace(/\(\s*\)/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

    // Quitar el año del nombre si ya fue detectado
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

    return { name, year };
}

/**
 * Formatear bytes a tamaño legible (ej: "1.50 GB")
 */
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Asegurar URL proxy para imagen TMDB.
 * - Si ya es proxy URL (/api/img/...), la devuelve tal cual.
 * - Si es URL completa TMDB, la convierte a proxy URL.
 * - Si es path relativa (/xxx.jpg), la completa con /api/img/{size}.
 * @param {string} posterPath - Path de la imagen
 * @param {string} [size='w342'] - Tamaño TMDB (w342, w780, h632, etc.)
 */
function ensureFullPosterURL(posterPath, size) {
    if (!posterPath) return null;
    if (posterPath.startsWith('/api/img/')) {
        // Replace size if requested and different
        if (size) {
            return posterPath.replace(/^\/api\/img\/[^\/]+\//, '/api/img/' + size + '/');
        }
        return posterPath;
    }
    if (posterPath.startsWith('http')) {
        // Convert TMDB URL to proxy URL
        const match = posterPath.match(/image\.tmdb\.org\/t\/p\/([^\/]+)(\/.*)/);
        if (match) return `/api/img/${size || match[1]}${match[2]}`;
        return posterPath;
    }
    return `/api/img/${size || 'w342'}${posterPath}`;
}

module.exports = {
    VIDEO_EXTENSIONS_REGEX,
    TMDB_IMAGE_BASE,
    CAST_LIMIT,
    normalizeText,
    getMainTitle,
    calculateSimilarity,
    cleanFilenameForSearch,
    formatBytes,
    ensureFullPosterURL
};
