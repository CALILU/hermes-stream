/**
 * routes/conversion.js - Rutas de conversion de video (AVI/MKV -> MP4)
 *
 * GET  /pending               - Listar archivos pendientes de conversion (MKV/AVI)
 * GET  /status                - Estado de conversiones activas
 * POST /                      - Iniciar conversion individual
 * GET  /:jobId/progress       - Progreso de conversion (SSE)
 * POST /all                   - Convertir todos los pendientes en secuencia
 * GET  /batch/:batchId/progress - Progreso global del batch (SSE)
 *
 * Montado en: /api/convert
 *
 * FFmpeg inteligente:
 *   MKV (ya H.264) -> -c:v copy + audio normalizado
 *   AVI            -> -c:v libx264 -preset medium -crf 22 + audio normalizado
 * Audio siempre: -c:a aac -ar 48000 -ac 2 -b:a 192k
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const { probeFile } = require('../lib/probe');

module.exports = function createConversionRoutes(deps) {
    const { conversionJobs, TEMP_DIR, storageConfig, mediaDB } = deps;

    const router = express.Router();

    // Single active batch tracker
    let activeBatch = null;

    // Ruta del directorio de descargas de Transmission
    const TORRENTS_PATH = process.env.TORRENTS_PATH || '/mnt/peliculas/torrents';
    // Ruta del script torrent-done.js
    const TORRENT_DONE_SCRIPT = process.env.TORRENT_DONE_SCRIPT || '/home/isidro/isiprime/scripts/torrent-done.js';

    // Limpiar archivos temporales huerfanos al arrancar
    // (quedan si el servidor se cae durante una conversion)
    (async function cleanupOrphanedTempFiles() {
        try {
            const files = await fs.readdir(storageConfig.localPath);
            const tempFiles = files.filter(f => f.endsWith('.tmp_convert.mp4'));
            for (const tempFile of tempFiles) {
                const fullPath = path.join(storageConfig.localPath, tempFile);
                await fs.unlink(fullPath).catch(() => {});
                console.log(`🧹 Temporal huerfano eliminado: ${tempFile}`);
            }
            if (tempFiles.length > 0) {
                console.log(`🧹 Limpieza: ${tempFiles.length} archivo(s) temporal(es) eliminado(s)`);
            }
        } catch (err) {
            console.error('Error limpiando temporales:', err.message);
        }
    })();

    // ──────────────────────────────────────────────
    // GET /api/convert/pending - Listar archivos pendientes
    // ──────────────────────────────────────────────
    router.get('/pending', async (req, res) => {
        try {
            const files = await listConvertibleFiles();
            res.json({ success: true, files });
        } catch (error) {
            console.error('Error listando archivos pendientes:', error.message);
            res.status(500).json({ success: false, error: 'Error al leer directorio de almacenamiento' });
        }
    });

    // ──────────────────────────────────────────────
    // GET /api/convert/status - Estado de conversiones activas
    // ──────────────────────────────────────────────
    router.get('/status', (req, res) => {
        const jobs = [];
        for (const [jobId, job] of conversionJobs.entries()) {
            jobs.push({
                jobId,
                status: job.status,
                progress: job.progress,
                filename: job.filename,
                mp4Filename: job.mp4Filename,
                message: job.message,
                source: job.source || 'movies'
            });
        }

        const activeCount = jobs.filter(j => ['starting', 'converting', 'finalizing'].includes(j.status)).length;

        res.json({
            success: true,
            jobs,
            activeCount,
            totalCount: jobs.length,
            batch: activeBatch ? {
                batchId: activeBatch.batchId,
                total: activeBatch.total,
                completed: activeBatch.completed,
                errors: activeBatch.errors.length,
                status: activeBatch.status
            } : null
        });
    });

    // ──────────────────────────────────────────────
    // POST /api/convert - Iniciar conversion individual
    // ──────────────────────────────────────────────
    router.post('/', async (req, res) => {
        const { filename, source } = req.body;

        if (!filename) {
            return res.status(400).json({ error: 'Filename requerido' });
        }

        const fileSource = source || 'movies';

        if (fileSource === 'torrents') {
            // --- Flujo Torrents: ejecutar torrent-done.js ---
            const ext = filename.split('.').pop().toLowerCase();
            if (!['avi', 'mkv', 'mp4', 'mov'].includes(ext)) {
                return res.status(400).json({ error: 'Tipo de archivo no soportado' });
            }

            // Proteccion contra duplicados
            for (const [existingJobId, job] of conversionJobs.entries()) {
                if (job.filename === filename && ['starting', 'converting', 'finalizing'].includes(job.status)) {
                    return res.json({ jobId: existingJobId, mp4Filename: job.mp4Filename, duplicate: true, source: 'torrents' });
                }
            }

            const jobId = Date.now().toString();
            const mp4Filename = filename.replace(/\.(avi|mkv|mov)$/i, '.mp4');

            conversionJobs.set(jobId, {
                status: 'starting',
                progress: 0,
                filename,
                mp4Filename,
                message: 'Procesando torrent...',
                source: 'torrents'
            });

            res.json({ jobId, mp4Filename, source: 'torrents' });

            // Ejecutar torrent-done.js en background
            processTorrentConversion(jobId, filename);
        } else {
            // --- Flujo Movies: conversion FFmpeg directa ---
            const ext = filename.split('.').pop().toLowerCase();
            if (!['avi', 'mkv'].includes(ext)) {
                return res.status(400).json({ error: 'Solo se pueden convertir archivos AVI o MKV' });
            }

            // Proteccion contra duplicados
            for (const [existingJobId, job] of conversionJobs.entries()) {
                if (job.filename === filename && ['starting', 'converting', 'finalizing'].includes(job.status)) {
                    return res.json({ jobId: existingJobId, mp4Filename: job.mp4Filename, duplicate: true, source: 'movies' });
                }
            }

            const jobId = Date.now().toString();
            const mp4Filename = filename.replace(/\.(avi|mkv)$/i, '.mp4');

            conversionJobs.set(jobId, {
                status: 'starting',
                progress: 0,
                filename,
                mp4Filename,
                message: 'Iniciando conversion...',
                source: 'movies'
            });

            res.json({ jobId, mp4Filename, source: 'movies' });

            // Ejecutar conversion en background
            processConversion(jobId, filename, mp4Filename);
        }
    });

    // ──────────────────────────────────────────────
    // GET /api/convert/:jobId/progress - Progreso SSE individual
    // ──────────────────────────────────────────────
    router.get('/:jobId/progress', (req, res) => {
        const { jobId } = req.params;

        // Avoid matching batch routes
        if (jobId === 'batch' || jobId === 'all' || jobId === 'pending' || jobId === 'status') return;

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const sendProgress = () => {
            const job = conversionJobs.get(jobId);
            if (job) {
                res.write(`data: ${JSON.stringify(job)}\n\n`);

                if (job.status === 'completed' || job.status === 'error') {
                    res.end();
                    return false;
                }
            } else {
                res.write(`data: ${JSON.stringify({ status: 'not_found' })}\n\n`);
                res.end();
                return false;
            }
            return true;
        };

        sendProgress();
        const interval = setInterval(() => {
            if (!sendProgress()) {
                clearInterval(interval);
            }
        }, 1000);

        req.on('close', () => clearInterval(interval));
    });

    // ──────────────────────────────────────────────
    // POST /api/convert/all - Convertir todos los pendientes en secuencia
    // ──────────────────────────────────────────────
    router.post('/all', async (req, res) => {
        // Solo 1 batch activo a la vez
        if (activeBatch && activeBatch.status === 'running') {
            return res.status(409).json({
                success: false,
                error: 'Ya hay un batch en progreso',
                batchId: activeBatch.batchId
            });
        }

        try {
            const files = await listConvertibleFiles();

            if (files.length === 0) {
                return res.json({ success: true, message: 'No hay archivos pendientes', total: 0 });
            }

            const batchId = Date.now().toString();
            activeBatch = {
                batchId,
                total: files.length,
                completed: 0,
                current: null,
                errors: [],
                status: 'running',
                results: []
            };

            res.json({ success: true, batchId, total: files.length });

            // Procesar en secuencia en background
            processBatch(batchId, files);
        } catch (error) {
            console.error('Error iniciando batch:', error.message);
            res.status(500).json({ success: false, error: 'Error al iniciar batch' });
        }
    });

    // ──────────────────────────────────────────────
    // GET /api/convert/batch/:batchId/progress - Progreso SSE del batch
    // ──────────────────────────────────────────────
    router.get('/batch/:batchId/progress', (req, res) => {
        const { batchId } = req.params;

        if (!activeBatch || activeBatch.batchId !== batchId) {
            return res.status(404).json({ success: false, error: 'Batch no encontrado' });
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const sendProgress = () => {
            const data = {
                batchId: activeBatch.batchId,
                total: activeBatch.total,
                completed: activeBatch.completed,
                current: activeBatch.current,
                errors: activeBatch.errors,
                status: activeBatch.status
            };
            res.write(`data: ${JSON.stringify(data)}\n\n`);

            if (activeBatch.status === 'completed' || activeBatch.status === 'error') {
                res.end();
                return false;
            }
            return true;
        };

        sendProgress();
        const interval = setInterval(() => {
            if (!sendProgress()) {
                clearInterval(interval);
            }
        }, 2000);

        req.on('close', () => clearInterval(interval));
    });

    // ──────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────

    /**
     * Formatea bytes a string legible (GB/MB)
     */
    function formatFileSize(sizeBytes) {
        if (sizeBytes >= 1024 * 1024 * 1024) {
            return (sizeBytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        }
        return (sizeBytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    /**
     * Lista archivos MKV/AVI convertibles en ambos directorios.
     * Cada archivo incluye source: "movies" | "torrents"
     */
    async function listConvertibleFiles() {
        const convertible = [];

        // 1. Archivos en directorio de peliculas (solo raiz)
        try {
            const files = await fs.readdir(storageConfig.localPath);
            for (const filename of files) {
                const ext = filename.split('.').pop().toLowerCase();
                if (!['mkv', 'avi'].includes(ext)) continue;

                try {
                    const stat = await fs.stat(path.join(storageConfig.localPath, filename));
                    if (!stat.isFile()) continue;
                    convertible.push({
                        filename,
                        extension: ext,
                        size: stat.size,
                        sizeFormatted: formatFileSize(stat.size),
                        source: 'movies'
                    });
                } catch { /* skip */ }
            }
        } catch (err) {
            console.error('Error leyendo directorio de peliculas:', err.message);
        }

        // 2. Archivos en directorio de descargas de Transmission (recursivo)
        try {
            await fs.access(TORRENTS_PATH);
            const torrentFiles = await findVideoFilesRecursive(TORRENTS_PATH);
            for (const filePath of torrentFiles) {
                const filename = path.basename(filePath);
                const ext = filename.split('.').pop().toLowerCase();

                try {
                    const stat = await fs.stat(filePath);
                    // Ruta relativa desde TORRENTS_PATH para identificacion unica
                    const relativePath = path.relative(TORRENTS_PATH, filePath);
                    convertible.push({
                        filename: relativePath,
                        extension: ext,
                        size: stat.size,
                        sizeFormatted: formatFileSize(stat.size),
                        source: 'torrents'
                    });
                } catch { /* skip */ }
            }
        } catch {
            // Directorio de torrents no existe o no accesible — no es error
        }

        return convertible;
    }

    /**
     * Busca archivos de video recursivamente en un directorio
     */
    async function findVideoFilesRecursive(dir) {
        const results = [];
        const videoExts = ['mkv', 'avi', 'mp4', 'mov'];

        async function walk(currentDir) {
            try {
                const entries = await fs.readdir(currentDir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = path.join(currentDir, entry.name);
                    if (entry.isDirectory()) {
                        await walk(fullPath);
                    } else if (entry.isFile()) {
                        const ext = entry.name.split('.').pop().toLowerCase();
                        if (videoExts.includes(ext) && !/\bsample\b/i.test(entry.name)) {
                            results.push(fullPath);
                        }
                    }
                }
            } catch { /* skip inaccessible dirs */ }
        }

        await walk(dir);
        return results;
    }

    /**
     * Obtiene la duracion en segundos de un archivo via FFprobe
     */
    function getDuration(filePath) {
        return new Promise((resolve) => {
            const proc = spawn('ffprobe', [
                '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                filePath
            ]);

            let output = '';
            proc.stdout.on('data', (data) => { output += data.toString(); });
            proc.on('close', () => {
                const dur = parseFloat(output.trim());
                resolve(isNaN(dur) ? 0 : dur);
            });
            proc.on('error', () => resolve(0));
        });
    }

    /**
     * Parsea time=HH:MM:SS.xx de stderr de FFmpeg y devuelve segundos
     */
    function parseTimeFromStderr(line) {
        const match = line.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
        if (!match) return null;
        return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]) + parseInt(match[4]) / 100;
    }

    /**
     * Construye los args de FFmpeg segun el tipo de archivo
     * MKV (H.264) -> copy video, normalizar audio
     * AVI         -> re-encode video + normalizar audio
     */
    function buildFfmpegArgs(inputPath, outputPath, ext) {
        const args = ['-y', '-i', inputPath];

        if (ext === 'mkv') {
            // MKV: copy video stream, normalize audio
            args.push('-c:v', 'copy');
        } else {
            // AVI: re-encode video
            args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '22');
        }

        // Audio siempre normalizado a AAC estereo 48kHz
        args.push(
            '-c:a', 'aac',
            '-ar', '48000',
            '-ac', '2',
            '-b:a', '192k',
            '-movflags', '+faststart',
            outputPath
        );

        return args;
    }

    /**
     * Ejecuta FFmpeg via spawn y reporta progreso al job
     */
    function runFfmpeg(args, durationSec, job) {
        return new Promise((resolve, reject) => {
            const proc = spawn('ffmpeg', args);
            let stderrBuffer = '';

            proc.stderr.on('data', (data) => {
                stderrBuffer += data.toString();

                // FFmpeg usa \r para progreso y \n para info — dividir por ambos
                const lines = stderrBuffer.split(/[\r\n]+/);
                stderrBuffer = lines.pop(); // Guardar linea incompleta

                for (const line of lines) {
                    const timeSec = parseTimeFromStderr(line);
                    if (timeSec !== null) {
                        if (durationSec > 0) {
                            const percent = Math.min(99, (timeSec / durationSec) * 100);
                            const convertProgress = Math.round(percent * 0.9); // 0-90%
                            job.progress = convertProgress;
                            job.message = `Convirtiendo: ${Math.round(percent)}%`;
                        } else {
                            // Sin duracion conocida: mostrar tiempo transcurrido
                            const mins = Math.floor(timeSec / 60);
                            const secs = Math.floor(timeSec % 60);
                            job.progress = Math.min(89, Math.round(timeSec / 10)); // estimacion lenta
                            job.message = `Convirtiendo: ${mins}m ${secs}s procesados`;
                        }
                    }
                }
            });

            proc.on('close', (code) => {
                if (code === 0) resolve();
                else reject(new Error(`FFmpeg exit code ${code}`));
            });

            proc.on('error', (err) => reject(err));

            // Store process ref for potential cancellation
            job._process = proc;
        });
    }

    /**
     * Procesa la conversion de un archivo individual
     */
    async function processConversion(jobId, filename, mp4Filename) {
        const job = conversionJobs.get(jobId);
        const localInput = path.join(storageConfig.localPath, filename);
        const tempSuffix = '.tmp_convert.mp4';
        const localOutput = path.join(storageConfig.localPath, mp4Filename + tempSuffix);

        try {
            // Verify input file exists
            try {
                await fs.access(localInput);
            } catch {
                throw new Error(`Archivo no encontrado: ${filename}`);
            }

            const inputStat = await fs.stat(localInput);
            const ext = filename.split('.').pop().toLowerCase();

            // Get duration for progress tracking
            const durationSec = await getDuration(localInput);

            // Phase 1: Convert with FFmpeg (0-90%)
            job.status = 'converting';
            job.message = ext === 'mkv' ? 'Remuxing MKV (copy video)...' : 'Transcoding AVI...';
            job.progress = 0;

            const ffmpegArgs = buildFfmpegArgs(localInput, localOutput, ext);
            await runFfmpeg(ffmpegArgs, durationSec, job);
            delete job._process;

            console.log(`Convertido: ${filename} -> ${mp4Filename}`);

            // Phase 2: Verify output (90-92%)
            job.status = 'finalizing';
            job.message = 'Verificando archivo convertido...';
            job.progress = 90;

            const outputStat = await fs.stat(localOutput);
            const sizeRatio = outputStat.size / inputStat.size;

            if (sizeRatio < 0.3) {
                throw new Error(`Output sospechosamente pequeno (${(sizeRatio * 100).toFixed(1)}% del original)`);
            }

            // Probe output to verify codecs
            const probeResult = await probeFile(localOutput);
            if (!probeResult || !probeResult.video_codec) {
                throw new Error('Archivo convertido no tiene video valido');
            }

            job.progress = 92;

            // Phase 3: Move to final location (92-95%)
            job.message = 'Moviendo archivo convertido...';
            const finalPath = path.join(storageConfig.localPath, mp4Filename);

            await fs.rename(localOutput, finalPath);
            job.progress = 93;

            // Delete original
            job.message = 'Eliminando archivo original...';
            await fs.unlink(localInput);
            console.log(`Eliminado original: ${filename}`);
            job.progress = 95;

            // Phase 4: Update SQLite (95-100%)
            job.message = 'Actualizando base de datos...';

            const existingData = mediaDB.getMovie(filename);
            if (existingData) {
                mediaDB.upsertMovie(mp4Filename, existingData);
                mediaDB.deleteMovie(filename);
            }

            // Update codec info from probe
            mediaDB.updateMovieCodecInfo(mp4Filename, probeResult);

            job.status = 'completed';
            job.message = 'Conversion completada';
            job.progress = 100;

            console.log(`Conversion completada: ${filename} -> ${mp4Filename}`);

        } catch (error) {
            console.error(`Error en conversion de ${filename}: ${error.message}`);
            job.status = 'error';
            job.message = `Error: ${error.message}`;
            delete job._process;

            // Clean up temp output on error
            await fs.unlink(localOutput).catch(() => {});

            // Limpiar registro SQLite si el archivo original ya no existe
            try {
                await fs.access(localInput);
            } catch (_) {
                mediaDB.deleteMovie(filename);
            }
        } finally {
            // Remove job after 5 minutes
            setTimeout(() => {
                conversionJobs.delete(jobId);
            }, 5 * 60 * 1000);
        }
    }

    /**
     * Procesa un archivo del directorio de torrents ejecutando torrent-done.js.
     * El script se encarga de: extraer comprimidos, escanear ClamAV, buscar TMDB,
     * renombrar, convertir FFmpeg y mover a /mnt/peliculas/.
     */
    async function processTorrentConversion(jobId, filename) {
        const job = conversionJobs.get(jobId);

        // filename es ruta relativa desde TORRENTS_PATH (puede incluir subcarpetas)
        const fullPath = path.join(TORRENTS_PATH, filename);
        const torrentDir = path.dirname(fullPath);
        const torrentName = path.basename(fullPath);

        // Si el archivo esta en la raiz de TORRENTS_PATH, el dir es TORRENTS_PATH y name es el filename
        // Si esta en subcarpeta, el dir es la subcarpeta padre y name es el nombre del directorio del torrent
        // torrent-done.js espera TR_TORRENT_DIR + TR_TORRENT_NAME = ruta completa
        const isInSubdir = path.dirname(filename) !== '.';
        const trDir = isInSubdir ? TORRENTS_PATH : TORRENTS_PATH;
        const trName = isInSubdir ? filename.split(path.sep)[0] : torrentName;

        try {
            // Verificar que el archivo existe
            try {
                await fs.access(fullPath);
            } catch {
                throw new Error(`Archivo no encontrado: ${filename}`);
            }

            // Verificar que el script existe
            try {
                await fs.access(TORRENT_DONE_SCRIPT);
            } catch {
                throw new Error(`Script torrent-done.js no encontrado en: ${TORRENT_DONE_SCRIPT}`);
            }

            job.status = 'converting';
            job.message = 'Procesando torrent (extrayendo, escaneando, renombrando, convirtiendo)...';
            job.progress = 10;

            // Ejecutar torrent-done.js como proceso hijo
            await new Promise((resolve, reject) => {
                const proc = spawn('node', [TORRENT_DONE_SCRIPT], {
                    env: {
                        ...process.env,
                        TR_TORRENT_DIR: trDir,
                        TR_TORRENT_NAME: trName,
                        TR_TORRENT_ID: jobId
                    },
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                let lastOutput = '';
                let lastError = '';

                proc.stdout.on('data', (data) => {
                    const lines = data.toString().trim().split('\n');
                    for (const line of lines) {
                        lastOutput = line;
                        // Parsear fases del script para reportar progreso
                        if (line.includes('[ARCHIVE]') && line.includes('Extrayendo')) {
                            job.message = 'Extrayendo archivos comprimidos...';
                            job.progress = 20;
                        } else if (line.includes('[CLAMAV]') && line.includes('Escaneando')) {
                            job.message = 'Escaneando antivirus...';
                            job.progress = 30;
                        } else if (line.includes('[CLAMAV]') && line.includes('VIRUS')) {
                            job.message = 'Virus detectado, archivo eliminado';
                        } else if (line.includes('[TMDB]') && line.includes('Buscando')) {
                            job.message = 'Buscando titulo en TMDB...';
                            job.progress = 40;
                        } else if (line.includes('[TMDB]') && line.includes('Encontrado')) {
                            const match = line.match(/Encontrado.*?"([^"]+)"/);
                            if (match) {
                                job.message = `TMDB: ${match[1]}`;
                                job.mp4Filename = match[1];
                            }
                            job.progress = 50;
                        } else if (line.includes('[FFMPEG]') && line.includes('Convirtiendo')) {
                            job.message = 'Convirtiendo video...';
                            job.progress = 60;
                        } else if (line.includes('[FFMPEG] Progress:')) {
                            const pctMatch = line.match(/Progress:\s*(\d+)%/);
                            if (pctMatch) {
                                const ffmpegPct = parseInt(pctMatch[1]);
                                // Mapear 0-100% de FFmpeg a 60-85% del progreso total
                                job.progress = Math.round(60 + (ffmpegPct * 25 / 100));
                                job.message = `Convirtiendo video: ${ffmpegPct}%`;
                            }
                        } else if (line.includes('[FFMPEG]') && line.includes('exitosa')) {
                            job.message = 'Conversion completada, moviendo...';
                            job.progress = 85;
                        } else if (line.includes('Movido:') || line.includes('Copiado:')) {
                            job.message = 'Archivo movido a peliculas';
                            job.progress = 90;
                        } else if (line.includes('Proceso completado')) {
                            job.progress = 95;
                        }
                    }
                });

                proc.stderr.on('data', (data) => {
                    lastError += data.toString();
                });

                proc.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(lastOutput || lastError || `torrent-done.js exit code ${code}`));
                    }
                });

                proc.on('error', (err) => {
                    reject(new Error(`Error ejecutando torrent-done.js: ${err.message}`));
                });

                job._process = proc;
            });

            delete job._process;

            job.status = 'completed';
            job.message = 'Torrent procesado correctamente';
            job.progress = 100;
            console.log(`Torrent procesado: ${filename}`);

        } catch (error) {
            console.error(`Error procesando torrent ${filename}: ${error.message}`);
            job.status = 'error';
            job.message = `Error: ${error.message}`;
            delete job._process;
        } finally {
            // Eliminar job despues de 5 minutos
            setTimeout(() => {
                conversionJobs.delete(jobId);
            }, 5 * 60 * 1000);
        }
    }

    /**
     * Procesa batch de conversiones en secuencia
     */
    async function processBatch(batchId, files) {
        for (const file of files) {
            if (activeBatch.status !== 'running') break;

            const mp4Filename = file.filename.replace(/\.(avi|mkv|mov)$/i, '.mp4');
            activeBatch.current = { filename: file.filename, mp4Filename, source: file.source };

            const jobId = Date.now().toString();
            conversionJobs.set(jobId, {
                status: 'starting',
                progress: 0,
                filename: file.filename,
                mp4Filename,
                message: 'Iniciando...',
                source: file.source || 'movies'
            });

            if (file.source === 'torrents') {
                await processTorrentConversion(jobId, file.filename);
            } else {
                await processConversion(jobId, file.filename, mp4Filename);
            }

            const job = conversionJobs.get(jobId);
            if (job && job.status === 'error') {
                activeBatch.errors.push({ filename: file.filename, error: job.message });
            }

            activeBatch.completed++;
        }

        activeBatch.current = null;
        activeBatch.status = 'completed';
        console.log(`Batch ${batchId} completado: ${activeBatch.completed}/${activeBatch.total}, ${activeBatch.errors.length} errores`);
    }

    return router;
};
