#!/usr/bin/env node
/**
 * IsiPrime Audio Fixer
 * Detecta películas con audio bajo y reconvierte SOLO el audio (video intacto)
 * Uso: node fix-audio-bitrate.js E:\
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DRIVE = process.argv[2] || 'E:\\';
const THRESHOLD = 200; // kbps - umbral para considerar "bajo"
const BITRATE_STEREO = '256k';   // Para audio 2.0
const BITRATE_SURROUND = '384k'; // Para audio 5.1+

// Control de cancelación segura
let currentTempFile = null;
let isProcessing = false;

process.on('SIGINT', () => {
    console.log('\n\n⚠️  Cancelando de forma segura...');
    if (currentTempFile && fs.existsSync(currentTempFile)) {
        console.log('🗑️  Eliminando archivo temporal...');
        try {
            fs.unlinkSync(currentTempFile);
            console.log('✓  Archivo temporal eliminado');
        } catch (e) {
            console.log('⚠️  No se pudo eliminar:', currentTempFile);
        }
    }
    console.log('✓  Archivo original INTACTO');
    console.log('\nProceso cancelado.\n');
    process.exit(0);
});

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m'
};

function log(type, msg) {
    const icons = { info: 'ℹ', ok: '✓', warn: '⚠', err: '✗' };
    const cols = { info: colors.cyan, ok: colors.green, warn: colors.yellow, err: colors.red };
    console.log(`${cols[type]}${icons[type]}${colors.reset} ${msg}`);
}

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

function getAudioInfo(file) {
    try {
        const cmd = `ffprobe -v quiet -select_streams a:0 -show_entries stream=bit_rate,channels -of csv=p=0 "${file}"`;
        const result = execSync(cmd, { stdio: 'pipe', timeout: 15000 }).toString().trim();
        const parts = result.split(',');
        return {
            bitrate: parseInt(parts[0]) || 0,
            channels: parseInt(parts[1]) || 2
        };
    } catch {
        return { bitrate: 0, channels: 2 };
    }
}

function fixAudio(file, channels) {
    return new Promise((resolve) => {
        const dir = path.dirname(file);
        const name = path.basename(file);
        const temp = path.join(dir, `_FIXING_${name}`);

        // Registrar archivo temporal para limpieza segura si se cancela
        currentTempFile = temp;
        isProcessing = true;

        // Seleccionar bitrate y filtro según canales (5.1+ = 384k, stereo = 256k)
        const targetBitrate = channels >= 6 ? BITRATE_SURROUND : BITRATE_STEREO;
        const audioFilter = channels >= 6
            ? 'loudnorm=I=-16:TP=-1.5:LRA=11,aformat=channel_layouts=5.1'  // 5.1: preservar layout
            : 'loudnorm=I=-16:TP=-1.5:LRA=11';  // Stereo: solo normalizar

        const args = [
            '-y',
            '-hide_banner',
            '-loglevel', 'error',
            '-stats',
            '-i', file,
            '-map', '0',           // Copiar todas las pistas
            '-c:v', 'copy',        // NO re-codificar video
            '-c:a', 'aac',         // Re-codificar audio a AAC
            '-b:a', targetBitrate,
            '-af', audioFilter,    // Normalizar volumen
            '-c:s', 'copy',        // Copiar subtítulos si existen
            '-movflags', '+faststart',
            temp
        ];

        const ff = spawn('ffmpeg', args);

        ff.stderr.on('data', (data) => {
            const str = data.toString();
            if (str.includes('time=')) {
                process.stdout.write(`\r  Procesando: ${str.match(/time=[\d:\.]+/)?.[0] || '...'}`);
            }
        });

        ff.on('close', (code) => {
            console.log(); // Nueva línea
            isProcessing = false;

            if (code === 0 && fs.existsSync(temp)) {
                // Reemplazar original con el arreglado
                const backup = file + '.bak';
                try {
                    fs.renameSync(file, backup);
                    fs.renameSync(temp, file);
                    fs.unlinkSync(backup);
                    currentTempFile = null;
                    resolve(true);
                } catch (e) {
                    log('err', `Error reemplazando: ${e.message}`);
                    // Restaurar si algo falla
                    if (fs.existsSync(backup)) {
                        try { fs.renameSync(backup, file); } catch {}
                    }
                    if (fs.existsSync(temp)) {
                        try { fs.unlinkSync(temp); } catch {}
                    }
                    currentTempFile = null;
                    resolve(false);
                }
            } else {
                if (fs.existsSync(temp)) {
                    try { fs.unlinkSync(temp); } catch {}
                }
                currentTempFile = null;
                resolve(false);
            }
        });
    });
}

async function main() {
    console.log(`\n${colors.cyan}═══════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.cyan}       IsiPrime Audio Fixer${colors.reset}`);
    console.log(`${colors.cyan}═══════════════════════════════════════════${colors.reset}\n`);

    log('info', `Escaneando ${DRIVE} ...`);
    const files = findMP4(DRIVE);
    log('info', `Encontrados: ${files.length} archivos MP4`);

    // Fase 1: Detectar películas con audio bajo
    console.log(`\n${colors.yellow}Analizando bitrate de audio...${colors.reset}\n`);

    const lowBitrate = [];
    for (let i = 0; i < files.length; i++) {
        process.stdout.write(`\rAnalizando: ${i + 1}/${files.length}`);
        const info = getAudioInfo(files[i]);
        const kbps = Math.round(info.bitrate / 1000);
        if (info.bitrate > 0 && kbps <= THRESHOLD) {
            lowBitrate.push({
                path: files[i],
                name: path.basename(files[i]),
                bitrate: kbps,
                channels: info.channels
            });
        }
    }

    console.log('\n');

    if (lowBitrate.length === 0) {
        log('ok', 'No hay películas con audio bajo. Todo está bien!');
        return;
    }

    // Mostrar películas encontradas
    console.log(`${colors.yellow}Películas con audio ≤${THRESHOLD} kbps:${colors.reset}\n`);
    lowBitrate.forEach((m, i) => {
        const chLabel = m.channels >= 6 ? '5.1' : (m.channels === 1 ? 'mono' : 'stereo');
        const target = m.channels >= 6 ? BITRATE_SURROUND : BITRATE_STEREO;
        console.log(`  ${i + 1}. ${m.bitrate} kbps (${chLabel}) → ${target} - ${m.name}`);
    });

    console.log(`\n${colors.cyan}Total: ${lowBitrate.length} películas para arreglar${colors.reset}`);
    console.log(`${colors.green}El video NO se re-codificará (rápido)${colors.reset}\n`);

    // Confirmación
    const readline = require('readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    const answer = await new Promise(r => rl.question('¿Iniciar corrección? (s/N): ', r));
    rl.close();

    if (answer.toLowerCase() !== 's') {
        log('warn', 'Cancelado por el usuario');
        return;
    }

    // Fase 2: Arreglar audio
    console.log(`\n${colors.cyan}Iniciando corrección de audio...${colors.reset}\n`);

    let fixed = 0;
    let failed = 0;

    for (let i = 0; i < lowBitrate.length; i++) {
        const movie = lowBitrate[i];
        const chLabel = movie.channels >= 6 ? '5.1' : 'stereo';
        const target = movie.channels >= 6 ? BITRATE_SURROUND : BITRATE_STEREO;
        console.log(`\n[${i + 1}/${lowBitrate.length}] ${movie.name}`);
        log('info', `Audio: ${movie.bitrate} kbps (${chLabel}) → ${target}`);

        const success = await fixAudio(movie.path, movie.channels);

        if (success) {
            log('ok', 'Audio corregido');
            fixed++;
        } else {
            log('err', 'Error al corregir');
            failed++;
        }
    }

    // Resumen
    console.log(`\n${colors.cyan}═══════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}  Corregidas: ${fixed}${colors.reset}`);
    if (failed > 0) console.log(`${colors.red}  Fallidas: ${failed}${colors.reset}`);
    console.log(`${colors.cyan}═══════════════════════════════════════════${colors.reset}\n`);
}

main().catch(console.error);
