/**
 * routes/requests.js - Rutas de peticiones de películas
 *
 * GET  /readonly - Estado solo lectura
 * GET  /events   - SSE actualizaciones en tiempo real
 * GET  /         - Listar peticiones (con auto-detección)
 * POST /         - Crear petición(es)
 * PUT  /:id      - Actualizar petición
 * DELETE /:id    - Eliminar petición
 * GET  /stats    - Estadísticas
 *
 * Montado en: /api/requests
 */

const express = require('express');
const fsSync = require('fs');
const router = express.Router();

module.exports = function createRequestsRoutes(deps) {
    const {
        REQUESTS_READONLY, requestsSSEClients, storageConfig, requestsDB,
        notifyRequestUpdate,
        readCache,
        normalizeText, getMainTitle, calculateSimilarity,
        VIDEO_EXTENSIONS_REGEX
    } = deps;

    // Endpoint para que el frontend sepa si está en modo solo lectura
    router.get('/readonly', (req, res) => {
        res.json({ readonly: REQUESTS_READONLY });
    });

    // SSE endpoint para actualizaciones en tiempo real de peticiones
    router.get('/events', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('Access-Control-Allow-Origin', '*');

        // Añadir cliente a la lista
        requestsSSEClients.add(res);
        console.log(`📡 Cliente SSE conectado (${requestsSSEClients.size} activos)`);

        // Enviar heartbeat cada 30 segundos para mantener conexión
        const heartbeat = setInterval(() => {
            res.write(':heartbeat\n\n');
        }, 30000);

        // Limpiar cuando se desconecta
        req.on('close', () => {
            clearInterval(heartbeat);
            requestsSSEClients.delete(res);
            console.log(`📡 Cliente SSE desconectado (${requestsSSEClients.size} activos)`);
        });
    });

    // Obtener todas las peticiones (con auto-detección leyendo del disco)
    router.get('/', async (req, res) => {
        try {
            const data = { requests: requestsDB.getAll() };
            const cache = await readCache();

            // Leer archivos del disco directamente
            let diskFiles = [];

            if (fsSync.existsSync(storageConfig.localPath)) {
                const files = fsSync.readdirSync(storageConfig.localPath);
                diskFiles = files
                    .filter(name => VIDEO_EXTENSIONS_REGEX.test(name))
                    .map(name => {
                        const nameWithoutExt = name.replace(VIDEO_EXTENSIONS_REGEX, '');
                        const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
                        const year = yearMatch ? yearMatch[1] : '';
                        const title = nameWithoutExt.replace(/\s*\(\d{4}\)\s*$/, '').trim();
                        return {
                            filename: name,
                            title: title,
                            year: year,
                            titleNorm: normalizeText(title)
                        };
                    });
                console.log(`📂 Verificando ${diskFiles.length} archivos en disco para auto-detección`);
            }

            // Obtener todos los tmdb_ids de películas en la biblioteca
            const libraryTmdbIds = new Set(
                Object.values(cache)
                    .filter(movie => movie.tmdb_id)
                    .map(movie => movie.tmdb_id)
            );

            const now = new Date();
            const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

            console.log(`📋 Verificando ${data.requests.length} peticiones contra ${diskFiles.length} archivos en servidor`);
            if (diskFiles.length > 0) {
                console.log(`   Ejemplos de archivos: ${diskFiles.slice(0, 3).map(f => f.filename).join(', ')}...`);
            }

            // Filtrar y actualizar peticiones
            data.requests = data.requests.filter(request => {
                if (request.status !== 'server' && request.status !== 'rejected') {
                    let found = false;
                    let foundBy = '';

                    console.log(`   🔍 Buscando: "${request.title}" (${request.year || '-'}) [${request.status}]`);

                    // 1. Buscar por TMDB ID (más preciso)
                    if (libraryTmdbIds.has(request.tmdbId)) {
                        found = true;
                        foundBy = 'TMDB ID';
                    }

                    // 2. Fallback: buscar por título + año en disco
                    if (!found && request.title) {
                        const reqTitleNorm = normalizeText(request.title);
                        const reqMainTitle = normalizeText(getMainTitle(request.title));
                        const reqYear = request.year ? String(request.year).substring(0, 4) : '';

                        const match = diskFiles.find(file => {
                            if (reqYear && file.year && reqYear !== file.year) {
                                return false;
                            }

                            const fileTitleNorm = file.titleNorm;
                            const fileMainTitle = normalizeText(getMainTitle(file.title));

                            if (fileTitleNorm === reqTitleNorm) return true;
                            if (fileTitleNorm.includes(reqTitleNorm) || reqTitleNorm.includes(fileTitleNorm)) return true;
                            if (fileMainTitle === reqMainTitle && fileMainTitle.length > 3) return true;

                            const similarity = calculateSimilarity(file.title, request.title);
                            if (similarity >= 0.85) return true;

                            const mainSimilarity = calculateSimilarity(getMainTitle(file.title), getMainTitle(request.title));
                            if (mainSimilarity >= 0.9 && reqYear === file.year) return true;

                            return false;
                        });

                        if (match) {
                            found = true;
                            foundBy = `título+año (${match.filename})`;
                        }
                    }

                    if (found) {
                        console.log(`      ✅ Encontrado por ${foundBy}`);
                        if (request.status !== 'server') {
                            request.status = 'server';
                            request.updatedAt = now.toISOString();

                            requestsDB.update(request.id, { status: 'server' });
                            notifyRequestUpdate(request);
                        }
                    } else {
                        console.log(`      ❌ No encontrado en servidor`);
                    }
                }

                // Eliminar peticiones completadas hace más de 7 días (basado en fecha de petición)
                if (request.status === 'downloaded' || request.status === 'server') {
                    const dateStr = request.requestedAt || request.requested_at || request.updatedAt || request.updated_at;
                    const requestDate = dateStr ? new Date(dateStr) : null;
                    if (requestDate && !isNaN(requestDate.getTime()) && requestDate < sevenDaysAgo) {
                        console.log(`🗑️ Auto-eliminando petición antigua: "${request.title}" (pedida hace más de 7 días)`);

                        requestsDB.remove(request.id);

                        return false;
                    }
                }

                return true;
            });

            res.json({ requests: data.requests });
        } catch (error) {
            console.error('Error leyendo peticiones:', error);
            res.status(500).json({ error: 'Error al obtener peticiones' });
        }
    });

    // Crear nueva(s) petición(es)
    // NOTA: Crear peticiones está permitido incluso en modo solo lectura
    router.post('/', async (req, res) => {
        try {
            const { movies, requestedBy } = req.body;

            if (!movies || !Array.isArray(movies) || movies.length === 0) {
                return res.status(400).json({ error: 'Se requiere un array de películas' });
            }

            const result = requestsDB.createMany(movies, requestedBy || 'Usuario');
            console.log(`📥 ${result.created} nueva(s) petición(es) añadida(s)${result.duplicates > 0 ? `, ${result.duplicates} duplicadas` : ''}`);
            res.json({
                success: true,
                created: result.created,
                duplicates: result.duplicates,
                total: result.total
            });

        } catch (error) {
            console.error('Error creando petición:', error);
            res.status(500).json({ error: 'Error al crear petición' });
        }
    });

    // Actualizar estado de una petición (admin)
    router.put('/:id', async (req, res) => {
        if (REQUESTS_READONLY) {
            return res.status(403).json({ error: 'Modo solo lectura: no se pueden modificar peticiones desde este ordenador' });
        }

        try {
            const { id } = req.params;
            const { status, adminNotes } = req.body;

            if (status && !['pending', 'downloading', 'downloaded', 'rejected', 'mp4', 'server'].includes(status)) {
                return res.status(400).json({ error: 'Estado inválido' });
            }

            const request = requestsDB.update(parseInt(id), { status, adminNotes });

            if (!request) {
                return res.status(404).json({ error: 'Petición no encontrada' });
            }

            notifyRequestUpdate(request);

            console.log(`📝 Petición #${id} actualizada: ${status || 'sin cambio de estado'}`);
            res.json({ success: true, request });

        } catch (error) {
            console.error('Error actualizando petición:', error);
            res.status(500).json({ error: 'Error al actualizar petición' });
        }
    });

    // Eliminar una petición (admin)
    router.delete('/:id', async (req, res) => {
        if (REQUESTS_READONLY) {
            return res.status(403).json({ error: 'Modo solo lectura: no se pueden eliminar peticiones desde este ordenador' });
        }

        try {
            const { id } = req.params;

            const request = requestsDB.getById(parseInt(id));
            if (!request) {
                return res.status(404).json({ error: 'Petición no encontrada' });
            }

            requestsDB.remove(parseInt(id));
            console.log(`🗑️ Petición #${id} eliminada: ${request.title}`);
            res.json({ success: true, deleted: request });

        } catch (error) {
            console.error('Error eliminando petición:', error);
            res.status(500).json({ error: 'Error al eliminar petición' });
        }
    });

    // Estadísticas de peticiones
    router.get('/stats', async (req, res) => {
        try {
            const stats = requestsDB.getStats();
            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
    });

    return router;
};
