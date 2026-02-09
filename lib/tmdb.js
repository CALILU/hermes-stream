/**
 * lib/tmdb.js - Cliente TMDB unificado con rate limiter y búsqueda multi-estrategia
 *
 * Combina:
 * - Rate limiter de server.js (35 req/10s con cola)
 * - Fallback de API key de converter-server.js (timeout/401/429 → backup key)
 * - 5 estrategias de búsqueda de converter-server.js
 * - Búsqueda en inglés como fallback final
 */

const axios = require('axios');

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

/**
 * Crear un cliente TMDB con rate limiter integrado.
 *
 * @param {Object} config
 * @param {string} config.apiKey - TMDB API key principal
 * @param {string} [config.apiKeyBackup] - TMDB API key de respaldo
 * @param {number} [config.maxRequests=35] - Máx. peticiones por ventana
 * @param {number} [config.windowMs=10000] - Ventana de rate limit en ms
 * @returns {Object} cliente TMDB con métodos fetch y searchMovie
 */
function createTMDBClient(config) {
    const {
        apiKey,
        apiKeyBackup = null,
        maxRequests = 35,
        windowMs = 10000
    } = config;

    // ========== RATE LIMITER ==========
    const rateLimiter = {
        queue: [],
        timestamps: [],
        processing: false,

        async request(fn) {
            return new Promise((resolve, reject) => {
                this.queue.push({ fn, resolve, reject });
                this.processQueue();
            });
        },

        async processQueue() {
            if (this.processing || this.queue.length === 0) return;
            this.processing = true;

            while (this.queue.length > 0) {
                const now = Date.now();
                this.timestamps = this.timestamps.filter(t => now - t < windowMs);

                if (this.timestamps.length >= maxRequests) {
                    const waitTime = this.timestamps[0] + windowMs - now + 100;
                    console.log(`\u23F3 Rate limit TMDB: esperando ${waitTime}ms...`);
                    await new Promise(r => setTimeout(r, waitTime));
                    continue;
                }

                const { fn, resolve, reject } = this.queue.shift();
                this.timestamps.push(Date.now());

                try {
                    const result = await fn();
                    resolve(result);
                } catch (error) {
                    if (error.response?.status === 429) {
                        console.warn('\u26A0\uFE0F TMDB 429 - Reintentando en 2s...');
                        this.queue.unshift({ fn, resolve, reject });
                        await new Promise(r => setTimeout(r, 2000));
                    } else {
                        reject(error);
                    }
                }

                await new Promise(r => setTimeout(r, 100));
            }

            this.processing = false;
        }
    };

    /**
     * Fetch con rate limiting y fallback de API key.
     * Reemplaza tanto tmdbFetch (server.js) como tmdbRequest (converter-server.js).
     *
     * @param {string} url - URL completa de TMDB API
     * @param {Object} options - Opciones de axios (params, timeout, headers...)
     * @returns {Object} respuesta de axios
     */
    async function fetch(url, options = {}) {
        // Asegurar params y api_key
        if (!options.params) options.params = {};
        options.params.api_key = apiKey;

        return rateLimiter.request(async () => {
            try {
                return await axios.get(url, {
                    timeout: options.timeout || 10000,
                    ...options
                });
            } catch (error) {
                // Intentar key de respaldo si existe y el error lo amerita
                if (apiKeyBackup &&
                    (error.response?.status === 429 ||
                     error.response?.status === 401 ||
                     error.code === 'ECONNABORTED' ||
                     error.message?.includes('timeout'))) {
                    console.log('\uD83D\uDD04 Intentando key de respaldo TMDB...');
                    const backupOptions = { ...options, params: { ...options.params, api_key: apiKeyBackup } };
                    try {
                        return await axios.get(url, {
                            timeout: options.timeout || 10000,
                            ...backupOptions
                        });
                    } catch (backupError) {
                        console.warn('\u26A0\uFE0F Key de respaldo tambi\u00e9n fall\u00f3');
                        throw error;
                    }
                }
                throw error;
            }
        });
    }

    /**
     * Buscar película en TMDB con múltiples estrategias.
     * Combina las 5 estrategias de converter-server.js + fallback en inglés.
     *
     * @param {string} query - Título a buscar (ya limpio)
     * @param {string|null} year - Año de la película (opcional)
     * @returns {Object} { found: boolean, title?, year?, originalTitle?, tmdbId?, overview? }
     */
    async function searchMovie(query, year = null) {
        const searchStrategies = [
            { q: query, y: year },
            { q: query, y: null },
            { q: query.split(' ').slice(0, 3).join(' '), y: year },
            { q: query.split(' ').slice(0, 3).join(' '), y: null },
            { q: query.split(' ')[0], y: year },
        ];

        for (const strategy of searchStrategies) {
            if (!strategy.q || strategy.q.length < 2) continue;

            try {
                const params = {
                    language: 'es-ES',
                    query: strategy.q
                };
                if (strategy.y) {
                    params.year = strategy.y;
                }

                console.log(`[TMDB] Buscando: "${strategy.q}" (a\u00f1o: ${strategy.y || 'cualquiera'})`);
                const response = await fetch(`${TMDB_BASE_URL}/search/movie`, { params });
                const data = response.data;

                if (data.results && data.results.length > 0) {
                    const movie = data.results[0];
                    const releaseYear = movie.release_date ? movie.release_date.substring(0, 4) : '';

                    const cleanTitle = movie.title
                        .replace(/[<>:"/\\|?*]/g, '')
                        .replace(/\s+/g, ' ')
                        .trim();

                    console.log(`[TMDB] \u2713 Encontrado: "${cleanTitle}" (${releaseYear})`);
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
                console.error('[TMDB] Error en b\u00fasqueda:', error.message);
            }
        }

        // Último intento: buscar en inglés
        try {
            console.log(`[TMDB] Buscando en ingl\u00e9s: "${query}"`);
            const response = await fetch(`${TMDB_BASE_URL}/search/movie`, {
                params: { language: 'en-US', query: query }
            });
            const data = response.data;

            if (data.results && data.results.length > 0) {
                const movie = data.results[0];
                const releaseYear = movie.release_date ? movie.release_date.substring(0, 4) : '';

                // Obtener título en español
                const detailResponse = await fetch(`${TMDB_BASE_URL}/movie/${movie.id}`, {
                    params: { language: 'es-ES' }
                });
                const detailData = detailResponse.data;

                const spanishTitle = detailData.title || movie.title;
                const cleanTitle = spanishTitle
                    .replace(/[<>:"/\\|?*]/g, '')
                    .replace(/\s+/g, ' ')
                    .trim();

                console.log(`[TMDB] \u2713 Encontrado (EN\u2192ES): "${cleanTitle}" (${releaseYear})`);
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
            console.error('[TMDB] Error en b\u00fasqueda ingl\u00e9s:', error.message);
        }

        console.log(`[TMDB] \u2717 No encontrado: "${query}"`);
        return { found: false };
    }

    return {
        fetch,
        searchMovie,
        TMDB_BASE_URL
    };
}

module.exports = { createTMDBClient, TMDB_BASE_URL };
