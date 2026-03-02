/**
 * routes/collections.js - Rutas de colecciones/sagas de películas
 *
 * GET  /             - Listar colecciones
 * GET  /:id          - Detalle de colección
 * POST /generate     - Generar colecciones desde caché
 *
 * Montado en: /api/collections
 */

const express = require('express');
const router = express.Router();

module.exports = function createCollectionsRoutes(deps) {
    const {
        readCollections, updateCollectionWithMovie,
        readCache, writeCache,
        tmdbFetch, TMDB_BASE_URL, TMDB_API_KEY,
        mediaDB
    } = deps;

    // Listar colecciones
    router.get('/', async (req, res) => {
        try {
            const { genre } = req.query;
            const collections = await readCollections();

            let collectionsList = Object.keys(collections).map(key => ({
                ...collections[key],
                id: parseInt(key) || key
            }));

            // Filtrar por género si se especifica
            if (genre) {
                const genreId = parseInt(genre);
                collectionsList = collectionsList.filter(c =>
                    c.genre_ids && c.genre_ids.includes(genreId)
                );
            }

            // Ordenar por nombre
            collectionsList.sort((a, b) => a.name.localeCompare(b.name, 'es'));

            // Solo devolver colecciones que tienen películas
            collectionsList = collectionsList.filter(c => c.movies && c.movies.length > 0);

            console.log(`📚 Colecciones: ${collectionsList.length}${genre ? ` (género: ${genre})` : ''}`);
            res.json(collectionsList);

        } catch (error) {
            console.error('Error obteniendo colecciones:', error.message);
            res.status(500).json({ error: 'Error al obtener colecciones' });
        }
    });

    // Detalle completo de una colección (incluye películas no locales desde TMDB)
    // Usa caché SQLite con TTL de 14 días para evitar llamadas repetidas a TMDB
    router.get('/:id/full', async (req, res) => {
        try {
            const { id } = req.params;

            // Build set of local tmdb_ids from cache (always fresh)
            const movieCache = await readCache();
            const localTmdbIds = new Set();
            for (const filename of Object.keys(movieCache)) {
                const entry = movieCache[filename];
                if (entry.tmdb_id) {
                    localTmdbIds.add(entry.tmdb_id);
                }
            }

            // Check SQLite cache first
            let collectionData = mediaDB.getCollectionDetails(id);

            if (!collectionData) {
                // Cache miss or expired — fetch from TMDB
                const tmdbResponse = await tmdbFetch(`${TMDB_BASE_URL}/collection/${id}`, {
                    params: { api_key: TMDB_API_KEY, language: 'es-ES' },
                    timeout: 10000
                });
                const tmdbData = tmdbResponse.data;

                // Map TMDB parts, sorted by release_date ascending
                const parts = (tmdbData.parts || [])
                    .sort((a, b) => (a.release_date || '').localeCompare(b.release_date || ''))
                    .map(part => ({
                        tmdbId: part.id,
                        title: part.title,
                        release_date: part.release_date,
                        year: part.release_date ? part.release_date.substring(0, 4) : '',
                        poster: part.poster_path ? `/api/img/w342${part.poster_path}` : null,
                        overview: part.overview
                    }));

                collectionData = {
                    id: tmdbData.id,
                    name: tmdbData.name,
                    overview: tmdbData.overview,
                    poster: tmdbData.poster_path ? `/api/img/w342${tmdbData.poster_path}` : null,
                    parts: parts,
                    totalParts: parts.length
                };

                // Save to SQLite cache
                mediaDB.saveCollectionDetails(id, collectionData);
                console.log(`📚 Colección TMDB → caché: ${tmdbData.name} (${parts.length} películas)`);
            }

            // Always compute inCatalog fresh (catalog changes independently of TMDB data)
            const parts = collectionData.parts.map(part => ({
                ...part,
                inCatalog: localTmdbIds.has(part.tmdbId)
            }));

            const localParts = parts.filter(p => p.inCatalog).length;

            res.json({
                id: collectionData.id || parseInt(id),
                name: collectionData.name,
                overview: collectionData.overview,
                poster: collectionData.poster,
                parts: parts,
                totalParts: collectionData.totalParts,
                localParts: localParts
            });

        } catch (error) {
            console.error('Error obteniendo colección completa:', error.message);
            res.status(500).json({ error: 'Error al obtener colección completa' });
        }
    });

    // Detalle de una colección
    router.get('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const collections = await readCollections();

            const collection = collections[id];
            if (!collection) {
                return res.status(404).json({ error: 'Colección no encontrada' });
            }

            res.json(collection);

        } catch (error) {
            console.error('Error obteniendo colección:', error.message);
            res.status(500).json({ error: 'Error al obtener colección' });
        }
    });

    // Generar colecciones desde el caché existente
    router.post('/generate', async (req, res) => {
        try {
            console.log('📚 Generando colecciones desde caché existente...');

            const cache = await readCache();
            const filenames = Object.keys(cache);
            let collectionsFound = 0;
            let processed = 0;

            for (const filename of filenames) {
                const movieData = cache[filename];

                // Si ya tiene collection, saltar
                if (movieData.collection) {
                    await updateCollectionWithMovie(movieData.collection, {
                        ...movieData,
                        filename,
                        poster_path: movieData.poster_path
                    });
                    collectionsFound++;
                    processed++;
                    continue;
                }

                // Si tiene tmdb_id, buscar detalles para obtener colección
                if (movieData.tmdb_id) {
                    try {
                        const detailsResponse = await tmdbFetch(`${TMDB_BASE_URL}/movie/${movieData.tmdb_id}`, {
                            params: { api_key: TMDB_API_KEY, language: 'es-ES' },
                            timeout: 5000
                        });

                        if (detailsResponse.data.belongs_to_collection) {
                            const collection = detailsResponse.data.belongs_to_collection;

                            cache[filename].collection = {
                                id: collection.id,
                                name: collection.name,
                                poster_path: collection.poster_path,
                                backdrop_path: collection.backdrop_path
                            };

                            await updateCollectionWithMovie(collection, {
                                ...movieData,
                                filename,
                                poster_path: movieData.poster_path
                            });

                            collectionsFound++;
                        }

                        processed++;

                        if (processed % 10 === 0) {
                            console.log(`📊 Procesadas ${processed}/${filenames.length} películas, ${collectionsFound} colecciones encontradas`);
                        }

                        await new Promise(resolve => setTimeout(resolve, 350));

                    } catch (e) {
                        // Ignorar errores individuales
                    }
                }
            }

            // Guardar caché actualizado
            await writeCache(cache);

            const collections = await readCollections();
            const totalCollections = Object.keys(collections).length;

            console.log(`✅ Generación completada: ${totalCollections} colecciones, ${collectionsFound} películas en colecciones`);

            res.json({
                success: true,
                message: `Generadas ${totalCollections} colecciones con ${collectionsFound} películas`,
                totalCollections,
                moviesInCollections: collectionsFound
            });

        } catch (error) {
            console.error('Error generando colecciones:', error.message);
            res.status(500).json({ error: 'Error al generar colecciones' });
        }
    });

    return router;
};
