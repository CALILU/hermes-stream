/**
 * routes/streaming.js - Rutas de streaming de video y audio tracks
 *
 * GET  /api/audio-tracks/:filename  - Detectar pistas de audio
 * HEAD /stream/:filename            - Metadatos de archivo
 * GET  /stream/:filename            - Streaming de video (local/FTP, transcode/directo)
 *
 * Montado en: / (rutas absolutas)
 */

const express = require('express');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');
const ftp = require('basic-ftp');
const ffmpeg = require('fluent-ffmpeg');
const { PassThrough } = require('stream');

module.exports = function createStreamingRoutes(deps) {
    const {
        storageConfig, FTP_CONFIG, TEMP_DIR
    } = deps;

    const router = express.Router();

    // Función para formatear etiqueta de pista de audio
    function formatAudioLabel(track) {
        const parts = [];

        // Idioma
        const langMap = {
            'spa': 'Español', 'es': 'Español', 'spanish': 'Español',
            'eng': 'English', 'en': 'English', 'english': 'English',
            'fra': 'Français', 'fr': 'Français', 'french': 'Français',
            'deu': 'Deutsch', 'de': 'Deutsch', 'german': 'Deutsch',
            'ita': 'Italiano', 'it': 'Italiano', 'italian': 'Italiano',
            'por': 'Português', 'pt': 'Português', 'portuguese': 'Português',
            'jpn': 'Japanese', 'ja': 'Japanese', 'japanese': 'Japanese',
            'und': 'Desconocido', 'unknown': 'Desconocido'
        };
        const lang = track.tags?.language?.toLowerCase() || 'und';
        parts.push(langMap[lang] || lang.toUpperCase());

        // Título si existe
        if (track.tags?.title) {
            parts.push(`(${track.tags.title})`);
        }

        // Canales
        if (track.channel_layout) {
            parts.push(`- ${track.channel_layout}`);
        } else if (track.channels) {
            parts.push(`- ${track.channels}ch`);
        }

        // Códec
        const codecMap = {
            'aac': 'AAC', 'ac3': 'AC3', 'eac3': 'E-AC3',
            'dts': 'DTS', 'truehd': 'TrueHD', 'flac': 'FLAC',
            'mp3': 'MP3', 'vorbis': 'Vorbis', 'opus': 'Opus'
        };
        const codec = codecMap[track.codec_name?.toLowerCase()] || track.codec_name?.toUpperCase();
        if (codec) parts.push(`[${codec}]`);

        return parts.join(' ');
    }

    // GET /api/audio-tracks/:filename - Detectar pistas de audio
    router.get('/api/audio-tracks/:filename', async (req, res) => {
        const filename = decodeURIComponent(req.params.filename);
        console.log(`🔊 Detectando pistas de audio: ${filename} [${storageConfig.mode.toUpperCase()}]`);

        let fileToProbe = null;
        let tempFile = null;
        let client = null;

        try {
            // ========== MODO LOCAL ==========
            if (storageConfig.mode === 'local') {
                const localPath = path.join(storageConfig.localPath, filename);

                if (!fsSync.existsSync(localPath)) {
                    return res.status(404).json({ error: 'Archivo no encontrado' });
                }

                fileToProbe = localPath; // Analizar directamente sin copiar

            // ========== MODO FTP ==========
            } else {
                client = new ftp.Client();
                tempFile = path.join(TEMP_DIR, `probe_${Date.now()}_${filename.replace(/[^a-zA-Z0-9.-]/g, '_')}`);

                await client.access({ ...FTP_CONFIG, secure: false, passive: true });

                const fileList = await client.list("/volume-1");
                const fileInfo = fileList.find(f => f.name === filename);

                if (!fileInfo) {
                    client.close();
                    return res.status(404).json({ error: 'Archivo no encontrado' });
                }

                // Descargar solo los primeros 50MB para analizar
                const writeStream = fsSync.createWriteStream(tempFile);
                const passThrough = new PassThrough();

                let bytesWritten = 0;
                const maxBytes = 50 * 1024 * 1024;

                passThrough.on('data', (chunk) => {
                    if (bytesWritten < maxBytes) {
                        const remaining = maxBytes - bytesWritten;
                        const toWrite = chunk.slice(0, Math.min(chunk.length, remaining));
                        writeStream.write(toWrite);
                        bytesWritten += toWrite.length;
                        if (bytesWritten >= maxBytes) {
                            passThrough.destroy();
                            writeStream.end();
                        }
                    }
                });

                passThrough.on('end', () => writeStream.end());
                passThrough.on('error', () => writeStream.end());

                await client.downloadTo(passThrough, `/volume-1/${filename}`).catch(() => {});
                client.close();
                client = null;

                await new Promise(resolve => writeStream.on('close', resolve));
                fileToProbe = tempFile;
            }

            // Usar ffprobe para obtener información de pistas
            const ffprobeResult = await new Promise((resolve, reject) => {
                ffmpeg.ffprobe(fileToProbe, (err, metadata) => {
                    if (err) reject(err);
                    else resolve(metadata);
                });
            });

            // Extraer pistas de audio
            const audioTracks = ffprobeResult.streams
                .filter(s => s.codec_type === 'audio')
                .map((track, index) => ({
                    index: track.index,
                    streamIndex: index,
                    codec: track.codec_name,
                    language: track.tags?.language || 'und',
                    title: track.tags?.title || null,
                    channels: track.channels,
                    channelLayout: track.channel_layout || `${track.channels}ch`,
                    bitrate: track.bit_rate ? Math.round(track.bit_rate / 1000) + ' kbps' : null,
                    default: track.disposition?.default === 1,
                    label: formatAudioLabel(track)
                }));

            // Limpiar archivo temporal (solo si es FTP)
            if (tempFile) {
                await fs.unlink(tempFile).catch(() => {});
            }

            console.log(`🔊 Encontradas ${audioTracks.length} pistas de audio`);
            res.json({ tracks: audioTracks, filename });

        } catch (error) {
            console.error('Error detectando pistas de audio:', error.message);
            if (tempFile) await fs.unlink(tempFile).catch(() => {});
            if (client) client.close();
            res.status(500).json({ error: 'Error al analizar el archivo' });
        }
    });

    // HEAD /stream/:filename - Metadatos de archivo
    router.head('/stream/:filename', async (req, res) => {
        const filename = decodeURIComponent(req.params.filename);
        console.log(`📋 HEAD request: ${filename} [${storageConfig.mode.toUpperCase()}]`);

        try {
            let fileSize = 0;

            // ========== MODO LOCAL ==========
            if (storageConfig.mode === 'local') {
                const localPath = path.join(storageConfig.localPath, filename);
                if (!fsSync.existsSync(localPath)) {
                    return res.status(404).end();
                }
                const stats = fsSync.statSync(localPath);
                fileSize = stats.size;

            // ========== MODO FTP ==========
            } else {
                const client = new ftp.Client();
                client.ftp.verbose = false;

                try {
                    await client.access({
                        ...FTP_CONFIG,
                        secure: false,
                        passive: true
                    });

                    const fileList = await client.list("/volume-1");
                    const fileInfo = fileList.find(f => f.name === filename);

                    if (!fileInfo) {
                        client.close();
                        return res.status(404).end();
                    }
                    fileSize = fileInfo.size;
                } finally {
                    client.close();
                }
            }

            const headExt = filename.split('.').pop().toLowerCase();
            const mimeType = headExt === 'mkv' ? 'video/x-matroska' : 'video/mp4';
            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Length', fileSize);
            res.setHeader('Accept-Ranges', 'bytes');
            res.status(200).end();
        } catch (err) {
            console.error('HEAD error:', err.message);
            res.status(500).end();
        }
    });

    // GET /stream/:filename - Streaming de video
    router.get('/stream/:filename', async (req, res) => {
        const filename = decodeURIComponent(req.params.filename);
        const ext = filename.split('.').pop().toLowerCase();
        const needsTranscode = ['avi'].includes(ext);
        const audioTrack = parseInt(req.query.audio) || 0;

        const mimeType = ext === 'mkv' ? 'video/x-matroska' : 'video/mp4';
        console.log(`🎬 Streaming: ${filename} [${storageConfig.mode.toUpperCase()}] (transcode: ${needsTranscode}, audio: ${audioTrack})`);

        // ========== MODO LOCAL ==========
        if (storageConfig.mode === 'local') {
            const localPath = path.join(storageConfig.localPath, filename);

            if (!fsSync.existsSync(localPath)) {
                return res.status(404).send('Video no encontrado');
            }

            const stat = fsSync.statSync(localPath);
            const fileSize = stat.size;
            console.log(`📁 Archivo local: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

            // Si necesita transcodificación (MKV, AVI)
            if (needsTranscode) {
                console.log(`🔄 Transcodificando archivo local a MP4 (pista audio: ${audioTrack})...`);

                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Transfer-Encoding', 'chunked');
                res.setHeader('Cache-Control', 'no-cache');

                const ffmpegProcess = ffmpeg(localPath)
                    .inputFormat(ext === 'mkv' ? 'matroska' : 'avi')
                    .outputOptions([
                        '-map', '0:v:0',
                        `-map`, `0:a:${audioTrack}`,
                        '-c:v libx264',
                        '-preset ultrafast',
                        '-crf 23',
                        '-c:a aac',
                        '-b:a 192k',
                        '-movflags frag_keyframe+empty_moov+faststart',
                        '-f mp4'
                    ])
                    .on('start', () => console.log('▶️ FFmpeg iniciado (local)'))
                    .on('error', (err) => {
                        if (!err.message.includes('SIGKILL')) {
                            console.error('❌ FFmpeg error:', err.message);
                        }
                    })
                    .on('end', () => console.log('✅ Transcodificación completada'));

                ffmpegProcess.pipe(res, { end: true });

                res.on('close', () => {
                    ffmpegProcess.kill('SIGKILL');
                });

                return;
            }

            // MP4/MOV local - si se solicita una pista de audio específica, usar FFmpeg
            if (audioTrack > 0) {
                console.log(`🔄 Remuxeando MP4 local con pista de audio ${audioTrack}...`);

                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Transfer-Encoding', 'chunked');
                res.setHeader('Cache-Control', 'no-cache');

                const ffmpegProcess = ffmpeg(localPath)
                    .outputOptions([
                        '-map', '0:v:0',
                        `-map`, `0:a:${audioTrack}`,
                        '-c:v copy',  // Copiar video sin recodificar
                        '-c:a aac',   // Convertir audio a AAC para compatibilidad
                        '-b:a 192k',
                        '-movflags frag_keyframe+empty_moov+faststart',
                        '-f mp4'
                    ])
                    .on('start', () => console.log('▶️ FFmpeg remux iniciado (MP4 local)'))
                    .on('error', (err) => {
                        if (!err.message.includes('SIGKILL')) {
                            console.error('❌ FFmpeg error:', err.message);
                        }
                    })
                    .on('end', () => console.log('✅ Remux completado'));

                ffmpegProcess.pipe(res, { end: true });

                res.on('close', () => {
                    ffmpegProcess.kill('SIGKILL');
                });

                return;
            }

            // MP4/MOV local - streaming directo con Range requests (pista por defecto)
            const range = req.headers.range;

            if (range) {
                const parts = range.replace(/bytes=/, '').split('-');
                const start = parseInt(parts[0], 10);
                const requestedEnd = parts[1] ? parseInt(parts[1], 10) : null;
                const end = requestedEnd !== null ? requestedEnd : Math.min(start + 5 * 1024 * 1024 - 1, fileSize - 1);
                const chunkSize = end - start + 1;

                console.log(`📦 Range local: bytes=${start}-${end}/${fileSize} (${(chunkSize / 1024 / 1024).toFixed(2)} MB)`);

                res.status(206);
                res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Content-Length', chunkSize);
                res.setHeader('Content-Type', mimeType);

                const readStream = fsSync.createReadStream(localPath, { start, end });
                readStream.pipe(res);

                res.on('close', () => readStream.destroy());
            } else {
                console.log(`📥 Request local sin Range - enviando archivo completo`);

                res.status(200);
                res.setHeader('Content-Type', mimeType);
                res.setHeader('Content-Length', fileSize);
                res.setHeader('Accept-Ranges', 'bytes');

                const readStream = fsSync.createReadStream(localPath);
                readStream.pipe(res);

                res.on('close', () => readStream.destroy());
            }

            return;
        }

        // ========== MODO FTP (código original) ==========
        const client = new ftp.Client();
        client.ftp.timeout = 300000;
        client.ftp.verbose = false;

        try {
            await client.access({
                ...FTP_CONFIG,
                secure: false,
                passive: true
            });

            const fileList = await client.list("/volume-1");
            const fileInfo = fileList.find(f => f.name === filename);

            if (!fileInfo) {
                client.close();
                return res.status(404).send('Video no encontrado');
            }

            const fileSize = fileInfo.size;
            console.log(`📁 Archivo FTP: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

            // Si necesita transcodificación (MKV, AVI)
            if (needsTranscode) {
                console.log(`🔄 Transcodificando a MP4 (pista audio: ${audioTrack})...`);

                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Transfer-Encoding', 'chunked');
                res.setHeader('Cache-Control', 'no-cache');

                // Crear stream desde FTP
                const ftpStream = new PassThrough();

                // FFmpeg transcodifica el stream con la pista de audio seleccionada
                const ffmpegProcess = ffmpeg(ftpStream)
                    .inputFormat(ext === 'mkv' ? 'matroska' : 'avi')
                    .outputOptions([
                        '-map', '0:v:0',           // Primera pista de video
                        `-map`, `0:a:${audioTrack}`, // Pista de audio seleccionada
                        '-c:v libx264',
                        '-preset ultrafast',
                        '-crf 23',
                        '-c:a aac',
                        '-b:a 192k',
                        '-movflags frag_keyframe+empty_moov+faststart',
                        '-f mp4'
                    ])
                    .on('start', () => console.log('▶️ FFmpeg iniciado'))
                    .on('error', (err) => {
                        if (!err.message.includes('SIGKILL')) {
                            console.error('❌ FFmpeg error:', err.message);
                        }
                    })
                    .on('end', () => console.log('✅ Transcodificación completada'));

                ffmpegProcess.pipe(res, { end: true });

                // Descargar desde FTP al pipe de FFmpeg
                await client.downloadTo(ftpStream, `/volume-1/${filename}`);
                ftpStream.end();

                // Cleanup cuando el cliente cierra la conexión
                res.on('close', () => {
                    ffmpegProcess.kill('SIGKILL');
                    client.close();
                });

            } else if (audioTrack > 0) {
                // MP4/MOV FTP - remuxear con pista de audio específica
                console.log(`🔄 Remuxeando MP4 FTP con pista de audio ${audioTrack}...`);

                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Transfer-Encoding', 'chunked');
                res.setHeader('Cache-Control', 'no-cache');

                const ftpStream = new PassThrough();

                const ffmpegProcess = ffmpeg(ftpStream)
                    .outputOptions([
                        '-map', '0:v:0',
                        `-map`, `0:a:${audioTrack}`,
                        '-c:v copy',  // Copiar video sin recodificar
                        '-c:a aac',
                        '-b:a 192k',
                        '-movflags frag_keyframe+empty_moov+faststart',
                        '-f mp4'
                    ])
                    .on('start', () => console.log('▶️ FFmpeg remux iniciado (MP4 FTP)'))
                    .on('error', (err) => {
                        if (!err.message.includes('SIGKILL')) {
                            console.error('❌ FFmpeg error:', err.message);
                        }
                    })
                    .on('end', () => console.log('✅ Remux completado'));

                ffmpegProcess.pipe(res, { end: true });

                await client.downloadTo(ftpStream, `/volume-1/${filename}`);
                ftpStream.end();

                res.on('close', () => {
                    ffmpegProcess.kill('SIGKILL');
                    client.close();
                });

            } else {
                // MP4/MOV - streaming directo con Range requests (pista por defecto)
                const range = req.headers.range;

                if (range) {
                    // Parsear Range header
                    const parts = range.replace(/bytes=/, '').split('-');
                    const start = parseInt(parts[0], 10);
                    // Si no hay end, enviar chunk de 5MB (o hasta el final)
                    const requestedEnd = parts[1] ? parseInt(parts[1], 10) : null;
                    const end = requestedEnd !== null ? requestedEnd : Math.min(start + 5 * 1024 * 1024 - 1, fileSize - 1);

                    const chunkSize = end - start + 1;

                    const isSeekRequest = start > 1024 * 1024; // Más de 1MB desde el inicio = seeking
                    console.log(`📦 Range: bytes=${start}-${end}/${fileSize} (${(chunkSize / 1024 / 1024).toFixed(2)} MB) ${isSeekRequest ? '⏩ SEEK' : '▶️ START'}`);

                    res.status(206);
                    res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
                    res.setHeader('Accept-Ranges', 'bytes');
                    res.setHeader('Content-Length', chunkSize);
                    res.setHeader('Content-Type', mimeType);
                    res.setHeader('Cache-Control', 'no-cache');
                    res.setHeader('Connection', 'keep-alive');

                    // Descargar usando offset nativo de FTP (comando REST)

                    const passThrough = new PassThrough();

                    let bytesReceived = 0;
                    const bytesNeeded = chunkSize;
                    let firstChunk = true;

                    passThrough.on('data', (chunk) => {
                        if (firstChunk) {
                            console.log(`   ✓ Recibiendo datos (primer chunk: ${chunk.length} bytes)`);
                            firstChunk = false;
                        }
                        bytesReceived += chunk.length;

                        // Si recibimos más de lo necesario, recortar
                        if (bytesReceived > bytesNeeded) {
                            const excess = bytesReceived - bytesNeeded;
                            const trimmed = chunk.slice(0, chunk.length - excess);
                            if (trimmed.length > 0) {
                                res.write(trimmed);
                            }
                            console.log(`   ✓ Completado: ${bytesReceived} bytes recibidos, ${chunkSize} enviados`);
                            passThrough.destroy();
                            res.end();
                            client.close();
                        } else {
                            res.write(chunk);

                            // Si ya tenemos todo, terminar
                            if (bytesReceived >= bytesNeeded) {
                                console.log(`   ✓ Completado: ${bytesReceived} bytes`);
                                passThrough.destroy();
                                res.end();
                                client.close();
                            }
                        }
                    });

                    passThrough.on('end', () => {
                        if (!res.writableEnded) {
                            console.log(`   ⚠️ Stream terminó antes de completar (${bytesReceived}/${bytesNeeded})`);
                            res.end();
                        }
                        client.close();
                    });

                    passThrough.on('error', (err) => {
                        console.error(`   ❌ Stream error: ${err.message}`);
                        client.close();
                    });

                    res.on('close', () => {
                        passThrough.destroy();
                        client.close();
                    });

                    // Usar offset nativo de FTP - el tercer parámetro es startAt (byte offset)
                    console.log(`   → FTP downloadTo con offset ${start}`);
                    client.downloadTo(passThrough, `/volume-1/${filename}`, start).catch((err) => {
                        console.error(`   ❌ FTP error: ${err.message}`);
                        if (!res.headersSent) {
                            res.status(500).end();
                        }
                        client.close();
                    });

                } else {
                    // Sin Range - responder con 200 y headers para que el navegador sepa que puede usar Range
                    console.log(`📥 Request sin Range - enviando headers completos`);

                    res.status(200);
                    res.setHeader('Content-Type', mimeType);
                    res.setHeader('Content-Length', fileSize);
                    res.setHeader('Accept-Ranges', 'bytes');
                    res.setHeader('Cache-Control', 'public, max-age=3600');
                    res.setHeader('Connection', 'keep-alive');

                    // El navegador debería hacer peticiones Range después de recibir estos headers
                    // Enviamos el archivo completo si el navegador no usa Range

                    const passThrough = new PassThrough();

                    passThrough.pipe(res);

                    passThrough.on('error', () => client.close());
                    res.on('close', () => {
                        passThrough.destroy();
                        client.close();
                    });

                    client.downloadTo(passThrough, `/volume-1/${filename}`).catch(() => client.close());
                }
            }

        } catch (err) {
            console.error('❌ Error streaming:', err.message);
            if (!res.headersSent) {
                res.status(500).send('Error al transmitir video');
            }
            client.close();
        }
    });

    return router;
};
