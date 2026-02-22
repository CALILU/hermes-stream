/**
 * routes/misc.js - Rutas misceláneas (caché, renombrar archivos)
 *
 * POST   /cache/cleanup       - Limpiar caché de entradas huérfanas
 * DELETE /cache               - Limpiar todo el caché
 * POST   /sync-metadata       - Limpiar todo el caché (alias)
 * DELETE /cache/:filename     - Eliminar entrada específica del caché
 * POST   /cache/rename        - Renombrar entrada en caché
 * PUT    /rename              - Renombrar archivo y actualizar metadatos
 *
 * Montado en: /api
 */

const express = require('express');
const fsSync = require('fs');
const path = require('path');

module.exports = function createMiscRoutes(deps) {
    const {
        storageConfig,
        readCache, writeCache, getMovieMetadata, cleanupCache,
        VIDEO_EXTENSIONS_REGEX,
        PORT
    } = deps;

    const router = express.Router();

    // POST /api/cache/cleanup - Limpiar caché de entradas huérfanas
    router.post('/cache/cleanup', async (req, res) => {
        try {
            console.log('🧹 Limpiando caché de entradas huérfanas...');

            // Obtener lista de archivos actuales
            let videoFiles = [];

            if (fsSync.existsSync(storageConfig.localPath)) {
                const files = fsSync.readdirSync(storageConfig.localPath);
                videoFiles = files
                    .filter(name => name.match(/\.(mp4|mkv|avi|mov)$/i))
                    .map(name => ({ name }));
            }

            const result = await cleanupCache(videoFiles);
            res.json({
                success: true,
                removed: result.removed,
                remaining: result.remaining,
                message: `Eliminadas ${result.removed} entradas. Quedan ${result.remaining} en caché.`
            });
        } catch (err) {
            console.error('Error limpiando caché:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // DELETE /api/cache - Limpiar TODO el caché de películas
    router.delete('/cache', async (req, res) => {
        try {
            console.log('🗑️  Limpiando TODO el caché de películas...');
            await writeCache({});
            console.log('✅ Caché completamente limpiado');
            res.json({ success: true, message: 'Caché limpiado completamente' });
        } catch (err) {
            console.error('Error limpiando caché:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // POST /api/sync-metadata - Limpiar todo el caché (alias de DELETE /api/cache)
    router.post('/sync-metadata', async (req, res) => {
        try {
            console.log('🔄 Limpiando todo el caché de TMDB (via sync-metadata)...');
            await writeCache({});
            console.log('✅ Caché completamente limpiado');
            res.json({ success: true, message: 'Caché limpiado completamente' });
        } catch (error) {
            console.error('Error al limpiar caché:', error);
            res.status(500).json({ error: 'Error al limpiar caché' });
        }
    });

    // DELETE /api/cache/:filename - Eliminar entrada específica del caché
    router.delete('/cache/:filename', async (req, res) => {
        try {
            const filename = decodeURIComponent(req.params.filename);
            const cache = await readCache();

            if (cache[filename]) {
                delete cache[filename];
                await writeCache(cache);
                console.log(`🗑️ Eliminado del caché: ${filename}`);
                res.json({ success: true, message: `Caché de "${filename}" eliminado. Se buscará de nuevo en TMDB.` });
            } else {
                res.json({ success: false, message: `"${filename}" no está en caché.` });
            }
        } catch (error) {
            console.error('Error al eliminar del caché:', error);
            res.status(500).json({ error: 'Error al eliminar del caché' });
        }
    });

    // POST /api/cache/rename - Renombrar entrada en caché (sin mover archivo físico)
    router.post('/cache/rename', async (req, res) => {
        try {
            const { oldName, newName } = req.body;

            if (!oldName || !newName) {
                return res.status(400).json({ error: 'Se requieren oldName y newName' });
            }

            const cache = await readCache();

            if (cache[oldName]) {
                // Copiar la entrada con el nuevo nombre
                cache[newName] = { ...cache[oldName] };
                // Eliminar la entrada antigua
                delete cache[oldName];
                await writeCache(cache);
                console.log(`📝 Cache renombrado: "${oldName}" → "${newName}"`);
                res.json({ success: true, message: `Cache actualizado de "${oldName}" a "${newName}"` });
            } else {
                // Si no existe la entrada original, buscar en TMDB para el nuevo nombre
                console.log(`📝 "${oldName}" no está en cache, buscando "${newName}" en TMDB...`);
                const metadata = await getMovieMetadata(newName);
                if (metadata) {
                    res.json({ success: true, message: `Metadatos obtenidos para "${newName}"` });
                } else {
                    res.json({ success: false, message: `No se encontró "${newName}" en TMDB` });
                }
            }
        } catch (error) {
            console.error('Error al renombrar cache:', error);
            res.status(500).json({ error: 'Error al renombrar cache' });
        }
    });

    // PUT /api/rename - Renombrar archivo y actualizar metadatos
    router.put('/rename', async (req, res) => {
        console.log('🎯 Petición PUT /api/rename recibida');
        console.log('📦 Body:', req.body);

        const { oldName, newName } = req.body;

        if (!oldName || !newName) {
            console.log('❌ Faltan parámetros');
            return res.status(400).json({ error: 'Se requieren oldName y newName' });
        }

        try {
            console.log(`📝 Renombrando: "${oldName}" → "${newName}"`);

            const oldPath = path.join(storageConfig.localPath, oldName);
            const newPath = path.join(storageConfig.localPath, newName);

            if (!fsSync.existsSync(oldPath)) {
                return res.status(404).json({ error: `Archivo no encontrado: ${oldName}` });
            }
            if (fsSync.existsSync(newPath) && oldPath !== newPath) {
                return res.status(400).json({ error: `Ya existe un archivo con el nombre: ${newName}` });
            }

            fsSync.renameSync(oldPath, newPath);
            console.log('✓ Archivo local renombrado');

            // Limpiar caché de la entrada antigua
            const cache = await readCache();
            if (cache[oldName]) {
                delete cache[oldName];
                await writeCache(cache);
                console.log('✓ Caché antiguo eliminado');
            }

            // Buscar nuevos metadatos en TMDB
            const metadata = await getMovieMetadata(newName);
            console.log('✓ Nuevos metadatos obtenidos de TMDB');

            // Devolver información actualizada
            const updatedVideo = {
                filename: newName,
                title: metadata?.title || newName.replace(/\.(mp4|mkv|avi|mov)$/i, ''),
                url: `http://localhost:${PORT}/stream/${encodeURIComponent(newName)}`,
                poster: metadata?.poster_path || null,
                backdrop: metadata?.backdrop_path || null,
                overview: metadata?.overview || null,
                releaseDate: metadata?.release_date || null,
                rating: metadata?.vote_average || null
            };

            res.json({
                success: true,
                message: `Archivo renombrado y metadatos actualizados`,
                video: updatedVideo
            });

        } catch (error) {
            console.error('❌ Error al renombrar:', error.message);
            res.status(500).json({ error: `Error al renombrar: ${error.message}` });
        }
    });

    return router;
};
