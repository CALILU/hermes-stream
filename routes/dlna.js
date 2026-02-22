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
    // TV Stream - Streaming optimizado para TVs
    // Remuxea a fMP4 via FFmpeg (sin re-encoding)
    // El formato fMP4 funciona mejor en browsers de TV
    // =============================================
    mediaRouter.get('/tv-stream/:tokenFile', (req, res) => {
        const fsSync = require('fs');
        const pathModule = require('path');
        const ffmpeg = require('fluent-ffmpeg');
        const tokenFile = req.params.tokenFile;
        const token = tokenFile.replace(/\.\w+$/, '');
        const clientIP = (req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');

        console.log(`📺 TV-STREAM: Peticion de ${clientIP} para token ${token}`);

        const media = dlna.resolveMediaToken(token);
        if (!media) {
            console.error(`📺 TV-STREAM: Token ${token} no encontrado`);
            return res.status(404).send('Not found');
        }

        const filename = media.filename || '';
        // Resolver la ruta local del archivo
        const localPath = pathModule.join(context.storageConfig.localPath, filename);

        if (!fsSync.existsSync(localPath)) {
            console.error(`📺 TV-STREAM: Archivo no encontrado: ${localPath}`);
            return res.status(404).send('File not found');
        }

        const stat = fsSync.statSync(localPath);
        console.log(`📺 TV-STREAM: ${filename} (${(stat.size / 1024 / 1024).toFixed(1)} MB) -> fMP4 remux`);

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Access-Control-Allow-Origin', '*');

        const ffmpegProcess = ffmpeg(localPath)
            .outputOptions([
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-movflags', 'frag_keyframe+empty_moov+faststart',
                '-f', 'mp4'
            ])
            .on('start', (cmd) => console.log(`📺 TV-STREAM: FFmpeg iniciado`))
            .on('error', (err) => {
                if (!err.message.includes('SIGKILL') && !err.message.includes('Output stream closed')) {
                    console.error(`📺 TV-STREAM: FFmpeg error:`, err.message);
                }
            })
            .on('end', () => console.log(`📺 TV-STREAM: Completado`));

        ffmpegProcess.pipe(res, { end: true });

        res.on('close', () => {
            ffmpegProcess.kill('SIGKILL');
        });
    });

    // GET /dlna/cast-player?url=...&title=... - Pagina HTML con reproductor para TV
    mediaRouter.get('/cast-player', (req, res) => {
        const { url, title } = req.query;
        if (!url) return res.status(400).send('url requerida');
        const videoTitle = title || 'IsiPrime';
        // Escapar para insercion segura en HTML
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
color:#fff;font:24px sans-serif;text-align:center;z-index:10}
</style></head>
<body>
<div id="status">Cargando...</div>
<video id="v" controls preload="auto"></video>
<script>
(function(){
    var v=document.getElementById('v');
    var st=document.getElementById('status');
    var url="${safeUrl}";

    function log(msg){st.textContent=msg;console.log('[CastPlayer]',msg);}

    // Intentar reproduccion con XMLHttpRequest para verificar que la URL funciona
    function tryPlay(){
        log('Conectando al stream...');
        v.src=url;
        v.load();
    }

    v.addEventListener('loadeddata',function(){
        log('Video cargado, reproduciendo...');
        st.style.display='none';
        v.play().catch(function(e){
            log('Toca la pantalla para reproducir');
        });
    });

    v.addEventListener('canplay',function(){
        st.style.display='none';
        v.play().catch(function(){});
    });

    v.addEventListener('playing',function(){
        st.style.display='none';
    });

    v.addEventListener('error',function(e){
        var code=v.error?v.error.code:'?';
        var msg=v.error?v.error.message:'desconocido';
        log('Error '+code+': '+msg);
        // Reintentar en 3 segundos
        setTimeout(tryPlay,3000);
    });

    v.addEventListener('stalled',function(){log('Buffering...');});
    v.addEventListener('waiting',function(){
        st.style.display='block';
        log('Buffering...');
    });

    // Interaccion del usuario para desbloquear autoplay
    document.body.addEventListener('click',function(){
        v.play().catch(function(){});
    });

    // Iniciar
    tryPlay();
})();
</script>
</body></html>`);
    });

    return { apiRouter: router, mediaRouter };
}

module.exports = { initRoutes };
