/**
 * routes/videos.js - Rutas de listado de videos y géneros
 *
 * GET  /videos        - Listar videos con metadata
 * GET  /genres        - Lista de géneros TMDB
 * POST /movies/enrich - Enriquecer películas con TMDB
 * POST /videos/enrich - Alias de enrich
 *
 * Montado en: /api
 */

const express = require('express');
const fsSync = require('fs');
const path = require('path');
const router = express.Router();

module.exports = function createVideosRoutes(deps) {
    const {
        storageConfig,
        readCache, getMovieMetadata,
        normalizeCacheToAPI,
        VIDEO_EXTENSIONS_REGEX
    } = deps;

    // 1. Listar archivos para la interfaz (modo LOCAL)
    router.get('/videos', async (req, res) => {
        try {
            let videoFiles = [];

            console.log(`📂 Listando archivos locales en: ${storageConfig.localPath}`);

            if (!fsSync.existsSync(storageConfig.localPath)) {
                return res.status(500).json({ error: `Ruta local no existe: ${storageConfig.localPath}` });
            }

            const files = fsSync.readdirSync(storageConfig.localPath);
            videoFiles = files
                .filter(name => VIDEO_EXTENSIONS_REGEX.test(name))
                .map(name => {
                    try {
                        const fullPath = path.join(storageConfig.localPath, name);
                        const stats = fsSync.statSync(fullPath);
                        return { name, size: stats.size, mtime: stats.mtime };
                    } catch (err) {
                        console.warn(`⚠️  No se puede acceder a: ${name} (${err.code})`);
                        return null;
                    }
                })
                .filter(f => f !== null);

            console.log(`✅ Encontrados ${videoFiles.length} videos locales`);

            // Cargar caché del backend para aplicar carátulas guardadas
            const cache = await readCache();

            // Crear lista de videos con metadata del caché si existe
            const videosWithMetadata = videoFiles.map((file) => {
                const cached = cache[file.name];
                const normalized = normalizeCacheToAPI(cached);
                const fileDate = file.mtime || file.modifiedAt || null;
                return {
                    filename: file.name,
                    title: normalized?.title || file.name.replace(VIDEO_EXTENSIONS_REGEX, ''),
                    size: (file.size / (1024 * 1024)).toFixed(1) + " MB",
                    url: `/stream/${encodeURIComponent(file.name)}`,
                    tmdbId: normalized?.tmdbId || null,
                    poster: normalized?.poster || null,
                    backdrop: normalized?.backdrop || null,
                    overview: normalized?.overview || null,
                    releaseDate: normalized?.releaseDate || null,
                    rating: normalized?.rating || null,
                    genreIds: normalized?.genreIds || [],
                    runtime: normalized?.runtime || null,
                    videos: normalized?.videos || [],
                    recommendations: normalized?.recommendations || [],
                    cast: normalized?.cast || [],
                    collection: normalized?.collection || null,
                    addedDate: fileDate ? new Date(fileDate).toISOString() : null
                };
            });

            console.log(`📦 Videos cargados: ${videosWithMetadata.length} (${Object.keys(cache).length} en caché) [Modo: LOCAL]`);

            const moviesWithoutMetadata = videosWithMetadata.filter(v => !v.tmdbId);
            if (moviesWithoutMetadata.length > 0) {
                console.log(`🔍 ${moviesWithoutMetadata.length} películas sin metadatos (se enriquecerán desde el frontend)`);
            }

            res.json(videosWithMetadata);
        } catch (err) {
            console.error('Error al listar videos:', err);
            res.status(500).json({ error: "No se pudo conectar al disco" });
        }
    });

    // 1.5 Obtener lista de géneros de TMDB
    router.get('/genres', async (req, res) => {
        const genres = [
            { id: 28, name: 'Acción' },
            { id: 12, name: 'Aventura' },
            { id: 16, name: 'Animación' },
            { id: 35, name: 'Comedia' },
            { id: 80, name: 'Crimen' },
            { id: 99, name: 'Documental' },
            { id: 18, name: 'Drama' },
            { id: 10751, name: 'Familia' },
            { id: 14, name: 'Fantasía' },
            { id: 36, name: 'Historia' },
            { id: 27, name: 'Terror' },
            { id: 10402, name: 'Música' },
            { id: 9648, name: 'Misterio' },
            { id: 10749, name: 'Romance' },
            { id: 878, name: 'Ciencia ficción' },
            { id: 10770, name: 'Película de TV' },
            { id: 53, name: 'Suspense' },
            { id: 10752, name: 'Bélica' },
            { id: 37, name: 'Western' }
        ];

        console.log('📚 Géneros cargados localmente:', genres.length);
        res.json(genres);
    });

    // 1.9 Enriquecer películas con metadata de TMDB (Backend como proxy)
    async function enrichMovies(req, res) {
        try {
            const { filenames } = req.body;

            if (!Array.isArray(filenames) || filenames.length === 0) {
                return res.status(400).json({ error: 'Se requiere un array de filenames' });
            }

            console.log(`🎬 Enriqueciendo ${filenames.length} películas desde backend...`);

            const results = [];

            for (const filename of filenames) {
                try {
                    const metadata = await getMovieMetadata(filename);

                    if (metadata) {
                        const normalized = normalizeCacheToAPI(metadata);
                        results.push({
                            filename,
                            success: true,
                            metadata: normalized
                        });
                    } else {
                        results.push({
                            filename,
                            success: false,
                            error: 'No se encontró en TMDB'
                        });
                    }

                    await new Promise(resolve => setTimeout(resolve, 350));

                } catch (error) {
                    console.error(`❌ Error procesando ${filename}:`, error.message);
                    results.push({
                        filename,
                        success: false,
                        error: error.message
                    });
                }
            }

            console.log(`✅ Enriquecimiento completado: ${results.filter(r => r.success).length}/${filenames.length} exitosos`);
            res.json({ success: true, results });

        } catch (error) {
            console.error('Error en enrich:', error);
            res.status(500).json({ error: 'Error al enriquecer películas' });
        }
    }

    // Alias for both paths
    router.post('/movies/enrich', enrichMovies);
    router.post('/videos/enrich', enrichMovies);

    return router;
};
