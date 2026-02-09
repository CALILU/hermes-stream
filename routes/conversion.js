/**
 * routes/conversion.js - Rutas de conversión de video (AVI/MKV → MP4)
 *
 * POST /              - Iniciar conversión
 * GET  /:jobId/progress - Progreso de conversión (SSE)
 *
 * Montado en: /api/convert
 */

const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const ftp = require('basic-ftp');
const ffmpeg = require('fluent-ffmpeg');

module.exports = function createConversionRoutes(deps) {
    const {
        conversionJobs, TEMP_DIR, FTP_CONFIG,
        readCache, writeCache,
        readCollections, writeCollections
    } = deps;

    const router = express.Router();

    // POST /api/convert - Iniciar conversión
    router.post('/', async (req, res) => {
        const { filename } = req.body;

        if (!filename) {
            return res.status(400).json({ error: 'Filename requerido' });
        }

        const ext = filename.split('.').pop().toLowerCase();
        if (!['avi', 'mkv'].includes(ext)) {
            return res.status(400).json({ error: 'Solo se pueden convertir archivos AVI o MKV' });
        }

        const jobId = Date.now().toString();
        const mp4Filename = filename.replace(/\.(avi|mkv)$/i, '.mp4');

        conversionJobs.set(jobId, {
            status: 'starting',
            progress: 0,
            filename,
            mp4Filename,
            message: 'Iniciando conversión...'
        });

        res.json({ jobId, mp4Filename });

        // Ejecutar conversión en background
        processConversion(jobId, filename, mp4Filename);
    });

    // GET /api/convert/:jobId/progress - Progreso de conversión (SSE)
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
        const localInput = path.join(TEMP_DIR, filename);
        const localOutput = path.join(TEMP_DIR, mp4Filename);
        const client = new ftp.Client();

        try {
            // Paso 1: Descargar archivo original
            job.status = 'downloading';
            job.message = 'Descargando archivo del servidor...';
            job.progress = 5;

            await client.access({ ...FTP_CONFIG, secure: false, passive: true });

            // Obtener tamaño para calcular progreso de descarga
            const fileList = await client.list("/volume-1");
            const fileInfo = fileList.find(f => f.name === filename);
            const totalSize = fileInfo ? fileInfo.size : 0;

            // Descargar con progreso
            client.trackProgress(info => {
                if (totalSize > 0) {
                    const dlProgress = Math.round((info.bytes / totalSize) * 30); // 0-30%
                    job.progress = 5 + dlProgress;
                    job.message = `Descargando: ${(info.bytes / 1024 / 1024).toFixed(0)} MB / ${(totalSize / 1024 / 1024).toFixed(0)} MB`;
                }
            });

            await client.downloadTo(localInput, `/volume-1/${filename}`);
            client.trackProgress(); // Desactivar tracking

            console.log(`📥 Descargado: ${filename}`);

            // Paso 2: Convertir con FFmpeg
            job.status = 'converting';
            job.message = 'Convirtiendo a MP4...';
            job.progress = 35;

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
                        const convertProgress = Math.round((progress.percent || 0) * 0.4); // 35-75%
                        job.progress = 35 + convertProgress;
                        job.message = `Convirtiendo: ${Math.round(progress.percent || 0)}%`;
                    })
                    .on('end', () => {
                        console.log(`✅ Convertido: ${mp4Filename}`);
                        resolve();
                    })
                    .on('error', (err) => {
                        console.error(`❌ Error FFmpeg: ${err.message}`);
                        reject(err);
                    })
                    .save(localOutput);
            });

            // Paso 3: Subir MP4 al servidor
            job.status = 'uploading';
            job.message = 'Subiendo MP4 al servidor...';
            job.progress = 75;

            const outputStats = await fs.stat(localOutput);
            const outputSize = outputStats.size;

            client.trackProgress(info => {
                const ulProgress = Math.round((info.bytes / outputSize) * 15); // 75-90%
                job.progress = 75 + ulProgress;
                job.message = `Subiendo: ${(info.bytes / 1024 / 1024).toFixed(0)} MB / ${(outputSize / 1024 / 1024).toFixed(0)} MB`;
            });

            await client.uploadFrom(localOutput, `/volume-1/${mp4Filename}`);
            client.trackProgress();

            console.log(`📤 Subido: ${mp4Filename}`);

            // Paso 4: Borrar archivo original del servidor
            job.status = 'deleting';
            job.message = 'Eliminando archivo original...';
            job.progress = 92;

            await client.remove(`/volume-1/${filename}`);
            console.log(`🗑️ Eliminado original: ${filename}`);

            // Paso 5: Actualizar caché
            job.message = 'Actualizando caché...';
            job.progress = 95;

            const cache = await readCache();
            if (cache[filename]) {
                cache[mp4Filename] = { ...cache[filename] };
                delete cache[filename];
                await writeCache(cache);
            }

            // Actualizar colecciones
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

            // Limpiar archivos temporales
            await fs.unlink(localInput).catch(() => {});
            await fs.unlink(localOutput).catch(() => {});

            job.status = 'completed';
            job.message = 'Conversión completada';
            job.progress = 100;

            console.log(`✅ Conversión completada: ${filename} → ${mp4Filename}`);

        } catch (error) {
            console.error(`❌ Error en conversión: ${error.message}`);
            job.status = 'error';
            job.message = `Error: ${error.message}`;

            // Limpiar archivos temporales en caso de error
            await fs.unlink(localInput).catch(() => {});
            await fs.unlink(localOutput).catch(() => {});
        } finally {
            client.close();

            // Eliminar job después de 5 minutos
            setTimeout(() => {
                conversionJobs.delete(jobId);
            }, 5 * 60 * 1000);
        }
    }

    return router;
};
