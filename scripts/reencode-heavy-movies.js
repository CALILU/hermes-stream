#!/usr/bin/env node
/**
 * reencode-heavy-movies.js - Re-encode movies with bitrate > 12000 kbps
 *
 * Target: 8000 kbps H.264, faster preset. 4K scaled to 1080p.
 * Audio: copy if already AAC stereo, otherwise re-encode.
 * Updates SQLite codec info after each conversion.
 *
 * Usage: nohup node reencode-heavy-movies.js > ../logs/reencode-movies.log 2>&1 &
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const MOVIES_DIR = '/mnt/peliculas';
const DB_PATH = path.join(__dirname, '..', 'isiprime.db');
const BITRATE_THRESHOLD = 12000; // kbps
const TARGET_BITRATE = '8000k';
const MAX_BITRATE = '10000k';
const BUFSIZE = '16000k';
const PRESET = 'faster';
const MAX_HEIGHT = 1080;

function log(msg) {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${ts}] ${msg}`);
}

function getHeavyMovies() {
    const db = new Database(DB_PATH, { readonly: true });
    const rows = db.prepare(
        'SELECT filename, bitrate, width, height, video_codec, audio_codec, audio_channels, audio_sample_rate, duration_seconds FROM movies_cache WHERE bitrate > ? ORDER BY bitrate DESC'
    ).all(BITRATE_THRESHOLD);
    db.close();
    return rows;
}

function probeFile(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -show_entries stream=index,codec_type,codec_name,width,height,channels,sample_rate -show_entries stream_tags=language -show_entries format=bit_rate,duration -of json "${filePath}"`,
            { timeout: 60000, encoding: 'utf8' }
        );
        const data = JSON.parse(out);
        const vs = data.streams && data.streams.find(s => s.codec_type === 'video');
        const as = data.streams && data.streams.find(s => s.codec_type === 'audio');
        const fmt = data.format || {};
        return {
            video_codec: vs ? vs.codec_name : null,
            width: vs ? vs.width : null,
            height: vs ? vs.height : null,
            audio_codec: as ? as.codec_name : null,
            audio_channels: as ? as.channels : null,
            audio_sample_rate: as ? parseInt(as.sample_rate, 10) || null : null,
            bitrate: fmt.bit_rate ? Math.round(parseInt(fmt.bit_rate, 10) / 1000) : null,
            duration_seconds: fmt.duration ? Math.floor(parseFloat(fmt.duration)) : null
        };
    } catch (e) {
        log(`  Probe error: ${e.message}`);
        return null;
    }
}

function probeAudioStreams(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -select_streams a -show_entries stream=index,codec_name,channels,sample_rate -show_entries stream_tags=language,title -of json "${filePath}"`,
            { timeout: 60000, encoding: 'utf8' }
        );
        const data = JSON.parse(out);
        return (data.streams || []).map(s => ({
            index: s.index,
            codec: s.codec_name,
            channels: s.channels,
            sample_rate: parseInt(s.sample_rate, 10) || null,
            language: (s.tags && s.tags.language) || null,
            title: (s.tags && s.tags.title) || null
        }));
    } catch (e) {
        return [];
    }
}

function selectAudioStream(audioStreams) {
    if (audioStreams.length <= 1) return null; // default behavior is fine for single stream

    // Prefer Spanish audio
    var spa = audioStreams.find(s => s.language === 'spa' || s.language === 'es');
    if (spa) return spa;

    // If no language tags at all, return null (copy all)
    var hasLangs = audioStreams.some(s => s.language);
    if (!hasLangs) return null;

    // Fallback: first stream
    return audioStreams[0];
}

function updateCodecInfo(filename, info) {
    const db = new Database(DB_PATH);
    db.prepare(`
        UPDATE movies_cache SET
            video_codec = ?, audio_codec = ?, audio_channels = ?,
            audio_sample_rate = ?, bitrate = ?, width = ?, height = ?,
            duration_seconds = ?
        WHERE filename = ?
    `).run(
        info.video_codec, info.audio_codec, info.audio_channels,
        info.audio_sample_rate, info.bitrate, info.width, info.height,
        info.duration_seconds, filename
    );
    db.close();
}

function getDuration(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
            { timeout: 30000, encoding: 'utf8' }
        );
        return parseFloat(out.trim()) || 0;
    } catch { return 0; }
}

function reencode(inputPath, movie) {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(inputPath);
        const basename = path.basename(inputPath, '.mp4');
        const tempOutput = path.join(dir, basename + '.tmp_reencode.mp4');

        if (fs.existsSync(tempOutput)) {
            try { fs.unlinkSync(tempOutput); } catch {}
        }

        const duration = movie.duration_seconds || getDuration(inputPath);
        const inputSize = fs.statSync(inputPath).size;

        // Video options
        const needsScale = movie.height > MAX_HEIGHT;
        // Force 8-bit output (webOS MSE doesn't support H.264 10-bit)
        // Use width divisible by 16 for hardware decoder compatibility
        const videoFilter = needsScale ? ['-vf', 'scale=-16:1080', '-pix_fmt', 'yuv420p'] : ['-pix_fmt', 'yuv420p'];

        // Detect audio streams and select Spanish if multiple
        const audioStreams = probeAudioStreams(inputPath);
        const selectedAudio = selectAudioStream(audioStreams);

        // Map options: explicit mapping when we need to select a specific audio stream
        var mapOpts = [];
        var targetAudio = null;
        if (selectedAudio) {
            mapOpts = ['-map', '0:v:0', '-map', '0:' + selectedAudio.index];
            targetAudio = selectedAudio;
            log(`  Audio streams: ${audioStreams.length} — selected stream #${selectedAudio.index} (${selectedAudio.language || 'unknown'})${selectedAudio.title ? ' "' + selectedAudio.title + '"' : ''}`);
        } else if (audioStreams.length > 1) {
            // No language tags: copy all audio streams
            mapOpts = ['-map', '0:v:0', '-map', '0:a'];
            targetAudio = audioStreams[0];
            log(`  Audio streams: ${audioStreams.length} — no language tags, copying all`);
        } else {
            targetAudio = audioStreams[0] || { codec: movie.audio_codec, channels: movie.audio_channels, sample_rate: movie.audio_sample_rate };
        }

        // Audio: copy if already AAC stereo <=48kHz
        var tCodec = targetAudio.codec || movie.audio_codec;
        var tChannels = targetAudio.channels || movie.audio_channels;
        var tSampleRate = targetAudio.sample_rate || movie.audio_sample_rate;
        const canCopyAudio = tCodec === 'aac'
            && (!tChannels || tChannels <= 2)
            && (!tSampleRate || tSampleRate <= 48000);
        const audioOpts = canCopyAudio
            ? ['-c:a', 'copy']
            : ['-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k'];

        const args = [
            '-y', '-i', inputPath,
            ...mapOpts,
            '-c:v', 'libx264',
            '-preset', PRESET,
            '-b:v', TARGET_BITRATE,
            '-maxrate', MAX_BITRATE,
            '-bufsize', BUFSIZE,
            ...videoFilter,
            ...audioOpts,
            '-movflags', '+faststart',
            tempOutput
        ];

        log(`  FFmpeg: ${needsScale ? 'scale to 1080p + ' : ''}h264 ${TARGET_BITRATE} ${PRESET}`);
        log(`  Audio: ${canCopyAudio ? 'copy' : 're-encode AAC stereo 48kHz'}`);

        const proc = spawn('ffmpeg', args);
        let lastPct = -1;

        proc.stderr.on('data', (data) => {
            const line = data.toString();
            const match = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
            if (match && duration > 0) {
                const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
                const pct = Math.min(99, Math.round((secs / duration) * 100));
                if (pct >= lastPct + 10) {
                    lastPct = pct;
                    const eta = pct > 0 ? Math.round(((Date.now() - startTime) / pct * (100 - pct)) / 60000) : '?';
                    log(`  Progress: ${pct}% (ETA: ~${eta} min)`);
                }
            }
        });

        const startTime = Date.now();

        proc.on('close', (code) => {
            const elapsed = Math.round((Date.now() - startTime) / 60000);

            if (code !== 0) {
                try { fs.unlinkSync(tempOutput); } catch {}
                reject(new Error(`FFmpeg exit code ${code}`));
                return;
            }

            if (!fs.existsSync(tempOutput)) {
                reject(new Error('Output not created'));
                return;
            }

            const outputSize = fs.statSync(tempOutput).size;
            const ratio = outputSize / inputSize;

            // Safety: output should be smaller (otherwise re-encode was pointless)
            if (ratio > 1.1) {
                log(`  WARNING: output larger than input (${(ratio * 100).toFixed(0)}%) - keeping original`);
                try { fs.unlinkSync(tempOutput); } catch {}
                resolve({ skipped: true, reason: 'output larger' });
                return;
            }

            if (ratio < 0.05) {
                try { fs.unlinkSync(tempOutput); } catch {}
                reject(new Error(`Output suspiciously small (${(ratio * 100).toFixed(1)}%)`));
                return;
            }

            // Probe output to verify
            const probeResult = probeFile(tempOutput);
            if (!probeResult || !probeResult.video_codec) {
                try { fs.unlinkSync(tempOutput); } catch {}
                reject(new Error('Output probe failed'));
                return;
            }

            // Replace original with re-encoded version
            const backupPath = inputPath + '.bak';
            try {
                fs.renameSync(inputPath, backupPath);
                fs.renameSync(tempOutput, inputPath);
                fs.unlinkSync(backupPath);
            } catch (e) {
                // Restore backup if rename failed
                if (fs.existsSync(backupPath) && !fs.existsSync(inputPath)) {
                    fs.renameSync(backupPath, inputPath);
                }
                try { fs.unlinkSync(tempOutput); } catch {}
                reject(new Error(`File replace failed: ${e.message}`));
                return;
            }

            // Update SQLite
            updateCodecInfo(path.basename(inputPath), probeResult);

            resolve({
                skipped: false,
                inputSize,
                outputSize,
                probe: probeResult,
                elapsed
            });
        });

        proc.on('error', (err) => reject(err));
    });
}

async function main() {
    log('=== Heavy Movies Re-encode Start ===');
    log(`Threshold: >${BITRATE_THRESHOLD} kbps | Target: ${TARGET_BITRATE} | Preset: ${PRESET}`);

    const movies = getHeavyMovies();
    log(`Found ${movies.length} movies above ${BITRATE_THRESHOLD} kbps`);

    if (movies.length === 0) {
        log('Nothing to re-encode. Done.');
        process.exit(0);
    }

    let totalSaved = 0;
    let completed = 0;
    let errors = 0;
    let skipped = 0;

    for (let i = 0; i < movies.length; i++) {
        const movie = movies[i];
        const filePath = path.join(MOVIES_DIR, movie.filename);

        log(`\n[${i + 1}/${movies.length}] ${movie.filename}`);
        log(`  Current: ${movie.bitrate}kbps | ${movie.width}x${movie.height} | ${movie.video_codec}`);

        if (!fs.existsSync(filePath)) {
            log(`  SKIP: file not found on disk`);
            skipped++;
            continue;
        }

        const sizeGB = (fs.statSync(filePath).size / (1024 * 1024 * 1024)).toFixed(1);
        log(`  Size: ${sizeGB} GB | Duration: ${(movie.duration_seconds / 3600).toFixed(1)}h`);

        try {
            const result = await reencode(filePath, movie);

            if (result.skipped) {
                log(`  SKIPPED: ${result.reason}`);
                skipped++;
                continue;
            }

            const savedGB = ((result.inputSize - result.outputSize) / (1024 * 1024 * 1024)).toFixed(1);
            const savedPct = ((1 - result.outputSize / result.inputSize) * 100).toFixed(0);
            totalSaved += (result.inputSize - result.outputSize);

            log(`  DONE in ${result.elapsed} min`);
            log(`  ${(result.inputSize / (1024 * 1024 * 1024)).toFixed(1)}GB -> ${(result.outputSize / (1024 * 1024 * 1024)).toFixed(1)}GB (saved ${savedGB}GB, ${savedPct}%)`);
            log(`  New codec: ${result.probe.video_codec} ${result.probe.bitrate}kbps ${result.probe.width}x${result.probe.height}`);
            completed++;

        } catch (err) {
            log(`  ERROR: ${err.message}`);
            errors++;
        }
    }

    log(`\n=== Heavy Movies Re-encode Complete ===`);
    log(`Total: ${movies.length} | Completed: ${completed} | Skipped: ${skipped} | Errors: ${errors}`);
    log(`Total space saved: ${(totalSaved / (1024 * 1024 * 1024)).toFixed(1)} GB`);
}

main().catch(err => {
    log(`FATAL: ${err.message}`);
    process.exit(1);
});
