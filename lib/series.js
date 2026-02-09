/**
 * lib/series.js - Gestión de series de TV (caché, episodios, TMDB)
 *
 * Factory: recibe configuración y dependencias, devuelve funciones de gestión.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

// Géneros de series (TMDB usa IDs diferentes para TV)
const TV_GENRES = [
    { id: 10759, name: 'Acción y Aventura' },
    { id: 16, name: 'Animación' },
    { id: 35, name: 'Comedia' },
    { id: 80, name: 'Crimen' },
    { id: 99, name: 'Documental' },
    { id: 18, name: 'Drama' },
    { id: 10751, name: 'Familia' },
    { id: 10762, name: 'Infantil' },
    { id: 9648, name: 'Misterio' },
    { id: 10763, name: 'Noticias' },
    { id: 10764, name: 'Reality' },
    { id: 10765, name: 'Ciencia ficción y Fantasía' },
    { id: 10766, name: 'Telenovela' },
    { id: 10767, name: 'Talk Show' },
    { id: 10768, name: 'Bélica y Política' },
    { id: 37, name: 'Western' }
];

/**
 * @param {Object} config
 * @param {string} config.CACHE_SERIES_FILE - Ruta al archivo cache-series.json
 * @param {string} config.SERIES_EPISODES_FILE - Ruta al archivo series-episodes.json
 * @param {string} config.SERIES_FOLDER - Nombre de la carpeta de series (ej: 'Series')
 * @param {string} config.TMDB_BASE_URL - URL base de TMDB API
 * @param {string} config.TMDB_IMAGE_BASE - URL base para imágenes TMDB
 * @param {string} config.TMDB_API_KEY - API key de TMDB
 * @param {Function} config.tmdbFetch - Función fetch con rate limiting para TMDB
 * @param {Object} config.storageConfig - Configuración de almacenamiento (por referencia, mutable)
 * @param {Object} config.FTP_CONFIG - Configuración FTP
 * @param {Function} config.withFTPClient - Helper FTP auto-gestionado
 */
