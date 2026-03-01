/**
 * routes/poster-cache.js - Proxy local para imágenes TMDB
 *
 * GET /api/img/:size/:filename - Sirve imagen cacheada o descarga on-demand
 * Fallback: redirect 302 a TMDB si falla la descarga
 *
 * Montado en: /api/img
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const posterCache = require('../lib/poster-cache');

// GET /:size/:filename (e.g., /w342/abc123.jpg)
router.get('/:size/:filename', async (req, res) => {
    const size = req.params.size;
    const imgPath = '/' + req.params.filename; // e.g., /abc123.jpg

    if (!posterCache.VALID_SIZES.includes(size)) {
        return res.status(400).send('Invalid size');
    }

    // Try cached first
    let filePath = posterCache.getCachedPath(size, imgPath);

    if (!filePath) {
        // Download on-demand
        try {
            filePath = await posterCache.downloadAndCache(size, imgPath);
        } catch (err) {
            // Fallback: redirect to TMDB original
            const tmdbUrl = `https://image.tmdb.org/t/p/${size}${imgPath}`;
            return res.redirect(302, tmdbUrl);
        }
    }

    // Serve from disk with long cache
    const ext = path.extname(filePath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=2592000'); // 30 days
    res.sendFile(filePath);
});

module.exports = router;
