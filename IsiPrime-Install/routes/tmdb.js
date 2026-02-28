/**
 * routes/tmdb.js - Rutas de búsqueda TMDB (películas, actores, cast)
 *
 * GET /search       - Buscar películas
 * GET /cast/:tmdbId - Obtener cast por TMDB ID
 * GET /cast-by-title - Obtener cast buscando por título
 * GET /actor        - Buscar actores y su filmografía
 *
 * Montado en: /api/tmdb
 */

const express = require('express');
const router = express.Router();

module.exports = function createTMDBRoutes(deps) {
    const { tmdbFetch, TMDB_BASE_URL, TMDB_IMAGE_BASE, TMDB_API_KEY, updateCacheEntry } = deps;

    // Búsqueda manual de películas en TMDB
    router.get('/search', async (req, res) => {
        try {
            let { query, year } = req.query;

            if (!query || query.trim().length < 2) {
                return res.status(400).json({ error: 'Se requiere un término de búsqueda' });
            }

            let searchQuery = query.trim();
            let searchYear = year || null;

            const yearInParens = searchQuery.match(/\((\d{4})\)\s*$/);
            if (yearInParens) {
                searchYear = yearInParens[1];
                searchQuery = searchQuery.replace(/\s*\(\d{4}\)\s*$/, '').trim();
            }

            console.log(`🔎 Búsqueda manual TMDB: "${searchQuery}"${searchYear ? ` (año: ${searchYear})` : ''}`);

            const searchUrl = `${TMDB_BASE_URL}/search/movie`;
            const params = {
                api_key: TMDB_API_KEY,
                query: searchQuery,
                language: 'es-ES',
                include_adult: false
            };

            if (searchYear) {
                params.year = searchYear;
            }

            const response = await tmdbFetch(searchUrl, {
                params,
                timeout: 30000
            });

            if (response.data.results && response.data.results.length > 0) {
                const results = response.data.results.slice(0, 12).map(movie => ({
                    tmdbId: movie.id,
                    title: movie.title,
                    originalTitle: movie.original_title,
                    overview: movie.overview ? movie.overview.substring(0, 200) + '...' : null,
                    poster: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
                    backdrop: movie.backdrop_path ? `${TMDB_IMAGE_BASE}${movie.backdrop_path}` : null,
                    releaseDate: movie.release_date,
                    year: movie.release_date ? movie.release_date.substring(0, 4) : null,
                    rating: movie.vote_average,
                    genreIds: movie.genre_ids || []
                }));

                console.log(`✅ Encontrados ${results.length} resultados para "${query}"`);
                res.json({ success: true, results });
            } else {
                console.log(`❌ Sin resultados para "${query}"`);
                res.json({ success: true, results: [] });
            }

        } catch (error) {
            console.error('Error en búsqueda TMDB:', error.message);
            res.status(500).json({ error: 'Error al buscar en TMDB' });
        }
    });

    // Búsqueda manual de series en TMDB
    router.get('/search-tv', async (req, res) => {
        try {
            let { query, year } = req.query;

            if (!query || query.trim().length < 2) {
                return res.status(400).json({ error: 'Se requiere un término de búsqueda' });
            }

            let searchQuery = query.trim();
            let searchYear = year || null;

            const yearInParens = searchQuery.match(/\((\d{4})\)\s*$/);
            if (yearInParens) {
                searchYear = yearInParens[1];
                searchQuery = searchQuery.replace(/\s*\(\d{4}\)\s*$/, '').trim();
            }

            console.log(`🔎 Búsqueda manual TMDB (TV): "${searchQuery}"${searchYear ? ` (año: ${searchYear})` : ''}`);

            const params = {
                api_key: TMDB_API_KEY,
                query: searchQuery,
                language: 'es-ES',
                include_adult: false
            };

            if (searchYear) {
                params.first_air_date_year = searchYear;
            }

            const response = await tmdbFetch(`${TMDB_BASE_URL}/search/tv`, {
                params,
                timeout: 30000
            });

            if (response.data.results && response.data.results.length > 0) {
                const results = response.data.results.slice(0, 12).map(show => ({
                    tmdbId: show.id,
                    title: show.name,
                    originalTitle: show.original_name,
                    overview: show.overview ? show.overview.substring(0, 200) + '...' : null,
                    poster: show.poster_path ? `${TMDB_IMAGE_BASE}${show.poster_path}` : null,
                    backdrop: show.backdrop_path ? `${TMDB_IMAGE_BASE}${show.backdrop_path}` : null,
                    firstAirDate: show.first_air_date,
                    year: show.first_air_date ? show.first_air_date.substring(0, 4) : null,
                    rating: show.vote_average,
                    genreIds: show.genre_ids || []
                }));

                console.log(`✅ Encontradas ${results.length} series para "${query}"`);
                res.json({ success: true, results });
            } else {
                console.log(`❌ Sin resultados de series para "${query}"`);
                res.json({ success: true, results: [] });
            }

        } catch (error) {
            console.error('Error en búsqueda TMDB (TV):', error.message);
            res.status(500).json({ error: 'Error al buscar series en TMDB' });
        }
    });

    // Obtener cast de una película por TMDB ID
    router.get('/cast/:tmdbId', async (req, res) => {
        try {
            const { tmdbId } = req.params;

            if (!tmdbId) {
                return res.status(400).json({ error: 'Se requiere TMDB ID' });
            }

            console.log(`🎭 Obteniendo cast para TMDB ID: ${tmdbId}`);

            const response = await tmdbFetch(`${TMDB_BASE_URL}/movie/${tmdbId}/credits`, {
                params: { language: 'es-ES' }
            });

            if (response.data.cast) {
                const cast = response.data.cast
                    .slice(0, 20)
                    .map(actor => ({
                        id: actor.id,
                        name: actor.name,
                        character: actor.character,
                        photo: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : null
                    }));

                const { filename } = req.query;
                if (filename) {
                    await updateCacheEntry(filename, { cast }, true);
                    console.log(`✅ Cast guardado en cache para: ${filename}`);
                }

                res.json({ success: true, cast });
            } else {
                res.json({ success: true, cast: [] });
            }
        } catch (error) {
            console.error('Error obteniendo cast:', error.message);
            res.status(500).json({ error: 'Error al obtener cast de TMDB' });
        }
    });

    // Obtener cast buscando por título
    router.get('/cast-by-title', async (req, res) => {
        try {
            const { title, year, filename } = req.query;

            if (!title) {
                return res.status(400).json({ error: 'Se requiere título' });
            }

            console.log(`🎭 Buscando cast por título: "${title}" (${year || 'sin año'})`);

            const searchParams = {
                params: {
                    language: 'es-ES',
                    query: title
                }
            };
            if (year) {
                searchParams.params.year = year;
            }

            const searchResponse = await tmdbFetch(`${TMDB_BASE_URL}/search/movie`, searchParams);
            const results = searchResponse.data.results;

            if (!results || results.length === 0) {
                console.log(`❌ No se encontró película: "${title}"`);
                return res.json({ success: false, error: 'Película no encontrada en TMDB', cast: [] });
            }

            const movie = results[0];
            const tmdbId = movie.id;
            console.log(`✅ Encontrado: "${movie.title}" (${movie.release_date?.substring(0, 4)}) - ID: ${tmdbId}`);

            const creditsResponse = await tmdbFetch(`${TMDB_BASE_URL}/movie/${tmdbId}/credits`, {
                params: { language: 'es-ES' }
            });

            const cast = (creditsResponse.data.cast || [])
                .slice(0, 20)
                .map(actor => ({
                    id: actor.id,
                    name: actor.name,
                    character: actor.character,
                    photo: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : null
                }));

            if (filename) {
                const updateData = {
                    tmdb_id: tmdbId,
                    cast,
                    title: movie.title,
                    year: movie.release_date?.substring(0, 4),
                    overview: movie.overview
                };
                if (movie.poster_path) {
                    updateData.poster = `${TMDB_IMAGE_BASE}${movie.poster_path}`;
                }
                await updateCacheEntry(filename, updateData, true);
                console.log(`✅ Metadatos actualizados en cache para: ${filename}`);
            }

            res.json({
                success: true,
                cast,
                tmdbId: tmdbId,
                title: movie.title,
                year: movie.release_date?.substring(0, 4)
            });
        } catch (error) {
            console.error('Error buscando cast por título:', error.message);
            res.status(500).json({ error: 'Error al buscar en TMDB' });
        }
    });

    // Buscar actores y obtener sus películas
    router.get('/actor', async (req, res) => {
        try {
            const { query } = req.query;

            if (!query || query.trim().length < 2) {
                return res.status(400).json({ error: 'Se requiere nombre del actor' });
            }

            console.log(`🎭 Buscando actor: "${query}"`);

            const personResponse = await tmdbFetch(`${TMDB_BASE_URL}/search/person`, {
                params: {
                    api_key: TMDB_API_KEY,
                    query: query.trim(),
                    language: 'es-ES'
                },
                timeout: 30000
            });

            if (!personResponse.data.results || personResponse.data.results.length === 0) {
                return res.json({ success: true, actor: null, movies: [] });
            }

            const normalize = (str) => str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            const queryNorm = normalize(query);

            const actors = personResponse.data.results
                .filter(p => p.known_for_department === 'Acting' || p.known_for?.length > 0)
                .sort((a, b) => {
                    const aExact = normalize(a.name) === queryNorm ? 1 : 0;
                    const bExact = normalize(b.name) === queryNorm ? 1 : 0;
                    if (aExact !== bExact) return bExact - aExact;
                    return (b.popularity || 0) - (a.popularity || 0);
                });

            const actor = actors.length > 0 ? actors[0] : personResponse.data.results[0];
            console.log(`✅ Actor encontrado: ${actor.name} (ID: ${actor.id}, popularidad: ${actor.popularity})`);

            const creditsResponse = await tmdbFetch(`${TMDB_BASE_URL}/person/${actor.id}/movie_credits`, {
                params: {
                    api_key: TMDB_API_KEY,
                    language: 'es-ES'
                },
                timeout: 30000
            });

            const movies = (creditsResponse.data.cast || [])
                .filter(m => m.poster_path)
                .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
                .slice(0, 100)
                .map(movie => ({
                    tmdbId: movie.id,
                    title: movie.title,
                    originalTitle: movie.original_title,
                    character: movie.character,
                    poster: `${TMDB_IMAGE_BASE}${movie.poster_path}`,
                    year: movie.release_date ? movie.release_date.substring(0, 4) : null,
                    rating: movie.vote_average,
                    overview: movie.overview
                }));

            console.log(`🎬 ${movies.length} películas encontradas para ${actor.name}`);

            res.json({
                success: true,
                actor: {
                    id: actor.id,
                    name: actor.name,
                    photo: actor.profile_path ? `${TMDB_IMAGE_BASE}${actor.profile_path}` : null
                },
                movies
            });

        } catch (error) {
            console.error('Error buscando actor:', error.message);
            res.status(500).json({ error: 'Error al buscar actor' });
        }
    });

    return router;
};
