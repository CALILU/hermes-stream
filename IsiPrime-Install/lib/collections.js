/**
 * lib/collections.js - Gestión de colecciones/sagas de películas
 *
 * Factory: recibe configuración y dependencias, devuelve funciones de gestión.
 */

const fs = require('fs').promises;

/**
 * @param {Object} config
 * @param {string} config.COLLECTIONS_FILE - Ruta al archivo collections.json
 * @param {string} config.TMDB_BASE_URL - URL base de TMDB API
 * @param {string} config.TMDB_IMAGE_BASE - URL base para imágenes (ej: https://image.tmdb.org/t/p/w342)
 * @param {string} config.TMDB_API_KEY - API key de TMDB
 * @param {Function} config.tmdbFetch - Función fetch con rate limiting para TMDB
 */
function createCollectionsManager(config) {
    const { COLLECTIONS_FILE, TMDB_BASE_URL, TMDB_IMAGE_BASE, TMDB_API_KEY, tmdbFetch } = config;

    async function readCollections() {
        try {
            const data = await fs.readFile(COLLECTIONS_FILE, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            return {};
        }
    }

    async function writeCollections(collections) {
        await fs.writeFile(COLLECTIONS_FILE, JSON.stringify(collections, null, 2));
    }

    async function updateCollectionWithMovie(collectionInfo, movieData) {
        if (!collectionInfo || !collectionInfo.id) return;

        const collections = await readCollections();
        const collectionId = collectionInfo.id.toString();

        if (!collections[collectionId]) {
            // Nueva colección - obtener detalles completos de TMDB
            try {
                const response = await tmdbFetch(`${TMDB_BASE_URL}/collection/${collectionInfo.id}`, {
                    params: { api_key: TMDB_API_KEY, language: 'es-ES' },
                    timeout: 5000
                });

                const collData = response.data;
                collections[collectionId] = {
                    id: collData.id,
                    name: collData.name,
                    overview: collData.overview,
                    poster: collData.poster_path ? `${TMDB_IMAGE_BASE}${collData.poster_path}` : null,
                    backdrop: collData.backdrop_path ? `${TMDB_IMAGE_BASE}${collData.backdrop_path}` : null,
                    movies: [],
                    genre_ids: [],
                    cached_at: Date.now()
                };
                console.log(`📚 Nueva colección: ${collData.name}`);
            } catch (error) {
                // Si falla, crear con info básica
                collections[collectionId] = {
                    id: collectionInfo.id,
                    name: collectionInfo.name,
                    poster: collectionInfo.poster_path ? `${TMDB_IMAGE_BASE}${collectionInfo.poster_path}` : null,
                    backdrop: collectionInfo.backdrop_path ? `${TMDB_IMAGE_BASE}${collectionInfo.backdrop_path}` : null,
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

        const existingIndex = collections[collectionId].movies.findIndex(m => m.filename === movieData.filename);
        if (existingIndex >= 0) {
            collections[collectionId].movies[existingIndex] = movieEntry;
        } else {
            collections[collectionId].movies.push(movieEntry);
        }

        // Actualizar géneros de la colección (unión de géneros de todas las películas)
        const allGenres = new Set(collections[collectionId].genre_ids);
        (movieData.genre_ids || []).forEach(g => allGenres.add(g));
        collections[collectionId].genre_ids = Array.from(allGenres);

        await writeCollections(collections);
    }

    async function removeMovieFromCollections(filename) {
        const collections = await readCollections();
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
                    delete collections[collId];
                    console.log(`🗑️ Colección vacía eliminada: ${coll.name}`);
                } else {
                    // Recalcular géneros
                    const allGenres = new Set();
                    coll.movies.forEach(m => (m.genre_ids || []).forEach(g => allGenres.add(g)));
                    coll.genre_ids = Array.from(allGenres);
                }
            }
        }

        if (modified) {
            await writeCollections(collections);
        }
    }

    return {
        readCollections,
        writeCollections,
        updateCollectionWithMovie,
        removeMovieFromCollections
    };
}

module.exports = { createCollectionsManager };
