/**
 * lib/cache.js - Gestion de cache de peliculas (SQLite via db/media-db.js)
 *
 * Factory: recibe configuracion y dependencias, devuelve funciones de gestion.
 */

/**
 * Mapea campos del formato interno (cast, collection) al formato DB (cast_json, collection_json)
 * @param {Object} data
 * @returns {Object}
 */
function mapToDbFields(data) {
    if (!data) return data;
    const mapped = { ...data };
    if ('cast' in mapped) {
        mapped.cast_json = mapped.cast;
        delete mapped.cast;
    }
    if ('collection' in mapped) {
        mapped.collection_json = mapped.collection;
        delete mapped.collection;
    }
    return mapped;
}

/**
 * Mapea campos del formato DB (cast_json, collection_json) al formato interno (cast, collection)
 * @param {Object} data
 * @returns {Object}
 */
function mapFromDbFields(data) {
    if (!data) return data;
    const mapped = { ...data };
    if ('cast_json' in mapped) {
        mapped.cast = mapped.cast_json;
        delete mapped.cast_json;
    }
    if ('collection_json' in mapped) {
        mapped.collection = mapped.collection_json;
        delete mapped.collection_json;
    }
    return mapped;
}

/**
 * Mapea un objeto completo de cache { filename: movieData } de formato DB a formato interno
 * @param {Object} cacheObj
 * @returns {Object}
 */
function mapCacheFromDb(cacheObj) {
    const result = {};
    for (const [filename, data] of Object.entries(cacheObj)) {
        result[filename] = mapFromDbFields(data);
    }
    return result;
}

/**
 * Mapea un objeto completo de cache { filename: movieData } de formato interno a formato DB
 * @param {Object} cacheObj
 * @returns {Object}
 */
function mapCacheToDb(cacheObj) {
    const result = {};
    for (const [filename, data] of Object.entries(cacheObj)) {
        result[filename] = mapToDbFields(data);
    }
    return result;
}

/**
 * @param {Object} config
 * @param {Object} config.mediaDB - Instancia de db/media-db.js
 * @param {number} config.CACHE_TTL - Tiempo de vida del cache en ms
 * @param {string} config.TMDB_BASE_URL - URL base de TMDB API
 * @param {string} config.TMDB_IMAGE_BASE - URL base para imagenes TMDB
 * @param {string} config.TMDB_API_KEY - API key de TMDB
 * @param {Function} config.tmdbFetch - Funcion fetch con rate limiting para TMDB
 * @param {Function} config.processTMDBExtendedData - Procesa datos extendidos de TMDB
 * @param {Function} config.cleanFilenameForSearch - Limpia nombre de archivo para busqueda
 * @param {Object} config.collectionsManager - { updateCollectionWithMovie }
 */
function createCacheManager(config) {
    const {
        mediaDB, CACHE_TTL, TMDB_BASE_URL, TMDB_IMAGE_BASE, TMDB_API_KEY,
        tmdbFetch, processTMDBExtendedData, cleanFilenameForSearch, collectionsManager
    } = config;

    async function readCache() {
        try {
            const allMovies = mediaDB.getAllMovies();
            return mapCacheFromDb(allMovies);
        } catch (error) {
            console.error('Error leyendo cache desde SQLite:', error.message);
            return {};
        }
    }

    // Sobrescribe TODO el cache. Para actualizar una sola entrada, usar updateCacheEntry.
    // Si se pasa un objeto vacio, limpia todo el cache.
    // Cache se almacena en formato TMDB nativo (snake_case).
    // La normalizacion a camelCase se hace al leer (normalizeCacheToAPI).
    async function writeCache(cache) {
        try {
            if (Object.keys(cache).length === 0) {
                // Limpiar todo el cache
                mediaDB.clearMovies();
            } else {
                // Escribir en batch con mapeo de campos
                mediaDB.upsertMoviesBatch(mapCacheToDb(cache));
            }
        } catch (error) {
            console.error('Error escribiendo cache en SQLite:', error.message);
            throw error;
        }
    }

    // Actualizar una sola entrada del cache sin sobrescribir las demas.
    // Si merge=true, combina con datos existentes; si merge=false, reemplaza completamente.
    async function updateCacheEntry(filename, data, merge = false) {
        try {
            let finalData = data;

            if (merge) {
                const existing = mediaDB.getMovie(filename);
                if (existing) {
                    // Mapear existente de DB a formato interno, mezclar, luego mapear a DB
                    finalData = { ...mapFromDbFields(existing), ...data };
                }
            }

            mediaDB.upsertMovie(filename, mapToDbFields(finalData));
        } catch (error) {
            console.error(`Error actualizando cache para ${filename}:`, error.message);
            throw error;
        }
    }

    // Limpiar cache de entradas huerfanas (peliculas que ya no existen)
    async function cleanupCache(existingFiles) {
        try {
            const existingFilenames = existingFiles.map(f => f.name || f);
            const removed = mediaDB.cleanupMovies(existingFilenames);

            if (removed > 0) {
                console.log(`✅ Caché limpiado: ${removed} entradas huérfanas eliminadas`);
            }

            // Contar las que quedan
            const allMovies = mediaDB.getAllMovies();
            const remaining = Object.keys(allMovies).length;

            return { removed, remaining };
        } catch (error) {
            console.error('Error limpiando cache:', error.message);
            throw error;
        }
    }

    function isCacheExpired(cacheEntry) {
        if (!cacheEntry || !cacheEntry.cached_at) {
            return true;
        }
        const now = Date.now();
        const cacheAge = now - cacheEntry.cached_at;
        return cacheAge > CACHE_TTL;
    }

    // Buscar pelicula en TMDB con multiples estrategias
    async function searchTMDB(filename) {
        const { name: title, year } = cleanFilenameForSearch(filename);

        // Multiples estrategias de busqueda (mas especifica -> mas laxa)
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

        // Obtener detalles extendidos de la pelicula (siempre en espanol)
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

            // Si encontramos por busqueda en ingles, usar titulo espanol de los detalles
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

        // Actualizar coleccion si existe
        if (collection) {
            try {
                await collectionsManager.updateCollectionWithMovie(collection, { ...movieData, filename });
            } catch (e) {
                console.warn(`⚠️ Error actualizando colección para: ${title}`);
            }
        }

        return movieData;
    }

    // Obtener metadata con cache y TTL
    async function getMovieMetadata(filename) {
        // Leer directamente la entrada individual desde SQLite
        const cachedEntry = mediaDB.getMovie(filename);
        const mapped = cachedEntry ? mapFromDbFields(cachedEntry) : null;

        // Si esta en cache y no ha expirado, devolverlo
        if (mapped && !isCacheExpired(mapped)) {
            console.log(`💾 Caché válido para: ${filename}`);
            return mapped;
        }

        // Si no esta o expiro, buscar en TMDB
        console.log(`🔍 Buscando en TMDB: ${filename}`);
        const metadata = await searchTMDB(filename);

        // Guardar en cache usando updateCacheEntry (no sobrescribe todo el cache)
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
