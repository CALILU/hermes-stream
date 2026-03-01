/**
 * lib/poster-cache.js - Cache local de posters TMDB
 *
 * Descarga imágenes de TMDB y las sirve desde disco para reducir latencia.
 * En vez de que la TV haga peticiones al CDN externo (image.tmdb.org),
 * las imágenes se sirven desde LAN via /api/img/:size/:path
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const https = require('https');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'poster-cache');
const TMDB_IMAGE_HOST = 'image.tmdb.org';
const VALID_SIZES = ['w92', 'w185', 'w342', 'w500', 'w780', 'original', 'h632'];
const PREWARM_CONCURRENCY = 5;

/**
 * Initialize cache directories
 */
function init() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        console.log('📁 Poster cache: directorio creado en', CACHE_DIR);
    }
    for (const size of VALID_SIZES) {
        const sizeDir = path.join(CACHE_DIR, size);
        if (!fs.existsSync(sizeDir)) {
            fs.mkdirSync(sizeDir, { recursive: true });
        }
    }
}

/**
 * Get cached image path if it exists on disk
 */
function getCachedPath(size, imgPath) {
    if (!size || !imgPath) return null;
    const filename = path.basename(imgPath);
    const filePath = path.join(CACHE_DIR, size, filename);
    return fs.existsSync(filePath) ? filePath : null;
}

/**
 * Download image from TMDB and save to disk cache
 */
