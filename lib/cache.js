/**
 * lib/cache.js - Gestión de caché de películas (cache.json)
 *
 * Factory: recibe configuración y dependencias, devuelve funciones de gestión.
 */

const fs = require('fs').promises;

/**
 * @param {Object} config
 * @param {string} config.CACHE_FILE - Ruta al archivo cache.json
 * @param {number} config.CACHE_TTL - Tiempo de vida del caché en ms
 * @param {string} config.TMDB_BASE_URL - URL base de TMDB API
 * @param {string} config.TMDB_IMAGE_BASE - URL base para imágenes TMDB
 * @param {string} config.TMDB_API_KEY - API key de TMDB
 * @param {Function} config.tmdbFetch - Función fetch con rate limiting para TMDB
 * @param {Function} config.processTMDBExtendedData - Procesa datos extendidos de TMDB
 * @param {Function} config.cleanFilenameForSearch - Limpia nombre de archivo para búsqueda
 * @param {Object} config.collectionsManager - { updateCollectionWithMovie }
 */
function createCacheManager(config) {
    const {
        CACHE_FILE, CACHE_TTL, TMDB_BASE_URL, TMDB_IMAGE_BASE, TMDB_API_KEY,
        tmdbFetch, processTMDBExtendedData, cleanFilenameForSearch, collectionsManager
    } = config;

    async function readCache() {
        try {
            const data = await fs.readFile(CACHE_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    // Sobrescribe TODO el cache. Para actualizar una sola entrada, usar updateCacheEntry.
    // Cache se almacena en formato TMDB nativo (snake_case).
    // La normalización a camelCase se hace al leer (normalizeCacheToAPI).
    async function writeCache(cache) {
        await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
    }

    // Actualizar una sola entrada del cache sin sobrescribir las demás.
    // Si merge=true, combina con datos existentes; si merge=false, reemplaza completamente.
    async function updateCacheEntry(filename, data, merge = false) {
        const cache = await readCache();

        if (merge && cache[filename]) {
            data = { ...cache[filename], ...data };
        }

        cache[filename] = data;
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

    function isCacheExpired(cacheEntry) {
        if (!cacheEntry || !cacheEntry.cached_at) {
            return true;
        }
        const now = Date.now();
        const cacheAge = now - cacheEntry.cached_at;
        return cacheAge > CACHE_TTL;
    }

    // Buscar película en TMDB con múltiples estrategias
    async function searchTMDB(filename) {
        const { name: title, year } = cleanFilenameForSearch(filename);

        // Múltiples estrategias de búsqueda (más específica → más laxa)
        const strategies = [
            { query: title, year, lang: 'es-ES' },
            { query: title, year: null, lang: 'es-ES' },
            { query: title.split(' ').slice(0, 3).join(' '), year, lang: 'es-ES' },
            { query: title.split(' ').slice(0, 3).join(' '), year: null, lang: 'es-ES' },
            { query: title, year, lang: 'en-US' },
            { query: title, year: null, lang: 'en-US' },
        ];

        let movie = null;

        for (const strategy of strategies) {
            if (!strategy.query || strategy.query.length < 2) continue;

            try {
                const response = await tmdbFetch(`${TMDB_BASE_URL}/search/movie`, {
                    params: {
                        api_key: TMDB_API_KEY,
                        query: strategy.query,
                        language: strategy.lang,
                        ...(strategy.year && { year: strategy.year })
                    },
                    timeout: 5000,
                    headers: { 'Accept': 'application/json' }
                });

                if (response.data.results && response.data.results.length > 0) {
                    movie = response.data.results[0];
                    console.log(`✅ TMDB: "${strategy.query}" (${strategy.lang}) -> ${movie.title}`);
                    break;
                }
            } catch (error) {
                console.warn(`⚠️ TMDB error con "${strategy.query}" (${strategy.lang}): ${error.message}`);
            }
        }

        if (!movie) {
            console.log(`❌ TMDB: no se encontró "${title}" con ninguna estrategia`);
            return null;
        }

        // Obtener detalles extendidos de la película (siempre en español)
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
            const extended = processTMDBExtendedData(details);
            runtime = extended.runtime;
            videos = extended.videos;
            recommendations = extended.recommendations;
            cast = extended.cast;
            collection = extended.collection;

            // Si encontramos por búsqueda en inglés, usar título español de los detalles
            if (details.title) {
                movie.title = details.title;
            }
            if (details.overview) {
                movie.overview = details.overview;
            }
        } catch (e) {
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
            runtime,
            videos,
            recommendations,
            cast,
            collection
        };

        // Actualizar colección si existe
        if (collection) {
            try {
                await collectionsManager.updateCollectionWithMovie(collection, { ...movieData, filename });
            } catch (e) {
                console.warn(`⚠️ Error actualizando colección para: ${title}`);
            }
        }

        return movieData;
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

        // Guardar en caché usando updateCacheEntry (no sobrescribe todo el cache)
        if (metadata) {
            const entryData = {
                ...metadata,
                cached_at: Date.now()
            };
            await updateCacheEntry(filename, entryData);
            return entryData;
        }

        return metadata;
    }

    return {
        readCache,
        writeCache,
        updateCacheEntry,
        cleanupCache,
        isCacheExpired,
        searchTMDB,
        getMovieMetadata
    };
}

module.exports = { createCacheManager };
