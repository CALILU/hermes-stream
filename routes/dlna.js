/**
 * Rutas DLNA/UPnP - Cast a TV
 * Montar en: /api/dlna
 */

const express = require('express');
const router = express.Router();

function initRoutes(context) {
    const dlna = require('../lib/dlna');

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
        if (!deviceUrl || !video || !video.url) {
            return res.status(400).json({ success: false, error: 'deviceUrl y video.url requeridos' });
        }
        try {
            const result = await dlna.play(deviceUrl, video);
            res.json(result);
        } catch (err) {
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

    // GET /api/dlna/status - Estado de reproduccion
    router.get('/status', (req, res) => {
        res.json({ success: true, data: dlna.getStatus() });
    });

    return router;
}

module.exports = { initRoutes };
