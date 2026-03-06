#!/usr/bin/env node
/**
 * convert-series-batch.js - Batch conversion of MKV/AVI series episodes to MP4
 *
 * Runs standalone on NAS via nohup. Converts all MKV/AVI in /mnt/peliculas/Series/
 * recursively. Survives SSH disconnect.
 *
 * Usage: nohup node convert-series-batch.js > ../logs/convert-series.log 2>&1 &
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERIES_DIR = '/mnt/peliculas/Series';
const EXTENSIONS = ['.mkv', '.avi'];

function log(msg) {
    const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
    console.log(`[${ts}] ${msg}`);
}

function findFiles(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...findFiles(fullPath));
        } else if (EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
            results.push(fullPath);
        }
    }
    return results;
}

function getDuration(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
            { timeout: 30000, encoding: 'utf8' }
        );
        return parseFloat(out.trim()) || 0;
    } catch {
        return 0;
    }
}

function probeFile(filePath) {
    try {
        const out = execSync(
            `ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of json "${filePath}"`,
            { timeout: 30000, encoding: 'utf8' }
        );
        const data = JSON.parse(out);
        const vs = data.streams && data.streams[0];
        if (!vs) return null;

        const out2 = execSync(
            `ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,channels,sample_rate -of json "${filePath}"`,
            { timeout: 30000, encoding: 'utf8' }
        );
        const data2 = JSON.parse(out2);
        const as = data2.streams && data2.streams[0];

        const out3 = execSync(
            `ffprobe -v error -show_entries format=bit_rate,duration -of json "${filePath}"`,
            { timeout: 30000, encoding: 'utf8' }
        );
        const data3 = JSON.parse(out3);
        const fmt = data3.format || {};

        return {
            video_codec: vs.codec_name,
            width: vs.width,
            height: vs.height,
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

function convertFile(inputPath) {
    return new Promise((resolve, reject) => {
        const dir = path.dirname(inputPath);
        const basename = path.basename(inputPath, path.extname(inputPath));
        const ext = path.extname(inputPath).toLowerCase().replace('.', '');
        const mp4Name = basename + '.mp4';
        const tempOutput = path.join(dir, basename + '.tmp_convert.mp4');
        const finalOutput = path.join(dir, mp4Name);

        // Check if MP4 already exists
        if (fs.existsSync(finalOutput)) {
            log(`  SKIP: ${mp4Name} already exists`);
            resolve({ skipped: true, output: finalOutput });
            return;
        }

        const duration = getDuration(inputPath);
        const inputSize = fs.statSync(inputPath).size;

        // Build FFmpeg args
        const args = ['-y', '-i', inputPath];
        if (ext === 'mkv') {
            args.push('-c:v', 'copy'); // MKV: copy video
        } else {
            args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '22'); // AVI: transcode
        }
        // Audio: always AAC stereo 48kHz
        args.push('-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
                   '-movflags', '+faststart', tempOutput);

        const proc = spawn('ffmpeg', args);
        let lastProgress = '';

        proc.stderr.on('data', (data) => {
            const line = data.toString();
            const match = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
            if (match && duration > 0) {
                const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
                const pct = Math.min(99, Math.round((secs / duration) * 100));
                if (pct % 10 === 0 && pct.toString() !== lastProgress) {
                    lastProgress = pct.toString();
                    log(`  Progress: ${pct}%`);
                }
            }
        });

        proc.on('close', (code) => {
            if (code !== 0) {
                // Cleanup temp
                try { fs.unlinkSync(tempOutput); } catch {}
                reject(new Error(`FFmpeg exit code ${code}`));
                return;
            }

            // Verify output
            if (!fs.existsSync(tempOutput)) {
                reject(new Error('Output file not created'));
                return;
            }

            const outputSize = fs.statSync(tempOutput).size;
            const ratio = outputSize / inputSize;

            if (ratio < 0.1) {
                try { fs.unlinkSync(tempOutput); } catch {}
                reject(new Error(`Output too small (${(ratio * 100).toFixed(1)}% of original)`));
                return;
            }

            // Probe output
            const probeResult = probeFile(tempOutput);
            if (!probeResult || !probeResult.video_codec) {
                try { fs.unlinkSync(tempOutput); } catch {}
                reject(new Error('Output probe failed - no video codec detected'));
                return;
            }

            // Move temp to final
            fs.renameSync(tempOutput, finalOutput);

            // Delete original
            try {
                fs.unlinkSync(inputPath);
                log(`  Deleted original: ${path.basename(inputPath)}`);
            } catch (e) {
                log(`  Warning: could not delete original: ${e.message}`);
            }

            resolve({
                skipped: false,
                output: finalOutput,
                probe: probeResult,
                inputSize,
                outputSize
            });
        });

        proc.on('error', (err) => reject(err));
    });
}

async function main() {
    log('=== Series Batch Conversion Start ===');
    log(`Directory: ${SERIES_DIR}`);

    if (!fs.existsSync(SERIES_DIR)) {
        log('ERROR: Series directory not found');
        process.exit(1);
    }

    const files = findFiles(SERIES_DIR);
    log(`Found ${files.length} files to convert`);

    if (files.length === 0) {
        log('Nothing to convert. Done.');
        process.exit(0);
    }

    // Group by series for readability
    const bySeries = {};
    for (const f of files) {
        const rel = path.relative(SERIES_DIR, f);
        const series = rel.split(path.sep)[0];
        if (!bySeries[series]) bySeries[series] = [];
        bySeries[series].push(f);
    }

    for (const [series, seriesFiles] of Object.entries(bySeries)) {
        log(`\n--- ${series} (${seriesFiles.length} files) ---`);
    }

    let completed = 0;
    let errors = 0;
    let skipped = 0;

    for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const rel = path.relative(SERIES_DIR, filePath);
        const ext = path.extname(filePath).toLowerCase().replace('.', '');

        log(`\n[${i + 1}/${files.length}] ${rel} (${ext.toUpperCase()})`);
        log(`  Size: ${(fs.statSync(filePath).size / (1024 * 1024)).toFixed(1)} MB`);
        log(`  Mode: ${ext === 'mkv' ? 'remux (copy video)' : 'transcode (libx264)'}`);

        try {
            const result = await convertFile(filePath);

            if (result.skipped) {
                skipped++;
                continue;
            }

            const savedPct = ((1 - result.outputSize / result.inputSize) * 100).toFixed(1);
            log(`  OK: ${path.basename(result.output)}`);
            log(`  Size: ${(result.inputSize / (1024 * 1024)).toFixed(1)}MB -> ${(result.outputSize / (1024 * 1024)).toFixed(1)}MB (${savedPct}% saved)`);
            log(`  Codec: ${result.probe.video_codec} + ${result.probe.audio_codec}, ${result.probe.width}x${result.probe.height}, ${result.probe.bitrate}kbps`);
            completed++;

        } catch (err) {
            log(`  ERROR: ${err.message}`);
            errors++;
        }
    }

    log(`\n=== Series Batch Conversion Complete ===`);
    log(`Total: ${files.length} | Completed: ${completed} | Skipped: ${skipped} | Errors: ${errors}`);
}

main().catch(err => {
    log(`FATAL: ${err.message}`);
    process.exit(1);
});
