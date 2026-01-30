#!/usr/bin/env node
/**
 * IsiPrime Batch Converter
 * AVI / MKV → MP4 con soporte GPU
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

/* ===========================
   COLORES Y LOG
=========================== */
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  white: '\x1b[37m'
};

const log = {
  info: m => console.log(`${colors.cyan}ℹ${colors.reset} ${m}`),
  success: m => console.log(`${colors.green}✓${colors.reset} ${m}`),
  warn: m => console.log(`${colors.yellow}⚠${colors.reset} ${m}`),
  error: m => console.log(`${colors.red}✗${colors.reset} ${m}`),
  title: m => console.log(`\n${colors.bright}${colors.magenta}${m}${colors.reset}\n`),
  progress: (c, t, f, p) => {
    const w = 30;
    const fill = Math.round(w * p / 100);
    process.stdout.write(
      `\r${colors.cyan}[${c}/${t}]${colors.reset} ` +
      `${colors.green}${'█'.repeat(fill)}${colors.white}${'░'.repeat(w - fill)}${colors.reset} ` +
      `${p}% - ${f.slice(0, 40)}`
    );
  }
};

/* ===========================
   ARGUMENTOS
=========================== */
function parseArgs() {
  const args = process.argv.slice(2);
  const o = {
    directory: '.',
    delete: false,
    gpu: 'auto',
    parallel: 1,
    dryRun: false,
    quality: 23
  };

  for (const a of args) {
    if (a === '--delete') o.delete = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a.startsWith('--gpu=')) o.gpu = a.split('=')[1];
    else if (a.startsWith('--parallel=')) o.parallel = Math.max(1, parseInt(a.split('=')[1]) || 1);
    else if (a.startsWith('--quality=')) o.quality = Math.min(28, Math.max(18, parseInt(a.split('=')[1]) || 23));
    else if (!a.startsWith('--')) o.directory = a;
  }
  return o;
}

/* ===========================
   DETECCIÓN GPU (MODERNA)
=========================== */
function detectGPU() {
  const g = { nvidia: false, intel: false, amd: false };

  // NVIDIA (método soportado)
  try {
    execSync('nvidia-smi', { stdio: 'ignore' });
    g.nvidia = true;
  } catch {}

  // Intel / AMD vía PowerShell (wmic obsoleto)
  try {
    const out = execSync(
      'powershell -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"',
      { stdio: 'pipe' }
    ).toString().toLowerCase();

    if (out.includes('intel')) g.intel = true;
    if (out.includes('amd') || out.includes('radeon')) g.amd = true;
  } catch {}

  return g;
}

/* ===========================
   ENCODER
=========================== */
function getEncoder(type, gpus, quality) {
  if (type === 'auto') {
    if (gpus.nvidia) type = 'nvidia';
    else if (gpus.intel) type = 'intel';
    else if (gpus.amd) type = 'amd';
    else type = 'none';
  }

  switch (type) {
    case 'nvidia':
      return { name: 'NVIDIA NVENC', video: 'h264_nvenc', extra: ['-cq', quality] };
    case 'intel':
      return { name: 'Intel QSV', video: 'h264_qsv', extra: ['-global_quality', quality] };
    case 'amd':
      return { name: 'AMD AMF', video: 'h264_amf', extra: ['-qp_i', quality, '-qp_p', quality] };
    default:
      return { name: 'CPU (x264)', video: 'libx264', extra: ['-crf', quality] };
  }
}

/* ===========================
   ESCANEO DE ARCHIVOS
=========================== */
function findFiles(dir) {
  const out = [];
  for (const i of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, i.name);
    if (i.isDirectory()) out.push(...findFiles(p));
    else if (/\.(avi|mkv)$/i.test(i.name) && !fs.existsSync(p.replace(/\.(avi|mkv)$/i, '.mp4'))) {
      out.push({ path: p, name: i.name });
    }
  }
  return out;
}