function downloadAndCache(size, imgPath) {
    return new Promise((resolve, reject) => {
        if (!size || !imgPath) return reject(new Error('Invalid params'));

        const filename = path.basename(imgPath);
        const filePath = path.join(CACHE_DIR, size, filename);

        // Already cached
        if (fs.existsSync(filePath)) return resolve(filePath);

        const url = `https://${TMDB_IMAGE_HOST}/t/p/${size}${imgPath}`;

        function downloadFromUrl(downloadUrl) {
            https.get(downloadUrl, (response) => {
                if (response.statusCode === 301 || response.statusCode === 302) {
                    return downloadFromUrl(response.headers.location);
                }
                if (response.statusCode !== 200) {
                    response.resume();
                    return reject(new Error(`HTTP ${response.statusCode}`));
                }
                const file = fs.createWriteStream(filePath);
                response.pipe(file);
                file.on('finish', () => { file.close(); resolve(filePath); });
                file.on('error', (err) => { fs.unlink(filePath, () => {}); reject(err); });
            }).on('error', reject);
        }

        const req = https.get(url, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                return downloadFromUrl(response.headers.location);
            }
            if (response.statusCode !== 200) {
                response.resume();
                return reject(new Error(`HTTP ${response.statusCode}`));
            }
            const file = fs.createWriteStream(filePath);
            response.pipe(file);
            file.on('finish', () => { file.close(); resolve(filePath); });
            file.on('error', (err) => { fs.unlink(filePath, () => {}); reject(err); });
        });

        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

/**
 * Convert TMDB full URL to proxy URL
 * https://image.tmdb.org/t/p/w342/abc.jpg → /api/img/w342/abc.jpg
 */
function toProxyURL(tmdbURL) {
    if (!tmdbURL) return null;
    if (tmdbURL.startsWith('/api/img/')) return tmdbURL;
    const match = tmdbURL.match(/image\.tmdb\.org\/t\/p\/([^\/]+)(\/.*)/);
    if (match) return `/api/img/${match[1]}${match[2]}`;
    return tmdbURL;
}

/**
 * Convert proxy URL to absolute TMDB URL (for emails, external use)
 * /api/img/w342/abc.jpg → https://image.tmdb.org/t/p/w342/abc.jpg
 */
function toTMDBURL(proxyURL) {
    if (!proxyURL) return null;
    const match = proxyURL.match(/^\/api\/img\/([^\/]+)(\/.*)/);
    if (match) return `https://image.tmdb.org/t/p/${match[1]}${match[2]}`;
    return proxyURL;
}

/**
 * Extract the TMDB relative image path from any URL format
 * /abc.jpg → /abc.jpg
 * /api/img/w342/abc.jpg → /abc.jpg
 * https://image.tmdb.org/t/p/w342/abc.jpg → /abc.jpg
 */
function extractRelativePath(url) {
    if (!url) return null;
    // Already a bare TMDB path like /abc123.jpg
    if (/^\/[a-zA-Z0-9]+\.\w+$/.test(url)) return url;
    // Proxy URL
    var m = url.match(/^\/api\/img\/[^\/]+(\/[^\/]+)$/);
    if (m) return m[1];
    // Full TMDB URL
    m = url.match(/image\.tmdb\.org\/t\/p\/[^\/]+(\/[^\/]+)$/);
    if (m) return m[1];
    return null;
}

/**
 * Prewarm cache: download posters and backdrops for all known movies/series
 */
async function prewarm(mediaDB) {
    console.log('🔥 Poster cache prewarm iniciando...');
    const startTime = Date.now();

    const tasks = [];

    // Collect image paths from movies
    try {
        const movies = mediaDB.getAllMovies();
        for (const [, movie] of Object.entries(movies)) {
            const posterPath = movie.poster_path || movie.poster;
            const backdropPath = movie.backdrop_path || movie.backdrop;

            if (posterPath) {
                const rp = extractRelativePath(posterPath);
                if (rp) tasks.push({ size: 'w342', path: rp });
            }
            if (backdropPath) {
                const rp = extractRelativePath(backdropPath);
                if (rp) tasks.push({ size: 'w780', path: rp });
            }

            // Cast photos
            const cast = movie.cast_json || movie.cast;
            if (Array.isArray(cast)) {
                for (const actor of cast) {
                    const photoPath = actor.photo || actor.profile_path;
                    if (photoPath) {
                        const rp = extractRelativePath(photoPath);
                        if (rp) tasks.push({ size: 'h632', path: rp });
                    }
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Prewarm: error leyendo películas:', e.message);
    }

    // Collect from series
    try {
        const series = mediaDB.getAllSeries();
        for (const [, show] of Object.entries(series)) {
            const posterPath = show.poster_path || show.poster;
            const backdropPath = show.backdrop_path || show.backdrop;

            if (posterPath) {
                const rp = extractRelativePath(posterPath);
                if (rp) tasks.push({ size: 'w342', path: rp });
            }
            if (backdropPath) {
                const rp = extractRelativePath(backdropPath);
                if (rp) tasks.push({ size: 'w780', path: rp });
            }
        }
    } catch (e) {
        console.warn('⚠️ Prewarm: error leyendo series:', e.message);
    }

    // Deduplicate
    const seen = new Set();
    const uniqueTasks = tasks.filter(t => {
        const key = `${t.size}${t.path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    // Filter already cached
    const needed = uniqueTasks.filter(t => !getCachedPath(t.size, t.path));

    console.log(`🔥 Prewarm: ${needed.length} imágenes por descargar (${uniqueTasks.length} total, ${uniqueTasks.length - needed.length} ya en caché)`);

    if (needed.length === 0) {
        console.log('✅ Poster cache ya está completo');
        return;
    }

    // Download with concurrency limit
    let completed = 0;
    let failed = 0;

    async function worker(taskQueue) {
        while (taskQueue.length > 0) {
            const task = taskQueue.shift();
            try {
                await downloadAndCache(task.size, task.path);
                completed++;
            } catch (e) {
                failed++;
            }
            if ((completed + failed) % 100 === 0) {
                console.log(`🔥 Prewarm: ${completed + failed}/${needed.length} (${failed} fallos)`);
            }
        }
    }

    const taskQueue = [...needed];
    const workers = [];
    for (let i = 0; i < PREWARM_CONCURRENCY; i++) {
        workers.push(worker(taskQueue));
    }
    await Promise.all(workers);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Prewarm completo: ${completed} descargadas, ${failed} fallos en ${elapsed}s`);
}

/**
 * Cleanup orphaned images not referenced by any movie/series
 */
async function cleanup(mediaDB) {
    console.log('🧹 Poster cache cleanup...');

    const inUse = new Set();

    try {
        const movies = mediaDB.getAllMovies();
        for (const [, movie] of Object.entries(movies)) {
            for (const field of ['poster_path', 'poster', 'backdrop_path', 'backdrop']) {
                if (movie[field]) {
                    const rp = extractRelativePath(movie[field]);
                    if (rp) inUse.add(path.basename(rp));
                }
            }
            const cast = movie.cast_json || movie.cast;
            if (Array.isArray(cast)) {
                for (const actor of cast) {
                    const photoPath = actor.photo || actor.profile_path;
                    if (photoPath) {
                        const rp = extractRelativePath(photoPath);
                        if (rp) inUse.add(path.basename(rp));
                    }
                }
            }
        }

        const series = mediaDB.getAllSeries();
        for (const [, show] of Object.entries(series)) {
            for (const field of ['poster_path', 'poster', 'backdrop_path', 'backdrop']) {
                if (show[field]) {
                    const rp = extractRelativePath(show[field]);
                    if (rp) inUse.add(path.basename(rp));
                }
            }
        }
    } catch (e) {
        console.warn('⚠️ Cleanup: error leyendo DB:', e.message);
        return;
    }

    let removed = 0;
    for (const size of VALID_SIZES) {
        const sizeDir = path.join(CACHE_DIR, size);
        try {
            const files = await fsPromises.readdir(sizeDir);
            for (const file of files) {
                if (!inUse.has(file)) {
                    await fsPromises.unlink(path.join(sizeDir, file));
                    removed++;
                }
            }
        } catch (e) { /* dir may not exist */ }
    }

    if (removed > 0) console.log(`🧹 Poster cache: ${removed} imágenes huérfanas eliminadas`);
}

module.exports = {
    init,
    getCachedPath,
    downloadAndCache,
    toProxyURL,
    toTMDBURL,
    extractRelativePath,
    prewarm,
    cleanup,
    CACHE_DIR,
    VALID_SIZES
};
