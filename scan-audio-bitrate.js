#!/usr/bin/env node
/**
 * Escanea películas MP4 y muestra las que tienen audio con bitrate bajo
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DRIVE = process.argv[2] || 'E:\\';
const THRESHOLD = 200; // kbps

function findMP4(dir, results = []) {
    try {
        const items = fs.readdirSync(dir, { withFileTypes: true });
        for (const item of items) {
            const fullPath = path.join(dir, item.name);
            if (item.isDirectory() && !item.name.startsWith('$') && !item.name.startsWith('System')) {
                findMP4(fullPath, results);
            } else if (item.name.toLowerCase().endsWith('.mp4')) {
                results.push(fullPath);
            }
        }
    } catch (e) {}
    return results;
}

function getAudioBitrate(file) {
    try {
        const cmd = `ffprobe -v quiet -select_streams a:0 -show_entries stream=bit_rate -of csv=p=0 "${file}"`;
        const result = execSync(cmd, { stdio: 'pipe', timeout: 15000 }).toString().trim();
        return parseInt(result) || 0;
    } catch {
        return 0;
    }
}

console.log(`\nEscaneando ${DRIVE} ...`);
const files = findMP4(DRIVE);
console.log(`Encontrados: ${files.length} archivos MP4\n`);

const lowBitrate = [];
let count = 0;

for (const file of files) {
    count++;
    process.stdout.write(`\rAnalizando: ${count}/${files.length}`);
    const bitrate = getAudioBitrate(file);
    const kbps = Math.round(bitrate / 1000);
    if (bitrate > 0 && kbps <= THRESHOLD) {
        lowBitrate.push({ file: path.basename(file), path: file, bitrate: kbps });
    }
}

console.log(`\n\n=== PELÍCULAS CON AUDIO BAJO (<=${THRESHOLD} kbps) ===\n`);

if (lowBitrate.length === 0) {
    console.log('Ninguna película con bitrate bajo.');
} else {
    lowBitrate.sort((a, b) => a.bitrate - b.bitrate);
    lowBitrate.forEach(m => console.log(`  ${m.bitrate} kbps - ${m.file}`));
    console.log(`\nTotal: ${lowBitrate.length} películas con audio bajo`);
}

console.log('\n');
