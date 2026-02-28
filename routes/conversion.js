/**
 * routes/conversion.js - Rutas de conversion de video (AVI/MKV -> MP4)
 *
 * POST /              - Iniciar conversion
 * GET  /:jobId/progress - Progreso de conversion (SSE)
 *
 * Montado en: /api/convert
 *
 * Local-only mode: converts in-place on disk (no FTP download/upload).
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

module.exports = function createConversionRoutes(deps) {
    const {
        conversionJobs, TEMP_DIR, storageConfig,
        readCache, writeCache,
        readCollections, writeCollections
    } = deps;

    const router = express.Router();

    // POST /api/convert - Iniciar conversion
    router.post('/', async (req, res) => {
        const { filename } = req.body;

        if (!filename) {
            return res.status(400).json({ error: 'Filename requerido' });
        }

        const ext = filename.split('.').pop().toLowerCase();
        if (!['avi', 'mkv'].includes(ext)) {
            return res.status(400).json({ error: 'Solo se pueden convertir archivos AVI o MKV' });
        }

        // Protección contra duplicados: buscar conversión activa del mismo archivo
        for (const [existingJobId, job] of conversionJobs.entries()) {
            if (job.filename === filename && ['starting', 'converting', 'finalizing'].includes(job.status)) {
                return res.json({ jobId: existingJobId, mp4Filename: job.mp4Filename, duplicate: true });
            }
        }

        const jobId = Date.now().toString();
        const mp4Filename = filename.replace(/\.(avi|mkv)$/i, '.mp4');

        conversionJobs.set(jobId, {
            status: 'starting',
            progress: 0,
            filename,
            mp4Filename,
            message: 'Iniciando conversion...'
        });

        res.json({ jobId, mp4Filename });

        // Ejecutar conversion en background
        processConversion(jobId, filename, mp4Filename);
    });

    // GET /api/convert/:jobId/progress - Progreso de conversion (SSE)
    router.get('/:jobId/progress', (req, res) => {
        const { jobId } = req.params;

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

    async function processConversion(jobId, filename, mp4Filename) {
        const job = conversionJobs.get(jobId);
        const localInput = path.join(storageConfig.localPath, filename);
        const localOutput = path.join(TEMP_DIR, mp4Filename);

        try {
            // Verify input file exists
            try {
                await fs.access(localInput);
            } catch {
                throw new Error(`Archivo no encontrado: ${localInput}`);
            }

            // Phase 1: Convert with FFmpeg (0-90%)
            job.status = 'converting';
            job.message = 'Convirtiendo a MP4...';
            job.progress = 0;

            await new Promise((resolve, reject) => {
                ffmpeg(localInput)
                    .outputOptions([
                        '-c:v libx264',
                        '-preset medium',
                        '-crf 22',
                        '-c:a aac',
                        '-b:a 192k',
                        '-movflags +faststart'
                    ])
                    .on('progress', (progress) => {
                        const percent = progress.percent || 0;
                        const convertProgress = Math.round(percent * 0.9); // 0-90%
                        job.progress = convertProgress;
                        job.message = `Convirtiendo: ${Math.round(percent)}%`;
                    })
                    .on('end', () => {
                        console.log(`Convertido: ${mp4Filename}`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`Error FFmpeg: ${err.message}`);
                        reject(err);
                    })
                    .save(localOutput);
            });

            // Phase 2: Finalize - move output and delete original (90-95%)
            job.status = 'finalizing';
            job.message = 'Moviendo archivo convertido...';
            job.progress = 90;

            const finalPath = path.join(storageConfig.localPath, mp4Filename);

            // Move converted file to storage directory
            try {
                await fs.rename(localOutput, finalPath);
            } catch (renameErr) {
                // rename fails across filesystems; fallback to copy+delete
                if (renameErr.code === 'EXDEV') {
                    await fs.copyFile(localOutput, finalPath);
                    await fs.unlink(localOutput).catch(() => {});
                } else {
                    throw renameErr;
                }
            }

            job.progress = 92;
            job.message = 'Eliminando archivo original...';

            // Delete original file
            await fs.unlink(localInput);
            console.log(`Eliminado original: ${filename}`);

            // Phase 3: Update cache and collections (95-100%)
            job.message = 'Actualizando cache...';
            job.progress = 95;

            const cache = await readCache();
            if (cache[filename]) {
                cache[mp4Filename] = { ...cache[filename] };
                delete cache[filename];
                await writeCache(cache);
            }

            // Update collections
            const collections = await readCollections();
            let collectionsUpdated = false;
            for (const collectionId in collections) {
                const collection = collections[collectionId];
                const movieIndex = collection.movies.findIndex(m => m.filename === filename);
                if (movieIndex !== -1) {
                    collection.movies[movieIndex].filename = mp4Filename;
                    collectionsUpdated = true;
                }
            }
            if (collectionsUpdated) {
                await writeCollections(collections);
            }

            job.status = 'completed';
            job.message = 'Conversion completada';
            job.progress = 100;

            console.log(`Conversion completada: ${filename} -> ${mp4Filename}`);

        } catch (error) {
            console.error(`Error en conversion: ${error.message}`);
            job.status = 'error';
            job.message = `Error: ${error.message}`;

            // Clean up temp output on error
            await fs.unlink(localOutput).catch(() => {});
        } finally {
            // Remove job after 5 minutes
            setTimeout(() => {
                conversionJobs.delete(jobId);
            }, 5 * 60 * 1000);
        }
    }

    return router;
};
