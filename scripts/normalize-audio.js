#!/usr/bin/env node
/**
 * normalize-audio.js — Normaliza audio de películas a AAC estéreo 48kHz
 *
 * Video: copy (sin re-encode)
 * Audio: AAC, 2 canales, 48000 Hz, 192 kbps
 *
 * Uso:
 *   node scripts/normalize-audio.js              # Procesar todo
 *   node scripts/normalize-audio.js --dry-run    # Solo listar qué se haría
 *   node scripts/normalize-audio.js --limit 10   # Procesar máximo 10 archivos
 *
 * Ejecutar desde el directorio del proyecto (~/isiprime)
 */

const { execSync, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// ===== CONFIG =====
const DB_PATH = path.join(__dirname, '..', 'isiprime.db');
const VIDEOS_PATH = process.env.LOCAL_VIDEOS_PATH || '/mnt/peliculas';
const TEMP_SUFFIX = '.tmp_normalize.mp4';
// ==================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 0;

const db = new Database(DB_PATH);

// Get files needing normalization
const files = db.prepare(`
    SELECT filename, audio_codec, audio_channels, audio_sample_rate, video_codec
    FROM movies_cache
    WHERE video_codec IS NOT NULL
      AND (audio_codec != 'aac' OR audio_channels > 2 OR audio_sample_rate > 48000)
    ORDER BY filename
`).all();

console.log('===========================================');
console.log('  IsiPrime — Normalización de Audio');
console.log('===========================================');
console.log('Archivos a procesar: ' + files.length);
console.log('Directorio videos:   ' + VIDEOS_PATH);
if (DRY_RUN) console.log('MODO: dry-run (no se modifica nada)');
if (LIMIT > 0) console.log('LÍMITE: ' + LIMIT + ' archivos');
console.log('');

const toProcess = LIMIT > 0 ? files.slice(0, LIMIT) : files;
let done = 0;
let skipped = 0;
let errors = 0;
let converted = 0;

const updateStmt = db.prepare(`
    UPDATE movies_cache SET
        audio_codec = 'aac',
        audio_channels = 2,
        audio_sample_rate = 48000
    WHERE filename = ?
`);

// For MKV→MP4 rename, update filename in cache
const renameStmt = db.prepare(`
    UPDATE movies_cache SET
        filename = ?,
        audio_codec = 'aac',
        audio_channels = 2,
        audio_sample_rate = 48000
    WHERE filename = ?
`);

function formatSize(bytes) {
    if (bytes > 1e9) return (bytes / 1e9).toFixed(1) + ' GB';
    if (bytes > 1e6) return (bytes / 1e6).toFixed(0) + ' MB';
    return bytes + ' B';
}

function formatTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + 'm ' + s + 's';
}

function processFile(file) {
    var srcPath = path.join(VIDEOS_PATH, file.filename);
    var ext = path.extname(file.filename).toLowerCase();
    var isMKV = ext === '.mkv';

    // Check file exists
    if (!fs.existsSync(srcPath)) {
        console.log('  ⏭️  No existe en disco, saltando');
        skipped++;
        return;
    }

    var fileSize = fs.statSync(srcPath).size;
    var reason = [];
    if (file.audio_codec !== 'aac') reason.push(file.audio_codec);
    if (file.audio_channels > 2) reason.push(file.audio_channels + 'ch');
    if (file.audio_sample_rate > 48000) reason.push(file.audio_sample_rate + 'Hz');

    console.log('  Razón:   ' + reason.join(', '));
    console.log('  Tamaño:  ' + formatSize(fileSize));

    if (DRY_RUN) {
        converted++;
        return;
    }

    // Determine output path
    var outFilename;
    var outPath;
    if (isMKV) {
        // MKV → MP4: change extension
        outFilename = file.filename.replace(/\.mkv$/i, '.mp4');
        outPath = path.join(VIDEOS_PATH, outFilename + TEMP_SUFFIX);
    } else {
        outFilename = file.filename;
        outPath = srcPath + TEMP_SUFFIX;
    }

    // FFmpeg: copy video, re-encode audio to AAC stereo 48kHz
    var ffmpegArgs = [
        '-i', srcPath,
        '-c:v', 'copy',
        '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
        '-movflags', '+faststart',
        '-y',
        outPath
    ];

    var startTime = Date.now();

    try {
        execSync('ffmpeg ' + ffmpegArgs.map(function(a) {
            return '"' + a.replace(/"/g, '\\"') + '"';
        }).join(' '), {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 1800000  // 30 min max per file
        });
    } catch (err) {
        console.log('  ❌ FFmpeg error: ' + (err.stderr ? err.stderr.toString().slice(-200) : err.message));
        // Clean up temp file
        try { fs.unlinkSync(outPath); } catch(e) {}
        errors++;
        return;
    }

    var elapsed = Date.now() - startTime;

    // Verify output file exists and has reasonable size (at least 50% of original)
    if (!fs.existsSync(outPath)) {
        console.log('  ❌ Output file not created');
        errors++;
        return;
    }

    var outSize = fs.statSync(outPath).size;
    if (outSize < fileSize * 0.3) {
        console.log('  ❌ Output demasiado pequeño (' + formatSize(outSize) + '), descartando');
        try { fs.unlinkSync(outPath); } catch(e) {}
        errors++;
        return;
    }

    // Replace original
    if (isMKV) {
        // Move temp to final MP4 path
        var finalPath = path.join(VIDEOS_PATH, outFilename);
        fs.renameSync(outPath, finalPath);
        // Delete original MKV
        fs.unlinkSync(srcPath);
        // Update DB with new filename
        renameStmt.run(outFilename, file.filename);
        console.log('  ✅ MKV→MP4 ' + formatSize(outSize) + ' (' + formatTime(elapsed) + ')');
    } else {
        // Replace original MP4
        fs.unlinkSync(srcPath);
        fs.renameSync(outPath, srcPath);
        // Update DB
        updateStmt.run(file.filename);
        console.log('  ✅ ' + formatSize(outSize) + ' (' + formatTime(elapsed) + ')');
    }

    converted++;
}

// Process files
for (var i = 0; i < toProcess.length; i++) {
    var file = toProcess[i];
    done++;
    console.log('[' + done + '/' + toProcess.length + '] ' + file.filename);

    processFile(file);
    console.log('');
}

console.log('===========================================');
console.log('  Resultado');
console.log('===========================================');
console.log('Procesados:  ' + done);
console.log('Convertidos: ' + converted);
console.log('Saltados:    ' + skipped);
console.log('Errores:     ' + errors);
console.log('===========================================');

db.close();
