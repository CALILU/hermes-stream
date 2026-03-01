/**
 * routes/streaming.js - Rutas de streaming de video y audio tracks
 *
 * GET  /api/audio-tracks/:filename  - Detectar pistas de audio
 * HEAD /stream/:filename            - Metadatos de archivo
 * GET  /stream/:filename            - Streaming de video (local, transcode/directo)
 *
 * Montado en: / (rutas absolutas)
 */

const express = require('express');
const fsSync = require('fs');
const fs = require('fs').promises;
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

module.exports = function createStreamingRoutes(deps) {
    const {
        storageConfig, TEMP_DIR
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
        console.log(`🔊 Detectando pistas de audio: ${filename} [LOCAL]`);

        let fileToProbe = null;

        try {
            const localPath = path.join(storageConfig.localPath, filename);

            if (!fsSync.existsSync(localPath)) {
                return res.status(404).json({ error: 'Archivo no encontrado' });
            }

            fileToProbe = localPath; // Analizar directamente sin copiar

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

            console.log(`🔊 Encontradas ${audioTracks.length} pistas de audio`);
            res.json({ tracks: audioTracks, filename });

        } catch (error) {
            console.error('Error detectando pistas de audio:', error.message);
            res.status(500).json({ error: 'Error al analizar el archivo' });
        }
    });

    // HEAD /stream/:filename - Metadatos de archivo
    router.head('/stream/:filename', async (req, res) => {
        const filename = decodeURIComponent(req.params.filename);
        console.log(`📋 HEAD request: ${filename} [LOCAL]`);

        try {
            const localPath = path.join(storageConfig.localPath, filename);
            if (!fsSync.existsSync(localPath)) {
                return res.status(404).end();
            }
            const stats = fsSync.statSync(localPath);
            const fileSize = stats.size;

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
        console.log(`🎬 Streaming: ${filename} [LOCAL] (transcode: ${needsTranscode}, audio: ${audioTrack})`);

        const localPath = path.join(storageConfig.localPath, filename);

        if (!fsSync.existsSync(localPath)) {
            return res.status(404).send('Video no encontrado');
        }

        const stat = fsSync.statSync(localPath);
        const fileSize = stat.size;
        console.log(`📁 Archivo local: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

        // Si necesita transcodificación (AVI)
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
    });

    return router;
};