/* ===========================
   DETECTAR PISTAS DE AUDIO
=========================== */
function getAudioTracks(filePath) {
  try {
    const result = execSync(
      `ffprobe -v quiet -print_format json -show_streams "${filePath}"`,
      { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 }
    ).toString();

    const data = JSON.parse(result);
    return data.streams
      .filter(s => s.codec_type === 'audio')
      .map((track, idx) => ({
        index: track.index,
        streamIndex: idx,
        language: (track.tags?.language || 'und').toLowerCase()
      }));
  } catch {
    return [];
  }
}

/* ===========================
   CONVERSIÓN
=========================== */
function convertFile(file, enc, opt, idx, total) {
  return new Promise(resolve => {
    const out = file.path.replace(/\.(avi|mkv)$/i, '.mp4');
    const tmp = out + '.converting';

    // Detectar pistas de audio y priorizar español
    const audioTracks = getAudioTracks(file.path);
    let audioMaps = [];

    if (audioTracks.length > 1) {
      // Buscar pista en español
      const spanishIdx = audioTracks.findIndex(t =>
        t.language.includes('spa') || t.language.includes('esp') ||
        t.language === 'es' || t.language.includes('spanish')
      );

      if (spanishIdx >= 0) {
        // Poner español primero, luego el resto
        audioMaps.push('-map', `0:a:${spanishIdx}`);
        audioTracks.forEach((t, i) => {
          if (i !== spanishIdx) audioMaps.push('-map', `0:a:${i}`);
        });
        log.info(`Audio español detectado (pista ${spanishIdx + 1}) - será la pista principal`);
      } else {
        // Sin español, mantener todas las pistas en orden original
        audioMaps.push('-map', '0:a');
      }
    } else {
      // Solo una pista de audio
      audioMaps.push('-map', '0:a');
    }

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-stats',
      '-i', file.path,
      '-map', '0:v:0',      // Video principal
      ...audioMaps,          // Pistas de audio (español primero si existe)
      '-c:v', enc.video,
      ...enc.extra,
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      tmp
    ];

    const ff = spawn('ffmpeg', args);

    ff.stderr.on('data', d => {
      const m = d.toString().match(/time=(\d+):(\d+):(\d+)/);
      if (m) {
        const sec = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
        log.progress(idx, total, file.name, Math.min(99, sec));
      }
    });

    ff.on('close', code => {
      console.log();
      if (code === 0 && fs.existsSync(tmp)) {
        fs.renameSync(tmp, out);
        if (opt.delete) fs.unlinkSync(file.path);
        log.success(`${file.name} convertido`);
        resolve(true);
      } else {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        log.error(`${file.name} falló`);
        resolve(false);
      }
    });
  });
}

/* ===========================
   MAIN (PARALELO REAL)
=========================== */
async function main() {
  console.clear();
  log.title('IsiPrime Batch Converter');

  const opt = parseArgs();
  if (!fs.existsSync(opt.directory)) return log.error('Directorio inexistente');

  const files = findFiles(path.resolve(opt.directory));
  if (!files.length) return log.success('Nada que convertir');

  const enc = getEncoder(opt.gpu, detectGPU(), opt.quality);

  log.info(`Encoder: ${enc.name}`);
  log.info(`Paralelo: ${opt.parallel}`);
  if (opt.delete) log.warn('Se eliminarán originales');

  if (opt.dryRun) return;

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ok = await new Promise(r => rl.question('¿Iniciar? (s/N): ', a => r(a.toLowerCase() === 's')));
  rl.close();
  if (!ok) return;

  let i = 0;
  const pool = Array(opt.parallel).fill(Promise.resolve());

  for (const f of files) {
    pool[i % opt.parallel] =
      pool[i % opt.parallel].then(() => convertFile(f, enc, opt, i + 1, files.length));
    i++;
  }

  await Promise.all(pool);
  log.title('Proceso finalizado');
}

main().catch(console.error);