function createSeriesManager(config) {
    const {
        CACHE_SERIES_FILE, SERIES_EPISODES_FILE, SERIES_FOLDER,
        TMDB_BASE_URL, TMDB_IMAGE_BASE, TMDB_API_KEY,
        tmdbFetch, storageConfig, FTP_CONFIG, withFTPClient
    } = config;

    async function readSeriesCache() {
        try {
            const data = await fs.readFile(CACHE_SERIES_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    async function writeSeriesCache(cache) {
        await fs.writeFile(CACHE_SERIES_FILE, JSON.stringify(cache, null, 2));
    }

    async function updateSeriesCacheEntry(seriesName, data) {
        const cache = await readSeriesCache();
        cache[seriesName] = { ...data, cached_at: Date.now() };
        await writeSeriesCache(cache);
    }

    async function readSeriesEpisodes() {
        try {
            const data = await fs.readFile(SERIES_EPISODES_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    async function writeSeriesEpisodes(episodes) {
        await fs.writeFile(SERIES_EPISODES_FILE, JSON.stringify(episodes, null, 2));
    }

    function parseSeriesFilename(filename) {
        const match = filename.match(/^(.+?)[.\s_-]S(\d{1,2})E(\d{1,2})/i);
        if (!match) return null;

        return {
            seriesName: match[1].replace(/[._]/g, ' ').trim(),
            season: parseInt(match[2], 10),
            episode: parseInt(match[3], 10),
            filename: filename
        };
    }

    async function searchTVShowTMDB(seriesName) {
        try {
            const searchResponse = await tmdbFetch(`${TMDB_BASE_URL}/search/tv`, {
                params: {
                    api_key: TMDB_API_KEY,
                    query: seriesName,
                    language: 'es-ES',
                    include_adult: false
                },
                timeout: 10000
            });

            if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
                console.log(`❌ Serie no encontrada en TMDB: ${seriesName}`);
                return null;
            }

            const tvShow = searchResponse.data.results[0];
            console.log(`📺 Serie encontrada: ${tvShow.name} (${tvShow.id})`);

            const detailsResponse = await tmdbFetch(`${TMDB_BASE_URL}/tv/${tvShow.id}`, {
                params: {
                    api_key: TMDB_API_KEY,
                    language: 'es-ES',
                    append_to_response: 'videos,recommendations,credits'
                },
                timeout: 10000
            });

            const details = detailsResponse.data;

            const videos = (details.videos?.results || [])
                .filter(v => v.site === 'YouTube' && ['Trailer', 'Teaser', 'Clip'].includes(v.type))
                .slice(0, 5)
                .map(v => ({
                    key: v.key,
                    name: v.name,
                    type: v.type,
                    url: `https://www.youtube.com/watch?v=${v.key}`
                }));

            const cast = (details.credits?.cast || [])
                .slice(0, 15)
                .map(actor => ({
                    id: actor.id,
                    name: actor.name,
                    character: actor.character,
                    photo: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : null
                }));

            const recommendations = (details.recommendations?.results || [])
                .slice(0, 10)
                .map(rec => ({
                    tmdb_id: rec.id,
                    title: rec.name,
                    overview: rec.overview,
                    poster: rec.poster_path ? `${TMDB_IMAGE_BASE}${rec.poster_path}` : null,
                    vote_average: rec.vote_average
                }));

            const seriesData = {
                tmdb_id: details.id,
                title: details.name,
                original_title: details.original_name,
                overview: details.overview,
                poster: details.poster_path ? `${TMDB_IMAGE_BASE}${details.poster_path}` : null,
                backdrop: details.backdrop_path ? `${TMDB_IMAGE_BASE}${details.backdrop_path}` : null,
                first_air_date: details.first_air_date,
                last_air_date: details.last_air_date,
                vote_average: details.vote_average,
                genre_ids: (details.genres || []).map(g => g.id),
                genres: (details.genres || []).map(g => g.name),
                status: details.status,
                number_of_seasons: details.number_of_seasons,
                number_of_episodes: details.number_of_episodes,
                episode_runtime: details.episode_run_time?.[0] || 45,
                networks: (details.networks || []).map(n => ({ id: n.id, name: n.name, logo: n.logo_path ? `${TMDB_IMAGE_BASE}${n.logo_path}` : null })),
                created_by: (details.created_by || []).map(c => ({ id: c.id, name: c.name })),
                cast,
                videos,
                recommendations,
                seasons_info: (details.seasons || []).filter(s => s.season_number > 0).map(s => ({
                    season_number: s.season_number,
                    name: s.name,
                    episode_count: s.episode_count,
                    poster: s.poster_path ? `${TMDB_IMAGE_BASE}${s.poster_path}` : null,
                    air_date: s.air_date
                }))
            };

            return seriesData;
        } catch (error) {
            console.error(`Error buscando serie ${seriesName}:`, error.message);
            return null;
        }
    }

    async function getSeasonEpisodesTMDB(tmdbId, seasonNumber) {
        try {
            const response = await tmdbFetch(`${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNumber}`, {
                params: {
                    api_key: TMDB_API_KEY,
                    language: 'es-ES'
                },
                timeout: 10000
            });

            const season = response.data;
            return {
                season_number: season.season_number,
                name: season.name,
                overview: season.overview,
                poster: season.poster_path ? `${TMDB_IMAGE_BASE}${season.poster_path}` : null,
                air_date: season.air_date,
                episodes: (season.episodes || []).map(ep => ({
                    episode_number: ep.episode_number,
                    name: ep.name,
                    overview: ep.overview,
                    air_date: ep.air_date,
                    runtime: ep.runtime,
                    still: ep.still_path ? `${TMDB_IMAGE_BASE}${ep.still_path}` : null,
                    vote_average: ep.vote_average,
                    watched: false,
                    progress: 0,
                    filename: null,
                    available: false
                }))
            };
        } catch (error) {
            console.error(`Error obteniendo temporada ${seasonNumber}:`, error.message);
            return null;
        }
    }

    async function scanSeriesFolder(folderName) {
        const files = [];
        const extensions = ['.mp4', '.mkv', '.avi', '.mov'];

        if (storageConfig.mode === 'local' && fsSync.existsSync(storageConfig.localPath)) {
            const seriesPath = path.join(storageConfig.localPath, SERIES_FOLDER, folderName);
            try {
                const entries = await fs.readdir(seriesPath, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isFile() && extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
                        const stats = await fs.stat(path.join(seriesPath, entry.name));
                        files.push({ name: entry.name, size: `${(stats.size / (1024 * 1024)).toFixed(1)} MB` });
                    }
                }
            } catch (e) {
                console.log(`Error escaneando carpeta ${folderName}:`, e.message);
            }
        } else {
            try {
                const seriesPath = `/volume-1/${SERIES_FOLDER}/${folderName}`;
                const list = await withFTPClient(FTP_CONFIG, async (client) => {
                    return await client.list(seriesPath);
                });
                list.filter(item => !item.isDirectory && extensions.some(ext => item.name.toLowerCase().endsWith(ext)))
                    .forEach(item => files.push({ name: item.name, size: `${(item.size / (1024 * 1024)).toFixed(1)} MB` }));
            } catch (e) {
                console.log(`Error FTP escaneando ${folderName}:`, e.message);
            }
        }

        return files;
    }

    return {
        readSeriesCache,
        writeSeriesCache,
        updateSeriesCacheEntry,
        readSeriesEpisodes,
        writeSeriesEpisodes,
        parseSeriesFilename,
        searchTVShowTMDB,
        getSeasonEpisodesTMDB,
        scanSeriesFolder,
        TV_GENRES
    };
}

module.exports = { createSeriesManager, TV_GENRES };
