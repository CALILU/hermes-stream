/**
 * lib/probe.js - Análisis de codecs de video via FFprobe
 *
 * Escanea archivos de video y almacena info de codec en la BD.
 * Usado para decisiones inteligentes de streaming (directo vs MSE vs transcode).
 */

const path = require('path');
const fsSync = require('fs');
const ffmpeg = require('fluent-ffmpeg');

/**
 * Analiza un archivo de video con FFprobe
 * @param {string} filePath - Ruta completa al archivo
 * @returns {Promise<Object|null>} Codec info o null si falla
 */
function probeFile(filePath) {
    return new Promise((resolve) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                resolve(null);
                return;
            }

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');

            resolve({
                video_codec: videoStream ? videoStream.codec_name : null,
                audio_codec: audioStream ? audioStream.codec_name : null,
                audio_channels: audioStream ? audioStream.channels : null,
                audio_sample_rate: audioStream ? parseInt(audioStream.sample_rate, 10) || null : null,
                bitrate: metadata.format.bit_rate ? Math.round(metadata.format.bit_rate / 1000) : null,
                width: videoStream ? videoStream.width : null,
                height: videoStream ? videoStream.height : null,
                duration_seconds: metadata.format.duration ? Math.floor(metadata.format.duration) : null
            });
        });
    });
}

/**
 * Escanea archivos sin info de codec en background
 * @param {Object} mediaDB - Instancia de db/media-db.js
 * @param {string} videosPath - Ruta base de películas
 */
async function probeNewFiles(mediaDB, videosPath) {
    const filenames = mediaDB.getMoviesWithoutCodecInfo();
    if (filenames.length === 0) {
        console.log('🔍 Todos los archivos ya tienen info de codec');
        return;
    }

    console.log(`🔍 Analizando codecs de ${filenames.length} archivos...`);
    const batch = [];
    let done = 0;

    for (const filename of filenames) {
        const filePath = path.join(videosPath, filename);
        if (!fsSync.existsSync(filePath)) continue;

        const info = await probeFile(filePath);
        if (info) {
            batch.push({ filename, ...info });
        }
        done++;
        if (done % 50 === 0) {
            console.log(`🔍 Codec probe: ${done}/${filenames.length}`);
        }
    }

    if (batch.length > 0) {
        mediaDB.updateMovieCodecInfoBatch(batch);
        console.log(`🔍 Codec info guardada para ${batch.length} archivos`);

        // Stats
        const codecs = {};
        batch.forEach(b => {
            const key = (b.video_codec || 'unknown') + '+' + (b.audio_codec || 'unknown');
            codecs[key] = (codecs[key] || 0) + 1;
        });
        console.log('🔍 Distribución codecs:', JSON.stringify(codecs));
    }
}

module.exports = { probeFile, probeNewFiles };
