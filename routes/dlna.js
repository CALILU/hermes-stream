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

    return { apiRouter: router, mediaRouter };
}

module.exports = { initRoutes };
