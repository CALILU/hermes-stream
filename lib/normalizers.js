/**
 * lib/normalizers.js - Normalización de campos entre cache (snake_case TMDB) y API (camelCase)
 *
 * cache.json almacena datos en formato TMDB nativo (snake_case).
 * La API pública devuelve campos en camelCase.
 * Este módulo convierte entre ambos formatos.
 */

const { ensureFullPosterURL, TMDB_IMAGE_BASE, CAST_LIMIT } = require('./utils');

/**
 * Normalizar entrada de cache (snake_case TMDB) a formato API (camelCase).
 * Se usa al leer datos del cache para enviarlos al frontend.
 */
function normalizeCacheToAPI(cached) {
    if (!cached) return null;
    return {
        tmdbId: cached.tmdb_id || cached.tmdbId || null,
        title: cached.title || null,
        overview: cached.overview || null,
        poster: ensureFullPosterURL(cached.poster || cached.poster_path, 'w342'),
        backdrop: ensureFullPosterURL(cached.backdrop || cached.backdrop_path, 'w780'),
        releaseDate: cached.releaseDate || cached.release_date || null,
        rating: cached.rating || cached.vote_average || null,
        genreIds: cached.genreIds || cached.genre_ids || [],
        runtime: cached.runtime || null,
        videos: cached.videos || [],
        recommendations: normalizeRecommendations(cached.recommendations || []),
        cast: cached.cast || [],
        collection: cached.collection || null,
        cached_at: cached.cached_at || null,
        videoCodec: cached.video_codec || null,
        audioCodec: cached.audio_codec || null,
        audioChannels: cached.audio_channels || null,
        width: cached.width || null,
        height: cached.height || null
    };
}

/**
 * Normalizar array de recomendaciones de snake_case a camelCase.
 */
function normalizeRecommendations(recommendations) {
    return recommendations.map(rec => ({
        tmdbId: rec.tmdb_id || rec.tmdbId || null,
        title: rec.title || null,
        overview: rec.overview || '',
        poster: ensureFullPosterURL(rec.poster || rec.poster_path, 'w342'),
        releaseDate: rec.release_date || rec.releaseDate || null,
        rating: rec.vote_average || rec.rating || null
    }));
}

/**
 * Procesar respuesta extendida de TMDB (videos, recomendaciones, cast, colección).
 * Se usa en searchTMDB, searchTVShowTMDB, y update-poster para evitar duplicar código.
 *
 * @param {Object} details - Respuesta de TMDB /movie/{id}?append_to_response=videos,recommendations,credits
 * @param {Object} options - { imageBase: string, castLimit: number }
 * @returns {Object} { runtime, videos, recommendations, cast, collection }
 */
function processTMDBExtendedData(details, options = {}) {
    const imageBase = options.imageBase || `${TMDB_IMAGE_BASE}/w342`;
    const castLimit = options.castLimit || CAST_LIMIT;

    const result = {
        runtime: details.runtime || null,
        videos: [],
        recommendations: [],
        cast: [],
        collection: null
    };

    // Videos (trailers, clips) - solo YouTube
    if (details.videos?.results) {
        result.videos = details.videos.results
            .filter(v => v.site === 'YouTube' && ['Trailer', 'Teaser', 'Clip'].includes(v.type))
            .slice(0, 5)
            .map(v => ({
                key: v.key,
                name: v.name,
                type: v.type,
                url: `https://www.youtube.com/watch?v=${v.key}`
            }));
    }

    // Recomendaciones - almacenar en snake_case (formato cache nativo)
    if (details.recommendations?.results) {
        result.recommendations = details.recommendations.results
            .slice(0, 10)
            .map(r => ({
                tmdb_id: r.id,
                title: r.title,
                overview: r.overview || '',
                poster_path: r.poster_path ? `/api/img/w342${r.poster_path}` : null,
                release_date: r.release_date,
                vote_average: r.vote_average
            }));
    }

    // Reparto (cast)
    if (details.credits?.cast) {
        result.cast = details.credits.cast
            .slice(0, castLimit)
            .map(actor => ({
                id: actor.id,
                name: actor.name,
                character: actor.character,
                photo: actor.profile_path ? `/api/img/h632${actor.profile_path}` : null
            }));
    }

    // Colección/Saga
    if (details.belongs_to_collection) {
        result.collection = {
            id: details.belongs_to_collection.id,
            name: details.belongs_to_collection.name,
            poster_path: details.belongs_to_collection.poster_path,
            backdrop_path: details.belongs_to_collection.backdrop_path
        };
    }

    return result;
}

module.exports = {
    normalizeCacheToAPI,
    normalizeRecommendations,
    processTMDBExtendedData
};
