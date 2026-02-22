/**
 * routes/user-data.js - Rutas de datos por usuario
 *
 * PUT    /progress            - Guardar/actualizar progreso de video
 * GET    /progress/:videoPath - Obtener progreso de un video
 * GET    /progress            - Obtener todo el progreso del usuario
 * DELETE /progress/:videoPath - Eliminar progreso de un video
 * GET    /continue-watching   - Videos para "continuar viendo"
 * POST   /favorites           - Agregar favorito
 * DELETE /favorites           - Eliminar favorito
 * GET    /favorites           - Listar favoritos
 *
 * Montado en: /api/user-data
 */

const express = require('express');
const router = express.Router();

module.exports = function createUserDataRoutes(deps) {
    const { usersDB, authMiddleware } = deps;

    // Todas las rutas requieren autenticacion
    router.use(authMiddleware);

    // =========================================================================
    // PROGRESO DE REPRODUCCION
    // =========================================================================

    // PUT /progress - Guardar/actualizar progreso
    router.put('/progress', async (req, res) => {
        try {
            const { videoPath, position, duration } = req.body;

            if (!videoPath) {
                return res.status(400).json({ success: false, error: 'videoPath es requerido' });
            }
            if (position === undefined || position === null || position < 0) {
                return res.status(400).json({ success: false, error: 'position debe ser >= 0' });
            }
            if (!duration || duration <= 0) {
                return res.status(400).json({ success: false, error: 'duration debe ser > 0' });
            }

            usersDB.upsertProgress(req.user.id, videoPath, position, duration);
            res.json({ success: true });
        } catch (error) {
            console.error('Error guardando progreso:', error);
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    // GET /progress/:videoPath - Obtener progreso de un video
    router.get('/progress/:videoPath', (req, res) => {
        try {
            const videoPath = decodeURIComponent(req.params.videoPath);
            const progress = usersDB.getProgress(req.user.id, videoPath);

            if (!progress) {
                return res.status(404).json({ success: false, error: 'Progreso no encontrado' });
            }

            res.json(progress);
        } catch (error) {
            console.error('Error obteniendo progreso:', error);
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    // GET /progress - Obtener todo el progreso del usuario
    router.get('/progress', (req, res) => {
        try {
            const progress = usersDB.getAllProgress(req.user.id);
            res.json(progress);
        } catch (error) {
            console.error('Error obteniendo progreso:', error);
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    // DELETE /progress/:videoPath - Eliminar progreso de un video
    router.delete('/progress/:videoPath', (req, res) => {
        try {
            const videoPath = decodeURIComponent(req.params.videoPath);
            usersDB.deleteProgress(req.user.id, videoPath);
            res.json({ success: true });
        } catch (error) {
            console.error('Error eliminando progreso:', error);
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    // =========================================================================
    // CONTINUAR VIENDO
    // =========================================================================

    // GET /continue-watching - Videos para "continuar viendo"
    router.get('/continue-watching', (req, res) => {
        try {
            const limit = parseInt(req.query.limit) || 20;
            const videos = usersDB.getContinueWatching(req.user.id, limit);
            res.json({ videos });
        } catch (error) {
            console.error('Error obteniendo continuar viendo:', error);
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    // =========================================================================
    // FAVORITOS
    // =========================================================================

    // POST /favorites - Agregar favorito
    router.post('/favorites', (req, res) => {
        try {
            const { videoPath } = req.body;

            if (!videoPath) {
                return res.status(400).json({ success: false, error: 'videoPath es requerido' });
            }

            usersDB.addFavorite(req.user.id, videoPath);
            res.json({ success: true });
        } catch (error) {
            console.error('Error agregando favorito:', error);
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    // DELETE /favorites - Eliminar favorito
    router.delete('/favorites', (req, res) => {
        try {
            const videoPath = req.body.videoPath || req.query.videoPath;

            if (!videoPath) {
                return res.status(400).json({ success: false, error: 'videoPath es requerido' });
            }

            usersDB.removeFavorite(req.user.id, videoPath);
            res.json({ success: true });
        } catch (error) {
            console.error('Error eliminando favorito:', error);
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    // GET /favorites - Listar favoritos
    router.get('/favorites', (req, res) => {
        try {
            const favorites = usersDB.getFavorites(req.user.id);
            res.json({ favorites });
        } catch (error) {
            console.error('Error obteniendo favoritos:', error);
            res.status(500).json({ success: false, error: 'Error interno del servidor' });
        }
    });

    return router;
};
