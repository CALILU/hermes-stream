/**
 * routes/series.js - Rutas de series de TV
 *
 * GET  /api/series                                    - Listar series
 * GET  /api/series/genres                             - Géneros de series
 * GET  /api/series/folder/:folderName/season/:number  - Episodios por carpeta
 * GET  /api/series/:tmdbId                            - Detalle de serie
 * GET  /api/series/:tmdbId/season/:number             - Episodios de temporada
 * POST /api/series/enrich                             - Enriquecer series
 * PUT  /api/series/:tmdbId/episode/:s/:e/watched      - Marcar episodio visto
 * GET  /api/series/:tmdbId/progress                   - Progreso de serie
 * GET  /stream-series/:folder/:filename               - Streaming de episodio
 *
 * Montado en: / (usa rutas absolutas)
 */

const express = require('express');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');
const router = express.Router();
const { ensureFullPosterURL } = require('../lib/utils');

module.exports = function createSeriesRoutes(deps) {
    const {
        storageConfig, SERIES_FOLDER,
        readSeriesCache, writeSeriesCache, readSeriesEpisodes, writeSeriesEpisodes,
        parseSeriesFilename, searchTVShowTMDB, getSeriesDetailsByTmdbId, getSeasonEpisodesTMDB,
        scanSeriesFolder, TV_GENRES,
        isCacheExpired
    } = deps;

    // 1.7.1 Obtener lista de series
    router.get('/api/series', async (req, res) => {
        try {
            const seriesCache = await readSeriesCache();
            const episodesData = await readSeriesEpisodes();

            let seriesFolders = [];

            if (fsSync.existsSync(storageConfig.localPath)) {
                const seriesPath = path.join(storageConfig.localPath, SERIES_FOLDER);
                try {
                    const entries = await fs.readdir(seriesPath, { withFileTypes: true });
                    seriesFolders = entries.filter(e => e.isDirectory()).map(e => e.name);
                } catch (e) {
                    console.log(`📺 Carpeta de series no encontrada: ${seriesPath}`);
                }
            }

            const series = seriesFolders.map(folderName => {
                const cached = seriesCache[folderName];
                if (cached) {
                    const episodes = episodesData[cached.tmdb_id];
                    let watchedCount = 0;
                    let totalCount = 0;
                    let lastWatched = null;

                    if (episodes) {
                        Object.values(episodes.seasons || {}).forEach(season => {
                            season.episodes?.forEach(ep => {
                                totalCount++;
                                if (ep.watched) {
                                    watchedCount++;
                                    if (!lastWatched || (ep.watched_at && ep.watched_at > lastWatched.watched_at)) {
                                        lastWatched = { season: season.season_number, episode: ep.episode_number, watched_at: ep.watched_at };
                                    }
                                }
                            });
                        });
                    }

                    return {
                        ...cached,
                        poster: ensureFullPosterURL(cached.poster || cached.poster_path, 'w342'),
                        backdrop: ensureFullPosterURL(cached.backdrop || cached.backdrop_path, 'w780'),
                        folder_name: folderName,
                        watched_count: watchedCount,
                        total_episodes_available: totalCount,
                        progress_percent: totalCount > 0 ? Math.round((watchedCount / totalCount) * 100) : 0,
                        last_watched: lastWatched
                    };
                }

                return {
                    folder_name: folderName,
                    title: folderName,
                    poster: null,
                    backdrop: null,
                    status: 'Unknown',
                    number_of_seasons: 0,
                    number_of_episodes: 0,
                    needs_enrichment: true
                };
            });

            series.sort((a, b) => {
                if (a.needs_enrichment && !b.needs_enrichment) return 1;
                if (!a.needs_enrichment && b.needs_enrichment) return -1;
                return (a.title || a.folder_name).localeCompare(b.title || b.folder_name);
            });

            res.json(series);

        } catch (error) {
            console.error('Error obteniendo series:', error.message);
            res.status(500).json({ error: 'Error al obtener series' });
        }
    });

    // 1.7.2 Géneros de series
    router.get('/api/series/genres', (req, res) => {
        res.json(TV_GENRES);
    });

    // 1.7.2b Obtener episodios de una temporada por nombre de carpeta
    router.get('/api/series/folder/:folderName/season/:seasonNumber', async (req, res) => {
        try {
            const { folderName, seasonNumber } = req.params;
            const season = parseInt(seasonNumber);
            const files = [];

            // scanSeriesFolder ya busca en raíz + subcarpetas
            const availableFiles = await scanSeriesFolder(folderName);
            for (const f of availableFiles) {
                const parsed = parseSeriesFilename(f.name);
                if (parsed && parsed.season === season) {
                    files.push({
                        filename: f.name,
                        episode_number: parsed.episode,
                        season_number: parsed.season,
                        subfolder: f.subfolder || null
                    });
                }
            }

            files.sort((a, b) => a.episode_number - b.episode_number);

            const episodes = files.map(f => ({
                episode_number: f.episode_number,
                name: `Episodio ${f.episode_number}`,
                filename: f.filename,
                available: true,
                watched: false,
                subfolder: f.subfolder
            }));

            res.json({
                season_number: season,
                episodes
            });

        } catch (error) {
            console.error('Error obteniendo episodios por carpeta:', error.message);
            res.status(500).json({ error: 'Error al obtener episodios' });
        }
    });

    // 1.7.3 Obtener detalles de una serie
    router.get('/api/series/:tmdbId', async (req, res) => {
        try {
            const { tmdbId } = req.params;
            const seriesCache = await readSeriesCache();
            const episodesData = await readSeriesEpisodes();

            const seriesEntry = Object.entries(seriesCache).find(([_, data]) => data.tmdb_id === parseInt(tmdbId));

            if (!seriesEntry) {
                return res.status(404).json({ error: 'Serie no encontrada' });
            }

            const [folderName, seriesData] = seriesEntry;
            const episodes = episodesData[tmdbId] || { seasons: {} };

            res.json({
                ...seriesData,
                poster: ensureFullPosterURL(seriesData.poster || seriesData.poster_path, 'w342'),
                backdrop: ensureFullPosterURL(seriesData.backdrop || seriesData.backdrop_path, 'w780'),
                folder_name: folderName,
                seasons: episodes.seasons || {}
            });

        } catch (error) {
            console.error('Error obteniendo serie:', error.message);
            res.status(500).json({ error: 'Error al obtener serie' });
        }
    });

    // 1.7.4 Obtener episodios de una temporada
    router.get('/api/series/:tmdbId/season/:seasonNumber', async (req, res) => {
        try {
            const { tmdbId, seasonNumber } = req.params;
            const episodesData = await readSeriesEpisodes();
            const seriesCache = await readSeriesCache();

            const seriesEntry = Object.entries(seriesCache).find(([_, data]) => data.tmdb_id === parseInt(tmdbId));
            if (!seriesEntry) {
                return res.status(404).json({ error: 'Serie no encontrada' });
            }

            const [folderName, seriesData] = seriesEntry;
            let seasonData = episodesData[tmdbId]?.seasons?.[seasonNumber];

            if (!seasonData) {
                console.log(`📺 Obteniendo temporada ${seasonNumber} de TMDB para ${seriesData.title}`);
                seasonData = await getSeasonEpisodesTMDB(parseInt(tmdbId), parseInt(seasonNumber));

                if (seasonData) {
                    if (!episodesData[tmdbId]) {
                        episodesData[tmdbId] = { series_title: seriesData.title, seasons: {} };
                    }
                    episodesData[tmdbId].seasons[seasonNumber] = seasonData;
                    await writeSeriesEpisodes(episodesData);
                }
            }

            // Siempre re-escanear archivos disponibles (pueden haber sido renombrados)
            if (seasonData) {
                const availableFiles = await scanSeriesFolder(folderName);

                seasonData.episodes.forEach(ep => {
                    // Resetear disponibilidad
                    ep.filename = null;
                    ep.available = false;
                    ep.size = null;
                    ep.subfolder = null;

                    const matchingFile = availableFiles.find(f => {
                        const parsed = parseSeriesFilename(f.name);
                        return parsed && parsed.season === seasonData.season_number && parsed.episode === ep.episode_number;
                    });
                    if (matchingFile) {
                        ep.filename = matchingFile.name;
                        ep.available = true;
                        ep.size = matchingFile.size;
                        ep.subfolder = matchingFile.subfolder || null;
                    }
                });
            }

            if (!seasonData) {
                return res.status(404).json({ error: 'Temporada no encontrada' });
            }

            res.json({
                tmdb_id: parseInt(tmdbId),
                series_title: seriesData.title,
                folder_name: folderName,
                ...seasonData
            });

        } catch (error) {
            console.error('Error obteniendo temporada:', error.message);
            res.status(500).json({ error: 'Error al obtener temporada' });
        }
    });

    // 1.7.4b Actualizar carátula de serie (obtiene detalles completos de TMDB)
    router.post('/api/series/update-poster', async (req, res) => {
        try {
            const { folderName, metadata } = req.body;

            if (!folderName || !metadata) {
                return res.status(400).json({ error: 'Se requiere folderName y metadata' });
            }

            const tmdbId = metadata.tmdbId || metadata.tmdb_id;
            console.log(`🔄 Actualizando carátula de serie: ${folderName} → TMDB ID: ${tmdbId}`);

            let fullData = null;

            // Obtener detalles completos del nuevo TMDB ID (cast, temporadas, videos, etc.)
            if (tmdbId) {
                fullData = await getSeriesDetailsByTmdbId(tmdbId);
                if (fullData) {
                    console.log(`✅ Detalles completos obtenidos: ${fullData.title} (${fullData.cast?.length || 0} actores, ${fullData.number_of_seasons} temporadas)`);
                }
            }

            const seriesCache = await readSeriesCache();
            const oldTmdbId = seriesCache[folderName]?.tmdb_id;

            // Usar datos completos de TMDB o los básicos del frontend
            seriesCache[folderName] = {
                ...(fullData || {}),
                folder_name: folderName,
                tmdb_id: tmdbId || seriesCache[folderName]?.tmdb_id,
                title: fullData?.title || metadata.title,
                poster: fullData?.poster || metadata.poster,
                backdrop: fullData?.backdrop || metadata.backdrop,
                overview: fullData?.overview || metadata.overview,
                cached_at: Date.now()
            };

            await writeSeriesCache(seriesCache);

            // Si cambió el TMDB ID, limpiar episodios del ID antiguo
            if (oldTmdbId && oldTmdbId !== tmdbId) {
                try {
                    const episodesData = await readSeriesEpisodes();
                    if (episodesData[oldTmdbId]) {
                        delete episodesData[oldTmdbId];
                        await writeSeriesEpisodes(episodesData);
                        console.log(`🗑️ Episodios del TMDB ID antiguo (${oldTmdbId}) eliminados`);
                    }
                } catch (e) {
                    console.warn(`⚠️ Error limpiando episodios antiguos: ${e.message}`);
                }
            }

            console.log(`✅ Carátula de serie actualizada: ${folderName} → ${fullData?.title || metadata.title}`);
            res.json({
                success: true,
                message: 'Carátula de serie actualizada',
                metadata: seriesCache[folderName]
            });

        } catch (error) {
            console.error('Error actualizando carátula de serie:', error.message);
            res.status(500).json({ error: 'Error al actualizar carátula de serie' });
        }
    });

    // 1.7.5a Analizar episodios de una carpeta y proponer renombrado
    // Función auxiliar: detectar temporada del nombre de subcarpeta
    function detectSeasonFromFolder(folderName) {
        const match = folderName.match(/(?:temporada|season|temp|t)\s*(\d{1,2})/i);
        return match ? parseInt(match[1], 10) : null;
    }

    // Función auxiliar: analizar nombre de archivo para extraer temporada/episodio
    function analyzeFilename(filename, folderSeason) {
        const ext = path.extname(filename);
        const result = { filename, extension: ext, season: null, episode: null, confidence: 'none' };

        // 1. Formato estándar S01E04
        let match = filename.match(/S(\d{1,2})E(\d{1,3})/i);
        if (match) {
            result.season = parseInt(match[1], 10);
            result.episode = parseInt(match[2], 10);
            result.confidence = 'high';
            return result;
        }

        // 2. Formato 1x04
        match = filename.match(/(\d{1,2})x(\d{1,3})/i);
        if (match) {
            result.season = parseInt(match[1], 10);
            result.episode = parseInt(match[2], 10);
            result.confidence = 'high';
            return result;
        }

        // 3. Formato [Cap.104] o [Cap.1004] (español: Capítulo)
        match = filename.match(/\[?Cap\.?\s*(\d{3,4})\]?/i);
        if (match) {
            const num = match[1];
            if (num.length === 3) {
                result.season = parseInt(num[0], 10);
                result.episode = parseInt(num.substring(1), 10);
            } else if (num.length === 4) {
                result.season = parseInt(num.substring(0, 2), 10);
                result.episode = parseInt(num.substring(2), 10);
            }
            result.confidence = 'medium';
            return result;
        }

        // 4. Formato E04 o Ep04 (sin temporada)
        match = filename.match(/(?:^|[\s._-])E(?:p\.?)?(\d{1,3})(?:[\s._\-\[]|$)/i);
        if (match) {
            result.season = folderSeason || 1;
            result.episode = parseInt(match[1], 10);
            result.confidence = 'low';
            return result;
        }

        // 5. Número suelto significativo en el nombre (ej: "Episode 5", "05")
        match = filename.match(/(?:episode|capitulo|cap)\s*(\d{1,3})/i);
        if (match) {
            result.season = folderSeason || 1;
            result.episode = parseInt(match[1], 10);
            result.confidence = 'low';
            return result;
        }

        // Si no detectó temporada pero la subcarpeta sí tiene número, asignarla
        if (folderSeason) {
            result.season = folderSeason;
        }

        return result;
    }

    router.post('/api/series/analyze-episodes', async (req, res) => {
        try {
            const { folderName } = req.body;

            if (!folderName) {
                return res.status(400).json({ error: 'Se requiere folderName' });
            }

            console.log(`🔍 Analizando episodios en: ${folderName}`);

            const extensions = ['.mp4', '.mkv', '.avi', '.mov'];
            // files ahora incluye { filename, subfolder } para soportar subcarpetas
            let fileEntries = [];

            if (fsSync.existsSync(storageConfig.localPath)) {
                const seriesPath = path.join(storageConfig.localPath, SERIES_FOLDER, folderName);
                try {
                    const entries = await fs.readdir(seriesPath, { withFileTypes: true });

                    // Archivos en la raíz
                    for (const entry of entries) {
                        if (entry.isFile() && extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
                            fileEntries.push({ filename: entry.name, subfolder: null });
                        }
                    }

                    // Buscar en subcarpetas de temporadas
                    const subfolders = entries.filter(e => e.isDirectory());
                    for (const sub of subfolders) {
                        const seasonNum = detectSeasonFromFolder(sub.name);
                        if (seasonNum !== null || subfolders.length > 0) {
                            try {
                                const subPath = path.join(seriesPath, sub.name);
                                const subEntries = await fs.readdir(subPath, { withFileTypes: true });
                                for (const se of subEntries) {
                                    if (se.isFile() && extensions.some(ext => se.name.toLowerCase().endsWith(ext))) {
                                        fileEntries.push({ filename: se.name, subfolder: sub.name });
                                    }
                                }
                            } catch (e) {
                                // subcarpeta no legible, ignorar
                            }
                        }
                    }
                } catch (e) {
                    return res.status(404).json({ error: `Carpeta no encontrada: ${folderName}` });
                }
            }

            // Ordenar: primero por subcarpeta, luego por nombre
            fileEntries.sort((a, b) => {
                if (a.subfolder === b.subfolder) return a.filename.localeCompare(b.filename);
                if (!a.subfolder) return -1;
                if (!b.subfolder) return 1;
                return a.subfolder.localeCompare(b.subfolder);
            });

            // Analizar cada archivo
            const analyzed = fileEntries.map(({ filename, subfolder }) => {
                const folderSeason = subfolder ? detectSeasonFromFolder(subfolder) : null;
                const result = analyzeFilename(filename, folderSeason);
                result.subfolder = subfolder;

                // Si la subcarpeta indica temporada y el archivo no la detectó o difiere, usar la de la carpeta
                if (folderSeason && (result.season === null || result.confidence === 'none')) {
                    result.season = folderSeason;
                }

                return result;
            });

            // Buscar título de la serie en caché
            const seriesCache = await readSeriesCache();
            const cached = seriesCache[folderName];
            const seriesTitle = cached?.title || folderName;

            // Detectar subcarpetas encontradas
            const subfolders = [...new Set(fileEntries.filter(f => f.subfolder).map(f => f.subfolder))];

            console.log(`📋 ${analyzed.length} archivos analizados en ${subfolders.length > 0 ? subfolders.length + ' subcarpetas' : 'raíz'} (${analyzed.filter(a => a.confidence !== 'none').length} con patrón detectado)`);

            res.json({
                success: true,
                folderName,
                seriesTitle,
                tmdbId: cached?.tmdb_id || null,
                subfolders,
                files: analyzed
            });

        } catch (error) {
            console.error('Error analizando episodios:', error.message);
            res.status(500).json({ error: 'Error al analizar episodios' });
        }
    });

    // 1.7.5b Renombrar episodios con mappings confirmados por el usuario
    router.post('/api/series/rename-episodes', async (req, res) => {
        try {
            const { folderName, seriesTitle, mappings } = req.body;

            if (!folderName || !seriesTitle || !mappings || !Array.isArray(mappings)) {
                return res.status(400).json({ error: 'Se requiere folderName, seriesTitle y mappings' });
            }

            console.log(`📝 Renombrando ${mappings.length} episodios en: ${folderName}`);

            // Quitar acentos para evitar problemas
            const removeAccents = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const cleanTitle = removeAccents(seriesTitle).replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim();

            const results = [];

            for (const { filename, season, episode, subfolder } of mappings) {
                if (!filename || !season || !episode) {
                    results.push({ filename, subfolder, success: false, error: 'Faltan datos' });
                    continue;
                }

                const ext = path.extname(filename);
                const s = String(season).padStart(2, '0');
                const e = String(episode).padStart(2, '0');
                const newFilename = `${cleanTitle} S${s}E${e}${ext}`;

                if (newFilename === filename) {
                    results.push({ filename, newFilename, subfolder, success: true, skipped: true });
                    continue;
                }

                try {
                    if (fsSync.existsSync(storageConfig.localPath)) {
                        const seriesPath = subfolder
                            ? path.join(storageConfig.localPath, SERIES_FOLDER, folderName, subfolder)
                            : path.join(storageConfig.localPath, SERIES_FOLDER, folderName);
                        const oldPath = path.join(seriesPath, filename);
                        const newPath = path.join(seriesPath, newFilename);

                        if (!fsSync.existsSync(oldPath)) {
                            results.push({ filename, newFilename, subfolder, success: false, error: 'Archivo no encontrado' });
                            continue;
                        }
                        if (fsSync.existsSync(newPath) && oldPath !== newPath) {
                            results.push({ filename, newFilename, subfolder, success: false, error: 'Ya existe un archivo con ese nombre' });
                            continue;
                        }

                        fsSync.renameSync(oldPath, newPath);
                    }

                    results.push({ filename, newFilename, subfolder, success: true });
                    console.log(`  ✅ ${subfolder ? subfolder + '/' : ''}${filename} → ${newFilename}`);
                } catch (renameError) {
                    results.push({ filename, newFilename, subfolder, success: false, error: renameError.message });
                    console.error(`  ❌ ${filename}: ${renameError.message}`);
                }
            }

            const successCount = results.filter(r => r.success && !r.skipped).length;
            console.log(`📝 Renombrado completado: ${successCount}/${mappings.length} archivos`);

            res.json({ success: true, results });

        } catch (error) {
            console.error('Error renombrando episodios:', error.message);
            res.status(500).json({ error: 'Error al renombrar episodios' });
        }
    });

    // 1.7.5c Enriquecer series desde TMDB
    router.post('/api/series/enrich', async (req, res) => {
        try {
            const { folders } = req.body;

            if (!folders || !Array.isArray(folders)) {
                return res.status(400).json({ error: 'Se requiere array de carpetas' });
            }

            const results = [];
            const seriesCache = await readSeriesCache();

            for (const folderName of folders) {
                if (seriesCache[folderName] && !isCacheExpired(seriesCache[folderName])) {
                    results.push({ folder: folderName, success: true, cached: true });
                    continue;
                }

                console.log(`📺 Enriqueciendo serie: ${folderName}`);
                const seriesData = await searchTVShowTMDB(folderName);

                if (seriesData) {
                    seriesCache[folderName] = { ...seriesData, folder_name: folderName, cached_at: Date.now() };
                    results.push({ folder: folderName, success: true, data: seriesData });
                } else {
                    results.push({ folder: folderName, success: false, error: 'No encontrada en TMDB' });
                }

                await new Promise(r => setTimeout(r, 500));
            }

            await writeSeriesCache(seriesCache);
            res.json({ success: true, results });

        } catch (error) {
            console.error('Error enriqueciendo series:', error.message);
            res.status(500).json({ error: 'Error al enriquecer series' });
        }
    });

    // 1.7.6 Marcar episodio como visto
    router.put('/api/series/:tmdbId/episode/:season/:episode/watched', async (req, res) => {
        try {
            const { tmdbId, season, episode } = req.params;
            const { watched, progress } = req.body;

            const episodesData = await readSeriesEpisodes();

            if (!episodesData[tmdbId]?.seasons?.[season]?.episodes) {
                return res.status(404).json({ error: 'Temporada no encontrada' });
            }

            const ep = episodesData[tmdbId].seasons[season].episodes.find(e => e.episode_number === parseInt(episode));
            if (!ep) {
                return res.status(404).json({ error: 'Episodio no encontrado' });
            }

            ep.watched = watched;
            ep.watched_at = watched ? Date.now() : null;
            if (progress !== undefined) {
                ep.progress = progress;
            }

            await writeSeriesEpisodes(episodesData);

            const seriesCache = await readSeriesCache();
            const seriesEntry = Object.entries(seriesCache).find(([_, data]) => data.tmdb_id === parseInt(tmdbId));
            if (seriesEntry && watched) {
                const [folderName, seriesData] = seriesEntry;
                seriesData.last_watched = { season: parseInt(season), episode: parseInt(episode), timestamp: Date.now() };
                await writeSeriesCache(seriesCache);
            }

            res.json({ success: true, episode: ep });

        } catch (error) {
            console.error('Error marcando episodio:', error.message);
            res.status(500).json({ error: 'Error al marcar episodio' });
        }
    });

    // 1.7.7 Obtener progreso de una serie
    router.get('/api/series/:tmdbId/progress', async (req, res) => {
        try {
            const { tmdbId } = req.params;
            const episodesData = await readSeriesEpisodes();
            const seriesCache = await readSeriesCache();

            const seriesEntry = Object.entries(seriesCache).find(([_, data]) => data.tmdb_id === parseInt(tmdbId));
            if (!seriesEntry) {
                return res.status(404).json({ error: 'Serie no encontrada' });
            }

            const [folderName, seriesData] = seriesEntry;
            const episodes = episodesData[tmdbId];

            let watchedCount = 0;
            let totalCount = 0;
            let lastWatched = null;
            let nextToWatch = null;

            if (episodes) {
                const sortedSeasons = Object.keys(episodes.seasons || {}).sort((a, b) => parseInt(a) - parseInt(b));

                for (const seasonNum of sortedSeasons) {
                    const season = episodes.seasons[seasonNum];
                    const sortedEpisodes = [...(season.episodes || [])].sort((a, b) => a.episode_number - b.episode_number);

                    for (const ep of sortedEpisodes) {
                        totalCount++;
                        if (ep.watched) {
                            watchedCount++;
                            if (!lastWatched || (ep.watched_at && ep.watched_at > lastWatched.watched_at)) {
                                lastWatched = { season: parseInt(seasonNum), episode: ep.episode_number, name: ep.name, watched_at: ep.watched_at };
                            }
                        } else if (!nextToWatch && ep.available) {
                            nextToWatch = { season: parseInt(seasonNum), episode: ep.episode_number, name: ep.name, filename: ep.filename };
                        }
                    }
                }
            }

            res.json({
                tmdb_id: parseInt(tmdbId),
                title: seriesData.title,
                watched_count: watchedCount,
                total_available: totalCount,
                progress_percent: totalCount > 0 ? Math.round((watchedCount / totalCount) * 100) : 0,
                last_watched: lastWatched,
                next_to_watch: nextToWatch
            });

        } catch (error) {
            console.error('Error obteniendo progreso:', error.message);
            res.status(500).json({ error: 'Error al obtener progreso' });
        }
    });

    // 1.7.8 Stream de episodio de serie
    router.get('/stream-series/:folderName/:filename', async (req, res) => {
        const { folderName, filename } = req.params;
        const decodedFolder = decodeURIComponent(folderName);
        const decodedFilename = decodeURIComponent(filename);

        console.log(`📺 Streaming episodio: ${decodedFolder}/${decodedFilename}`);

        let filePath = path.join(storageConfig.localPath, SERIES_FOLDER, decodedFolder, decodedFilename);

        // Si no existe en la raíz, buscar en subcarpetas
        if (!fsSync.existsSync(filePath)) {
            const seriesDir = path.join(storageConfig.localPath, SERIES_FOLDER, decodedFolder);
            try {
                const entries = await fs.readdir(seriesDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isDirectory()) {
                        const subPath = path.join(seriesDir, entry.name, decodedFilename);
                        if (fsSync.existsSync(subPath)) {
                            filePath = subPath;
                            break;
                        }
                    }
                }
            } catch (e) { /* no subcarpetas */ }
        }

        try {
            const stat = await fs.stat(filePath);
            const fileSize = stat.size;
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                const chunkSize = end - start + 1;

                res.writeHead(206, {
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunkSize,
                    'Content-Type': 'video/mp4'
                });

                const fileStream = fsSync.createReadStream(filePath, { start, end });
                fileStream.pipe(res);
            } else {
                res.writeHead(200, {
                    'Content-Length': fileSize,
                    'Content-Type': 'video/mp4'
                });
                fsSync.createReadStream(filePath).pipe(res);
            }
        } catch (error) {
            console.error('Error streaming local:', error);
            res.status(404).json({ error: 'Archivo no encontrado' });
        }
    });

    return router;
};
