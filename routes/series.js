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
const ftp = require('basic-ftp');
const router = express.Router();

module.exports = function createSeriesRoutes(deps) {
    const {
        storageConfig, FTP_CONFIG, SERIES_FOLDER,
        readSeriesCache, writeSeriesCache, readSeriesEpisodes, writeSeriesEpisodes,
        parseSeriesFilename, searchTVShowTMDB, getSeasonEpisodesTMDB,
        scanSeriesFolder, TV_GENRES,
        isCacheExpired
    } = deps;

    // 1.7.1 Obtener lista de series
    router.get('/api/series', async (req, res) => {
        try {
            const seriesCache = await readSeriesCache();
            const episodesData = await readSeriesEpisodes();

            let seriesFolders = [];

            if (storageConfig.mode === 'local' && fsSync.existsSync(storageConfig.localPath)) {
                const seriesPath = path.join(storageConfig.localPath, SERIES_FOLDER);
                try {
                    const entries = await fs.readdir(seriesPath, { withFileTypes: true });
                    seriesFolders = entries.filter(e => e.isDirectory()).map(e => e.name);
                } catch (e) {
                    console.log(`📺 Carpeta de series no encontrada: ${seriesPath}`);
                }
            } else {
                const client = new ftp.Client();
                try {
                    await client.access({ ...FTP_CONFIG, secure: false, passive: true });
                    const seriesPath = `/volume-1/${SERIES_FOLDER}`;
                    const list = await client.list(seriesPath);
                    seriesFolders = list.filter(item => item.isDirectory).map(item => item.name);
                } catch (e) {
                    console.log(`📺 Carpeta de series no encontrada en FTP`);
                } finally {
                    client.close();
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
            const extensions = ['.mp4', '.mkv', '.avi', '.mov'];

            if (storageConfig.mode === 'local' && fsSync.existsSync(storageConfig.localPath)) {
                const seriesPath = path.join(storageConfig.localPath, SERIES_FOLDER, folderName);
                try {
                    const entries = await fs.readdir(seriesPath, { withFileTypes: true });
                    for (const entry of entries) {
                        if (entry.isFile() && extensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
                            const parsed = parseSeriesFilename(entry.name);
                            if (parsed && parsed.season === season) {
                                files.push({
                                    filename: entry.name,
                                    episode_number: parsed.episode,
                                    season_number: parsed.season
                                });
                            }
                        }
                    }
                } catch (e) {
                    console.log(`Error leyendo carpeta ${folderName}:`, e.message);
                }
            } else {
                const client = new ftp.Client();
                try {
                    await client.access({ ...FTP_CONFIG, secure: false, passive: true });
                    const seriesPath = `/volume-1/${SERIES_FOLDER}/${folderName}`;
                    const list = await client.list(seriesPath);
                    list.filter(item => !item.isDirectory && extensions.some(ext => item.name.toLowerCase().endsWith(ext)))
                        .forEach(item => {
                            const parsed = parseSeriesFilename(item.name);
                            if (parsed && parsed.season === season) {
                                files.push({
                                    filename: item.name,
                                    episode_number: parsed.episode,
                                    season_number: parsed.season
                                });
                            }
                        });
                } catch (e) {
                    console.log(`Error FTP leyendo ${folderName}:`, e.message);
                } finally {
                    client.close();
                }
            }

            files.sort((a, b) => a.episode_number - b.episode_number);

            const episodes = files.map(f => ({
                episode_number: f.episode_number,
                name: `Episodio ${f.episode_number}`,
                filename: f.filename,
                available: true,
                watched: false
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
                    const availableFiles = await scanSeriesFolder(folderName);

                    seasonData.episodes.forEach(ep => {
                        const matchingFile = availableFiles.find(f => {
                            const parsed = parseSeriesFilename(f.name);
                            return parsed && parsed.season === seasonData.season_number && parsed.episode === ep.episode_number;
                        });
                        if (matchingFile) {
                            ep.filename = matchingFile.name;
                            ep.available = true;
                            ep.size = matchingFile.size;
                        }
                    });

                    if (!episodesData[tmdbId]) {
                        episodesData[tmdbId] = { series_title: seriesData.title, seasons: {} };
                    }
                    episodesData[tmdbId].seasons[seasonNumber] = seasonData;
                    await writeSeriesEpisodes(episodesData);
                }
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

    // 1.7.5 Enriquecer series desde TMDB
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

        if (storageConfig.mode === 'local' && fsSync.existsSync(storageConfig.localPath)) {
            const filePath = path.join(storageConfig.localPath, SERIES_FOLDER, decodedFolder, decodedFilename);
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
        } else {
            // FTP streaming
            const client = new ftp.Client();
            try {
                await client.access({ ...FTP_CONFIG, secure: false, passive: true });
                const remotePath = `/volume-1/${SERIES_FOLDER}/${decodedFolder}/${decodedFilename}`;
                const fileSize = await client.size(remotePath);
                const range = req.headers.range;

                if (range) {
                    const parts = range.replace(/bytes=/, '').split('-');
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 10 * 1024 * 1024, fileSize - 1);
                    const chunkSize = end - start + 1;

                    res.writeHead(206, {
                        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                        'Accept-Ranges': 'bytes',
                        'Content-Length': chunkSize,
                        'Content-Type': 'video/mp4'
                    });

                    await client.downloadTo(res, remotePath, start);
                } else {
                    res.writeHead(200, {
                        'Content-Length': fileSize,
                        'Content-Type': 'video/mp4'
                    });
                    await client.downloadTo(res, remotePath);
                }
            } catch (error) {
                console.error('Error FTP streaming:', error);
                res.status(500).json({ error: 'Error al transmitir episodio' });
            } finally {
                client.close();
            }
        }
    });

    return router;
};
