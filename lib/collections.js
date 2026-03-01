/**
 * lib/collections.js - Gestión de colecciones/sagas de películas
 *
 * Factory: recibe configuración y dependencias, devuelve funciones de gestión.
 * Usa SQLite via mediaDB en lugar de archivo JSON.
 */

/**
 * @param {Object} config
 * @param {Object} config.mediaDB - Instancia de db/media-db.js
 * @param {string} config.TMDB_BASE_URL - URL base de TMDB API
 * @param {string} config.TMDB_IMAGE_BASE - URL base para imágenes (ej: https://image.tmdb.org/t/p/w342)
 * @param {string} config.TMDB_API_KEY - API key de TMDB
 * @param {Function} config.tmdbFetch - Función fetch con rate limiting para TMDB
 */
function createCollectionsManager(config) {
    const { mediaDB, TMDB_BASE_URL, TMDB_IMAGE_BASE, TMDB_API_KEY, tmdbFetch } = config;

    async function readCollections() {
        try {
            return mediaDB.getAllCollections();
        } catch (error) {
            console.error('Error leyendo colecciones de SQLite:', error.message);
            return {};
        }
    }

    async function writeCollections(collections) {
        try {
            // Obtener IDs actuales en la BD para detectar eliminaciones
            const currentCollections = mediaDB.getAllCollections();
            const currentIds = new Set(Object.keys(currentCollections));
            const newIds = new Set(Object.keys(collections));

            // Eliminar colecciones que ya no existen en el objeto
            for (const id of currentIds) {
                if (!newIds.has(id)) {
                    mediaDB.deleteCollection(id);
                }
            }

            // Upsert todas las colecciones del objeto
            if (Object.keys(collections).length > 0) {
                mediaDB.upsertCollectionsBatch(collections);
            }
        } catch (error) {
            console.error('Error escribiendo colecciones a SQLite:', error.message);
            throw error;
        }
    }

    async function updateCollectionWithMovie(collectionInfo, movieData) {
        if (!collectionInfo || !collectionInfo.id) return;

        const collectionId = collectionInfo.id.toString();
        let collectionData = mediaDB.getCollection(collectionId);

        if (!collectionData) {
            // Nueva colección - obtener detalles completos de TMDB
            try {
                const response = await tmdbFetch(`${TMDB_BASE_URL}/collection/${collectionInfo.id}`, {
                    params: { api_key: TMDB_API_KEY, language: 'es-ES' },
                    timeout: 5000
                });

                const collData = response.data;
                collectionData = {
                    id: collData.id,
                    name: collData.name,
                    overview: collData.overview,
                    poster: collData.poster_path ? `/api/img/w342${collData.poster_path}` : null,
                    backdrop: collData.backdrop_path ? `/api/img/w780${collData.backdrop_path}` : null,
                    movies: [],
                    genre_ids: [],
                    cached_at: Date.now()
                };
                console.log(`📚 Nueva colección: ${collData.name}`);
            } catch (error) {
                // Si falla, crear con info básica
                collectionData = {
                    id: collectionInfo.id,
                    name: collectionInfo.name,
                    poster: collectionInfo.poster_path ? `/api/img/w342${collectionInfo.poster_path}` : null,
                    backdrop: collectionInfo.backdrop_path ? `/api/img/w780${collectionInfo.backdrop_path}` : null,
                    movies: [],
                    genre_ids: [],
                    cached_at: Date.now()
                };
            }
        }

        // Añadir película a la colección si no está
        const movieEntry = {
            filename: movieData.filename,
            tmdb_id: movieData.tmdb_id,
            title: movieData.title,
            poster: movieData.poster_path,
            release_date: movieData.release_date,
            genre_ids: movieData.genre_ids || []
        };

        const existingIndex = collectionData.movies.findIndex(m => m.filename === movieData.filename);
        if (existingIndex >= 0) {
            collectionData.movies[existingIndex] = movieEntry;
        } else {
            collectionData.movies.push(movieEntry);
        }

        // Actualizar géneros de la colección (unión de géneros de todas las películas)
        const allGenres = new Set(collectionData.genre_ids);
        (movieData.genre_ids || []).forEach(g => allGenres.add(g));
        collectionData.genre_ids = Array.from(allGenres);

        mediaDB.upsertCollection(collectionId, collectionData);
    }

    async function removeMovieFromCollections(filename) {
        const collections = mediaDB.getAllCollections();
        let modified = false;

        for (const collId of Object.keys(collections)) {
            const coll = collections[collId];
            const initialLength = coll.movies.length;
            coll.movies = coll.movies.filter(m => m.filename !== filename);

            if (coll.movies.length !== initialLength) {
                modified = true;
                console.log(`📚 Película eliminada de colección: ${coll.name}`);

                // Si la colección queda vacía, eliminarla
                if (coll.movies.length === 0) {
                    mediaDB.deleteCollection(collId);
                    console.log(`🗑️ Colección vacía eliminada: ${coll.name}`);
                } else {
                    // Recalcular géneros
                    const allGenres = new Set();
                    coll.movies.forEach(m => (m.genre_ids || []).forEach(g => allGenres.add(g)));
                    coll.genre_ids = Array.from(allGenres);
                    mediaDB.upsertCollection(collId, coll);
                }
            }
        }

        return modified;
    }

    return {
        readCollections,
        writeCollections,
        updateCollectionWithMovie,
        removeMovieFromCollections
    };
}

module.exports = { createCollectionsManager };
