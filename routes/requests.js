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
const ftp = require('basic-ftp');
const router = express.Router();

module.exports = function createRequestsRoutes(deps) {
    const {
        REQUESTS_READONLY, requestsSSEClients, storageConfig, requestsDB,
        FTP_CONFIG,
        readRequests, writeRequests, notifyRequestUpdate,
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
            const data = await readRequests();
            const cache = await readCache();
            let modified = false;

            // Leer archivos del disco directamente
            let diskFiles = [];

            if (storageConfig.mode === 'local') {
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
            } else {
                // Modo FTP - consultar servidor FTP directamente
                const client = new ftp.Client();
                client.ftp.verbose = false;
                try {
                    await client.access({ ...FTP_CONFIG, secure: false, passive: true });
                    const ftpFiles = await client.list("/volume-1");
                    diskFiles = ftpFiles
                        .filter(f => VIDEO_EXTENSIONS_REGEX.test(f.name))
                        .map(f => {
                            const nameWithoutExt = f.name.replace(VIDEO_EXTENSIONS_REGEX, '');
                            const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
                            const year = yearMatch ? yearMatch[1] : '';
                            const title = nameWithoutExt.replace(/\s*\(\d{4}\)\s*$/, '').trim();
                            return {
                                filename: f.name,
                                title: title,
                                year: year,
                                titleNorm: normalizeText(title)
                            };
                        });
                    console.log(`📂 Verificando ${diskFiles.length} archivos en FTP para auto-detección`);
                } catch (ftpErr) {
                    console.error('❌ Error consultando FTP:', ftpErr.message);
                    // Fallback al cache si falla FTP
                    diskFiles = Object.keys(cache).map(filename => {
                        const nameWithoutExt = filename.replace(VIDEO_EXTENSIONS_REGEX, '');
                        const yearMatch = nameWithoutExt.match(/\((\d{4})\)/);
                        const year = yearMatch ? yearMatch[1] : '';
                        const title = nameWithoutExt.replace(/\s*\(\d{4}\)\s*$/, '').trim();
                        return {
                            filename: filename,
                            title: title,
                            year: year,
                            titleNorm: normalizeText(title)
                        };
                    });
                } finally {
                    client.close();
                }
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
                            modified = true;

                            if (storageConfig.mode === 'local') {
                                requestsDB.update(request.id, { status: 'server' });
                            }

                            notifyRequestUpdate(request);
                        }
                    } else {
                        console.log(`      ❌ No encontrado en servidor`);
                    }
                }

                // Eliminar peticiones completadas hace más de 7 días
                if (request.status === 'downloaded' || request.status === 'server') {
                    const updatedAt = new Date(request.updatedAt);
                    if (updatedAt < sevenDaysAgo) {
                        console.log(`🗑️ Auto-eliminando petición antigua: "${request.title}" (completada hace más de 7 días)`);
                        modified = true;

                        if (storageConfig.mode === 'local') {
                            requestsDB.remove(request.id);
                        }

                        return false;
                    }
                }

                return true;
            });

            // Guardar cambios si hubo modificaciones (solo para FTP)
            if (modified && storageConfig.mode !== 'local') {
                await writeRequests(data);
            }

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

            // ========== MODO LOCAL: usar SQLite ==========
            if (storageConfig.mode === 'local') {
                const result = requestsDB.createMany(movies, requestedBy || 'Usuario');
                console.log(`📥 ${result.created} nueva(s) petición(es) añadida(s)${result.duplicates > 0 ? `, ${result.duplicates} duplicadas` : ''}`);
                res.json({
                    success: true,
                    created: result.created,
                    duplicates: result.duplicates,
                    total: result.total
                });
                return;
            }

            // ========== MODO FTP: usar JSON ==========
            const data = await readRequests();
            let created = 0;
            let duplicates = 0;

            for (const movie of movies) {
                const tmdbId = movie.tmdbId || movie.tmdb_id || movie.id;
                const exists = data.requests.find(r => r.tmdbId === tmdbId);

                if (exists) {
                    duplicates++;
                    continue;
                }

                const newRequest = {
                    id: data.nextId++,
                    tmdbId: tmdbId,
                    title: movie.title,
                    originalTitle: movie.originalTitle || movie.original_title,
                    year: movie.year || (movie.release_date ? movie.release_date.split('-')[0] : null),
                    poster: movie.poster || (movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : null),
                    overview: movie.overview,
                    rating: movie.rating || movie.vote_average,
                    status: 'pending',
                    requestedBy: requestedBy || 'Usuario',
                    requestedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString()
                };

                data.requests.push(newRequest);
                created++;
            }

            await writeRequests(data);

            console.log(`📥 ${created} nueva(s) petición(es) añadida(s)${duplicates > 0 ? `, ${duplicates} duplicadas` : ''}`);
            res.json({
                success: true,
                created,
                duplicates,
                total: data.requests.length
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

            // ========== MODO LOCAL: usar SQLite ==========
            if (storageConfig.mode === 'local') {
                const request = requestsDB.update(parseInt(id), { status, adminNotes });

                if (!request) {
                    return res.status(404).json({ error: 'Petición no encontrada' });
                }

                notifyRequestUpdate(request);

                console.log(`📝 Petición #${id} actualizada: ${status || 'sin cambio de estado'}`);
                res.json({ success: true, request });
                return;
            }

            // ========== MODO FTP: usar JSON ==========
            const data = await readRequests();
            const request = data.requests.find(r => r.id === parseInt(id));

            if (!request) {
                return res.status(404).json({ error: 'Petición no encontrada' });
            }

            if (status) {
                request.status = status;
            }

            if (adminNotes !== undefined) {
                request.adminNotes = adminNotes;
            }

            request.updatedAt = new Date().toISOString();

            await writeRequests(data);

            notifyRequestUpdate(request);

            console.log(`📝 Petición #${id} actualizada: ${status || 'sin cambio de estado'}`);
            res.json({
                success: true,
                request
            });

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

            // ========== MODO LOCAL: usar SQLite ==========
            if (storageConfig.mode === 'local') {
                const request = requestsDB.getById(parseInt(id));
                if (!request) {
                    return res.status(404).json({ error: 'Petición no encontrada' });
                }

                requestsDB.remove(parseInt(id));
                console.log(`🗑️ Petición #${id} eliminada: ${request.title}`);
                res.json({ success: true, deleted: request });
                return;
            }

            // ========== MODO FTP: usar JSON ==========
            const data = await readRequests();

            const index = data.requests.findIndex(r => r.id === parseInt(id));
            if (index === -1) {
                return res.status(404).json({ error: 'Petición no encontrada' });
            }

            const deleted = data.requests.splice(index, 1)[0];
            await writeRequests(data);

            console.log(`🗑️ Petición #${id} eliminada: ${deleted.title}`);
            res.json({ success: true, deleted });

        } catch (error) {
            console.error('Error eliminando petición:', error);
            res.status(500).json({ error: 'Error al eliminar petición' });
        }
    });

    // Estadísticas de peticiones
    router.get('/stats', async (req, res) => {
        try {
            // ========== MODO LOCAL: usar SQLite ==========
            if (storageConfig.mode === 'local') {
                const stats = requestsDB.getStats();
                res.json(stats);
                return;
            }

            // ========== MODO FTP: calcular desde JSON ==========
            const data = await readRequests();
            const stats = {
                total: data.requests.length,
                pending: data.requests.filter(r => r.status === 'pending').length,
                downloading: data.requests.filter(r => r.status === 'downloading').length,
                downloaded: data.requests.filter(r => r.status === 'downloaded').length,
                mp4: data.requests.filter(r => r.status === 'mp4').length,
                server: data.requests.filter(r => r.status === 'server').length,
                rejected: data.requests.filter(r => r.status === 'rejected').length
            };
            res.json(stats);
        } catch (error) {
            res.status(500).json({ error: 'Error al obtener estadísticas' });
        }
    });

    return router;
};
