/**
 * Rutas DLNA/UPnP - Cast a TV
 * API en: /api/dlna
 * Media proxy en: /dlna/media/:token (sin auth, para TVs)
 *
 * DLNA is optional: set DLNA_ENABLED=true env var to activate.
 * When disabled, all routes return 503 Service Unavailable.
 */

const express = require('express');
const router = express.Router();
const mediaRouter = express.Router();

const DLNA_ENABLED = process.env.DLNA_ENABLED === 'true';

function initRoutes(context) {
    if (!DLNA_ENABLED) {
        // Return 503 for all DLNA API routes when disabled
        const disabledHandler = (req, res) => {
            res.status(503).json({
                success: false,
                error: 'DLNA no esta habilitado. Establece DLNA_ENABLED=true en las variables de entorno para activarlo.'
            });
        };

        router.all('{*path}', disabledHandler);

        mediaRouter.all('{*path}', (req, res) => {
            res.status(503).send('DLNA not enabled');
        });

        console.log('DLNA: deshabilitado (DLNA_ENABLED != true)');
        return { apiRouter: router, mediaRouter };
    }

    // DLNA enabled - load the library and register routes
    const dlna = require('../lib/dlna');

    console.log('DLNA: habilitado');

    // GET /api/dlna/devices - Listar dispositivos descubiertos
    router.get('/devices', (req, res) => {
        res.json({ success: true, data: dlna.getDevices() });
    });

    // POST /api/dlna/scan - Forzar re-escaneo
    router.post('/scan', async (req, res) => {
        try {
            const devices = await dlna.scanDevices();
            res.json({ success: true, data: devices });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/dlna/play - Enviar video a dispositivo
    router.post('/play', async (req, res) => {
        const { deviceUrl, video } = req.body;
        console.log('DLNA play request:', { deviceUrl, videoUrl: video?.url, videoFilename: video?.filename });
        if (!deviceUrl || !video || !video.url) {
            return res.status(400).json({ success: false, error: 'deviceUrl y video.url requeridos' });
        }
        try {
            const result = await dlna.play(deviceUrl, video);
            res.json(result);
        } catch (err) {
            console.error('DLNA play error:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/dlna/pause
    router.post('/pause', async (req, res) => {
        try {
            const result = await dlna.pause();
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/dlna/resume
    router.post('/resume', async (req, res) => {
        try {
            const result = await dlna.resume();
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/dlna/stop
    router.post('/stop', async (req, res) => {
        try {
            const result = await dlna.stop();
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/dlna/seek - { seconds: 120 }
    router.post('/seek', async (req, res) => {
        const { seconds } = req.body;
        if (seconds === undefined) {
            return res.status(400).json({ success: false, error: 'seconds requerido' });
        }
        try {
            const result = await dlna.seek(seconds);
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/dlna/volume - { level: 50 }
    router.post('/volume', async (req, res) => {
        const { level } = req.body;
        if (level === undefined) {
            return res.status(400).json({ success: false, error: 'level requerido (0-100)' });
        }
        try {
            const result = await dlna.setVolume(Math.max(0, Math.min(100, level)));
            res.json(result);
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/dlna/add-device - Añadir dispositivo manual por IP
    router.post('/add-device', async (req, res) => {
        const { ip, name } = req.body;
        if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
            return res.status(400).json({ success: false, error: 'IP invalida. Formato esperado: 192.168.1.100' });
        }
        try {
            const device = await dlna.addManualDevice(ip, name || null);
            res.json({ success: true, data: device });
        } catch (err) {
            res.status(404).json({ success: false, error: err.message });
        }
    });

    // DELETE /api/dlna/remove-device - Eliminar dispositivo manual
    router.delete('/remove-device', (req, res) => {
        const { ip } = req.body;
        if (!ip) {
            return res.status(400).json({ success: false, error: 'IP requerida' });
        }
        const removed = dlna.removeManualDevice(ip);
        res.json({ success: true, removed });
    });

    // GET /api/dlna/status - Estado de reproduccion
    router.get('/status', (req, res) => {
        res.json({ success: true, data: dlna.getStatus() });
    });

    // =============================================
    // Media Proxy - URL simplificada para TVs DLNA
    // Ruta: /dlna/media/:token.mp4 (sin auth)
    // El TV pide a esta URL limpia, y nosotros hacemos
    // proxy interno al endpoint /stream/ real via localhost
    // =============================================

    // CORS para que TVs y apps puedan acceder al media proxy
    mediaRouter.use('/media', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    });

    mediaRouter.get('/media/:tokenFile', (req, res) => {
        const http = require('http');
        const tokenFile = req.params.tokenFile;
        const token = tokenFile.replace(/\.\w+$/, ''); // quitar extension
        const clientIP = (req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');

        console.log(`DLNA PROXY: Peticion de ${clientIP} para token ${token}`);
        console.log(`DLNA PROXY: Headers del TV:`, JSON.stringify(req.headers, null, 2));

        const media = dlna.resolveMediaToken(token);
        if (!media) {
            console.error(`DLNA PROXY: Token ${token} no encontrado`);
            return res.status(404).send('Not found');
        }

        console.log(`DLNA PROXY: Resuelto -> ${media.url} (${media.filename})`);

        // Proxy interno: peticion HTTP a localhost para obtener el stream
        const serverAddr = dlna.getServerAddress();
        const proxyUrl = `http://127.0.0.1:${serverAddr.split(':').pop()}${media.url}`;

        const proxyHeaders = {};
        // Pasar headers relevantes del TV (Range, Accept, etc.)
        if (req.headers.range) proxyHeaders.range = req.headers.range;
        if (req.headers.accept) proxyHeaders.accept = req.headers.accept;

        console.log(`DLNA PROXY: Proxy a ${proxyUrl}`);

        const proxyReq = http.get(proxyUrl, { headers: proxyHeaders }, (proxyRes) => {
            console.log(`DLNA PROXY: Respuesta ${proxyRes.statusCode} (${proxyRes.headers['content-type']})`);

            // Copiar status y headers del stream real al TV
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
            console.error(`DLNA PROXY: Error de proxy:`, err.message);
            if (!res.headersSent) {
                res.status(502).send('Proxy error');
            }
        });

        req.on('close', () => {
            proxyReq.destroy();
        });
    });

    // HEAD para que el TV pueda verificar el recurso
    mediaRouter.head('/media/:tokenFile', (req, res) => {
        const http = require('http');
        const tokenFile = req.params.tokenFile;
        const token = tokenFile.replace(/\.\w+$/, '');
        const clientIP = (req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');

        console.log(`DLNA PROXY: HEAD de ${clientIP} para token ${token}`);

        const media = dlna.resolveMediaToken(token);
        if (!media) {
            return res.status(404).send('Not found');
        }

        const serverAddr = dlna.getServerAddress();
        const proxyUrl = `http://127.0.0.1:${serverAddr.split(':').pop()}${media.url}`;

        const proxyReq = http.request(proxyUrl, { method: 'HEAD' }, (proxyRes) => {
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            res.end();
        });

        proxyReq.on('error', (err) => {
            console.error(`DLNA PROXY: HEAD error:`, err.message);
            if (!res.headersSent) res.status(502).send('Proxy error');
        });

        proxyReq.end();
    });

    // =============================================
    // TV Stream - Streaming optimizado para TVs webOS
    //
    // El browser webOS de LG tiene una limitacion: reproduce fMP4 fragmentado
    // solo si el video NO fue re-encodado (copy). Si el video fue transcodificado
    // con libx264/nvenc, fMP4 solo reproduce audio (sin video).
    //
    // Solucion:
    // - Archivos compatibles (H.264 Main/Baseline ≤720p) → fMP4 copy (rapido)
    // - Archivos incompatibles → transcode a temp file + servir como MP4 directo
    //   con Content-Length y Range requests (funciona perfecto en webOS)
    // =============================================

    // Directorio para archivos temporales de transcode
    const TRANSCODE_DIR = '/tmp/isiprime-transcode';
    // Track de transcodes en progreso para evitar duplicados
    const activeTranscodes = new Map();

    // CORS para tv-stream (TVs webOS necesitan acceso)
    mediaRouter.use('/tv-stream', (req, res, next) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Range, Accept, Content-Type');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges, X-Transcode-Progress');
        if (req.method === 'OPTIONS') return res.status(204).end();
        next();
    });

    // HEAD handler para tv-stream - rapido, sin ffprobe (usado por cast-player para polling)
    mediaRouter.head('/tv-stream/:tokenFile', (req, res) => {
        const fsSync = require('fs');
        const pathModule = require('path');
        const tokenFile = req.params.tokenFile;
        const token = tokenFile.replace(/\.\w+$/, '');

        // Check 1: Transcode en progreso (ANTES de file check - archivo puede estar incompleto)
        if (activeTranscodes.has(token)) {
            const info = activeTranscodes.get(token).info || { progress: 0 };
            res.setHeader('X-Transcode-Progress', String(info.progress));
            return res.status(202).end();
        }

        // Check 2: Transcode completado en cache (solo si no hay transcode activo)
        const tempFile = pathModule.join(TRANSCODE_DIR, `${token}.mp4`);
        if (fsSync.existsSync(tempFile)) {
            const tempStat = fsSync.statSync(tempFile);
            if (tempStat.size > 1024 * 1024) {
                res.setHeader('Content-Type', 'video/mp4');
                res.setHeader('Content-Length', tempStat.size);
                res.setHeader('Accept-Ranges', 'bytes');
                return res.status(200).end();
            }
        }

        // Check 3: No hay transcode, el GET decidira si copy o iniciar transcode
        res.setHeader('Content-Type', 'video/mp4');
        return res.status(200).end();
    });

    // GET handler para tv-stream - sirve el video real
    mediaRouter.get('/tv-stream/:tokenFile', (req, res) => {
        const fsSync = require('fs');
        const pathModule = require('path');
        const ffmpeg = require('fluent-ffmpeg');
        const tokenFile = req.params.tokenFile;
        const token = tokenFile.replace(/\.\w+$/, '');
        const clientIP = (req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');

        console.log(`📺 TV-STREAM: GET de ${clientIP} para token ${token}`);

        const media = dlna.resolveMediaToken(token);
        if (!media) {
            console.error(`📺 TV-STREAM: Token ${token} no encontrado`);
            return res.status(404).send('Not found');
        }

        const filename = media.filename || '';
        const tempFile = pathModule.join(TRANSCODE_DIR, `${token}.mp4`);

        // FAST CHECK: Transcode en progreso (ANTES de file check - archivo incompleto durante encoding)
        if (activeTranscodes.has(token)) {
            const info = activeTranscodes.get(token).info || { progress: 0 };
            console.log(`📺 TV-STREAM: Transcode en progreso ${info.progress}%`);
            res.setHeader('X-Transcode-Progress', String(info.progress));
            return res.status(202).end();
        }

        // FAST CHECK: Transcode completado en cache (solo si no hay transcode activo)
        if (fsSync.existsSync(tempFile)) {
            const tempStat = fsSync.statSync(tempFile);
            if (tempStat.size > 1024 * 1024) {
                console.log(`📺 TV-STREAM: Cache hit: ${tempFile} (${(tempStat.size / 1024 / 1024).toFixed(1)} MB)`);
                return serveFileDirectly(tempFile, req, res);
            }
        }

        // Analizar el video con ffprobe (solo la primera vez)
        const localPath = pathModule.join(context.storageConfig.localPath, filename);

        if (!fsSync.existsSync(localPath)) {
            console.error(`📺 TV-STREAM: Archivo no encontrado: ${localPath}`);
            return res.status(404).send('File not found');
        }

        const stat = fsSync.statSync(localPath);

        ffmpeg.ffprobe(localPath, (probeErr, metadata) => {
            if (probeErr) {
                console.error(`📺 TV-STREAM: Error probing ${filename}:`, probeErr.message);
                return res.status(500).send('Error analyzing video');
            }

            const videoStream = metadata.streams.find(s => s.codec_type === 'video');
            const codec = videoStream?.codec_name || 'unknown';
            const profile = videoStream?.profile || 'unknown';
            const width = videoStream?.width || 0;
            const height = videoStream?.height || 0;

            const ext = pathModule.extname(localPath).toLowerCase();
            const audioStream = metadata.streams.find(s => s.codec_type === 'audio');
            const audioCodec = audioStream?.codec_name || 'unknown';

            // Decidir estrategia de servido:
            // 1. MP4 + H.264 + AAC → servir original directo (la TV decodifica por hardware)
            // 2. H.264 + necesita remux (MKV, audio no-AAC) → remux rapido a temp
            // 3. No H.264 → transcode completo a H.264
            const canServeDirectly = codec === 'h264' && ext === '.mp4' && audioCodec === 'aac';
            const needsRemuxOnly = codec === 'h264' && !canServeDirectly;
            const needsTranscode = codec !== 'h264';

            const mode = canServeDirectly ? 'direct' : needsRemuxOnly ? 'remux' : 'transcode';
            console.log(`📺 TV-STREAM: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB) ${width}x${height} ${codec}/${profile} -> ${mode}`);

            if (canServeDirectly) {
                // FAST PATH: MP4 + H.264 + AAC → servir original sin FFmpeg
                // El browser webOS decodifica H.264 por hardware (cualquier perfil/resolución)
                // Range requests permiten que la TV controle el flujo de datos
                console.log(`📺 TV-STREAM: Sirviendo original directamente`);
                return serveFileDirectly(localPath, req, res);
            }

            if (needsRemuxOnly) {
                // REMUX PATH: H.264 pero necesita cambio de contenedor o audio
                if (!fsSync.existsSync(TRANSCODE_DIR)) fsSync.mkdirSync(TRANSCODE_DIR, { recursive: true });
                console.log(`📺 TV-STREAM: Remux a temp (copy video, aac audio)...`);

                const remuxInfo = { progress: 0, startTime: Date.now() };
                const remuxPromise = new Promise((resolve, reject) => {
                    ffmpeg(localPath)
                        .outputOptions([
                            '-c:v', 'copy',
                            '-c:a', 'aac', '-b:a', '192k',
                            '-movflags', '+faststart'
                        ])
                        .output(tempFile)
                        .on('start', () => console.log(`📺 TV-STREAM: Remux iniciado`))
                        .on('progress', (p) => {
                            if (p.percent) remuxInfo.progress = Math.round(p.percent);
                        })
                        .on('error', (err) => {
                            if (!err.message.includes('SIGKILL')) {
                                console.error(`📺 TV-STREAM: Remux error:`, err.message);
                            }
                            try { fsSync.unlinkSync(tempFile); } catch(e) {}
                            activeTranscodes.delete(token);
                            reject(err);
                        })
                        .on('end', () => {
                            console.log(`📺 TV-STREAM: Remux completado`);
                            activeTranscodes.delete(token);
                            resolve();
                        })
                        .run();
                });
                remuxPromise.info = remuxInfo;
                activeTranscodes.set(token, remuxPromise);

                res.setHeader('X-Transcode-Progress', '0');
                res.status(202).end();
            } else {
                // TRANSCODE PATH: transcode a temp file, servir como MP4 directo
                if (!fsSync.existsSync(TRANSCODE_DIR)) fsSync.mkdirSync(TRANSCODE_DIR, { recursive: true });

                // Iniciar transcode en background
                console.log(`📺 TV-STREAM: Transcodificando: ${tempFile}...`);

                const scaleFilter = height > 720 ? 'scale=-2:720' : null;
                const videoFilters = scaleFilter ? ['-vf', scaleFilter] : [];

                const videoCodecOpts = [
                    '-c:v', 'libx264',
                    '-preset', 'fast',
                    '-profile:v', 'main',
                    '-level', '3.1',
                    '-maxrate', '3M',
                    '-bufsize', '6M',
                    '-pix_fmt', 'yuv420p'
                ];

                const transcodeInfo = { progress: 0, startTime: Date.now() };

                const transcodePromise = new Promise((resolve, reject) => {
                    const transcodeProcess = ffmpeg(localPath)
                        .outputOptions([
                            ...videoFilters,
                            ...videoCodecOpts,
                            '-c:a', 'aac',
                            '-b:a', '192k',
                            '-movflags', '+faststart'
                        ])
                        .output(tempFile)
                        .on('start', (cmd) => console.log(`📺 TV-STREAM: Transcode iniciado: ${cmd}`))
                        .on('progress', (progress) => {
                            if (progress.percent) {
                                transcodeInfo.progress = Math.round(progress.percent);
                                if (transcodeInfo.progress % 10 === 0) {
                                    console.log(`📺 TV-STREAM: Transcode ${transcodeInfo.progress}%`);
                                }
                            }
                        })
                        .on('error', (err) => {
                            if (!err.message.includes('SIGKILL')) {
                                console.error(`📺 TV-STREAM: Transcode error:`, err.message);
                            }
                            try { fsSync.unlinkSync(tempFile); } catch(e) {}
                            activeTranscodes.delete(token);
                            reject(err);
                        })
                        .on('end', () => {
                            console.log(`📺 TV-STREAM: Transcode completado: ${tempFile}`);
                            activeTranscodes.delete(token);
                            resolve();
                        });

                    transcodeProcess.run();
                });

                transcodePromise.info = transcodeInfo;
                activeTranscodes.set(token, transcodePromise);

                // Responder 202 - cast-player reintentara via HEAD
                res.setHeader('X-Transcode-Progress', '0');
                res.status(202).end();
            }
        });
    });

    // Servir archivo como MP4 directo con Range requests (funciona en webOS)
    function serveFileDirectly(filePath, req, res) {
        const fsSync = require('fs');
        if (res.writableEnded || res.destroyed) return;

        const stat = fsSync.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? Math.min(parseInt(parts[1], 10), fileSize - 1) : fileSize - 1;

            if (start >= fileSize) {
                res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
                return res.end();
            }

            const chunkSize = (end - start) + 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': 'video/mp4',
                'Access-Control-Allow-Origin': '*'
            });
            fsSync.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': 'video/mp4',
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*'
            });
            fsSync.createReadStream(filePath).pipe(res);
        }
    }

    // GET /dlna/cast-player?url=...&title=... - Pagina HTML con reproductor para TV
    mediaRouter.get('/cast-player', (req, res) => {
        const { url, title } = req.query;
        if (!url) return res.status(400).send('url requerida');
        const videoTitle = title || 'IsiPrime';
        const safeUrl = url.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeTitle = videoTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${safeTitle}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:#000;overflow:hidden}
video{width:100vw;height:100vh;object-fit:contain}
#status{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
color:#fff;font:28px sans-serif;text-align:center;z-index:10;
background:rgba(0,0,0,0.8);padding:30px 50px;border-radius:16px}
#progress{width:300px;height:8px;background:#333;border-radius:4px;margin:15px auto 0}
#bar{width:0%;height:100%;background:#2196F3;border-radius:4px;transition:width 0.3s}
</style></head>
<body>
<div id="status">Cargando...<div id="progress" style="display:none"><div id="bar"></div></div></div>
<video id="v" controls preload="auto"></video>
<script>
(function(){
    var v=document.getElementById('v');
    var st=document.getElementById('status');
    var progress=document.getElementById('progress');
    var bar=document.getElementById('bar');
    var url="${safeUrl}";
    var title="${safeTitle}";
    var polling=false;

    function log(msg){
        st.innerHTML=msg;
        st.style.display='block';
    }

    // Verificar si el stream esta listo antes de asignar al video
    function checkAndPlay(){
        log('Conectando...');
        fetch(url,{method:'HEAD'}).then(function(r){
            if(r.status===200||r.status===206){
                // Video listo - reproducir
                playVideo();
            } else if(r.status===202){
                // Transcodificando - leer progreso del header (HEAD no tiene body)
                var pct=r.headers.get('x-transcode-progress')||'0';
                log('Preparando video para TV...<br>'+title+'<br><b>'+pct+'%</b><div style="width:300px;height:8px;background:#333;border-radius:4px;margin:15px auto 0"><div style="width:'+pct+'%;height:100%;background:#2196F3;border-radius:4px;transition:width 0.3s"></div></div>');
                setTimeout(checkAndPlay,3000);
            } else {
                log('Esperando stream...');
                setTimeout(checkAndPlay,3000);
            }
        }).catch(function(){
            log('Conectando...');
            setTimeout(checkAndPlay,5000);
        });
    }

    function playVideo(){
        log('Reproduciendo...');
        v.src=url;
        v.load();
    }

    v.addEventListener('loadeddata',function(){
        st.style.display='none';
        v.play().catch(function(){log('Toca la pantalla');});
    });
    v.addEventListener('canplay',function(){
        st.style.display='none';
        v.play().catch(function(){});
    });
    v.addEventListener('playing',function(){st.style.display='none';});
    v.addEventListener('error',function(){
        var code=v.error?v.error.code:'?';
        log('Error '+code+' - reintentando...');
        setTimeout(checkAndPlay,3000);
    });
    v.addEventListener('stalled',function(){log('Buffering...');});
    v.addEventListener('waiting',function(){log('Buffering...');});
    document.body.addEventListener('click',function(){v.play().catch(function(){});});

    checkAndPlay();
})();
</script>
</body></html>`);
    });

    return { apiRouter: router, mediaRouter };
}

module.exports = { initRoutes };
