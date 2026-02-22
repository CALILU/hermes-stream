/**
 * routes/downloads.js - Rutas de cola de descargas y búsqueda de torrents
 *
 * POST   /download-queue           - Añadir URL a cola
 * GET    /download-queue           - Ver estado de cola
 * DELETE /download-queue/completed - Limpiar completadas
 * DELETE /download-queue/all       - Vaciar cola
 * POST   /search-torrents          - Buscar en TodoTorrents (Tor)
 *
 * Montado en: /api
 */

const express = require('express');
const fsSync = require('fs');
const { exec } = require('child_process');
const { normalizeText, calculateSimilarity } = require('../lib/utils');
const router = express.Router();

module.exports = function createDownloadsRoutes(deps) {
    const {
        readDownloadQueue, writeDownloadQueue, launchDownloaderApp,
        isDownloaderAppRunning, isDownloaderAppRecentlyLaunched,
        getLastQueueState,
        readRequests, writeRequests, notifyRequestUpdate
    } = deps;

    // Detectar si estamos en Windows o WSL
    const isWindows = process.platform === 'win32';
    const TOR_BROWSER_PATH_WIN = 'C:\\Users\\isidr\\Desktop\\Tor Browser\\Browser\\firefox.exe';
    const TOR_BROWSER_PATH_WSL = '/mnt/c/Users/isidr/Desktop/Tor Browser/Browser/firefox.exe';
    const TOR_BROWSER_PATH = isWindows ? TOR_BROWSER_PATH_WIN : TOR_BROWSER_PATH_WSL;
    const TODOTORRENTS_URL = 'https://todotorrents.org';
    let lastTorLaunch = 0;

    // Último requestId buscado desde la UI (para vincular con la extensión Chrome)
    let pendingRequestId = null;
    let pendingRequestTimestamp = 0;
    const PENDING_REQUEST_TTL = 5 * 60 * 1000; // 5 minutos de validez

    // POST /api/download-queue/pending-request - Guardar requestId pendiente
    router.post('/download-queue/pending-request', (req, res) => {
        const { requestId } = req.body;
        pendingRequestId = requestId;
        pendingRequestTimestamp = Date.now();
        console.log(`📋 Request pendiente guardado: ID ${requestId}`);
        res.json({ success: true });
    });

    function isTorBrowserRunning() {
        return new Promise((resolve) => {
            const cmd = isWindows ? 'tasklist /FI "IMAGENAME eq firefox.exe" /FO CSV' : 'tasklist.exe /FI "IMAGENAME eq firefox.exe" /FO CSV';
            exec(cmd, (error, stdout) => {
                if (error) {
                    resolve(false);
                    return;
                }
                const isRunning = stdout.toLowerCase().includes('firefox.exe');
                resolve(isRunning);
            });
        });
    }

    // POST /api/download-queue - Añadir URL a la cola de descargas
    router.post('/download-queue', async (req, res) => {
        try {
            const { url, title, requestId } = req.body;

            if (!url) {
                return res.status(400).json({ error: 'URL requerida' });
            }

            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return res.status(400).json({ error: 'URL inválida' });
            }

            const queue = await readDownloadQueue();

            // Verificar duplicados (solo pendientes o en descarga)
            const isDuplicate = queue.some(item =>
                item.url === url && ['pending', 'downloading'].includes(item.status)
            );

            // Función de matching de peticiones
            async function matchRequestByTitle(title, requestId) {
                try {
                    const requestsData = await readRequests();
                    const totalRequests = requestsData.requests?.length || 0;
                    console.log(`📋 Buscando match en ${totalRequests} peticiones...`);
                    let requestToUpdate = null;

                    // Usar requestId explícito, o pendingRequestId como fallback
                    const effectiveRequestId = requestId || (
                        pendingRequestId && (Date.now() - pendingRequestTimestamp) < PENDING_REQUEST_TTL
                            ? pendingRequestId : null
                    );

                    if (effectiveRequestId) {
                        requestToUpdate = requestsData.requests.find(r => r.id === effectiveRequestId);
                        if (requestToUpdate) {
                            console.log(`📋 Match por requestId${!requestId ? ' (pendiente)' : ''}: ${effectiveRequestId} → "${requestToUpdate.title}"`);
                            pendingRequestId = null; // Consumir el pendiente
                        }
                    }

                    if (!requestToUpdate && title) {
                        const normTitle = normalizeText(title);
                        console.log(`📋 Título normalizado: "${normTitle}"`);

                        let bestMatch = null;
                        let bestScore = 0;
                        let candidatesChecked = 0;

                        for (const r of requestsData.requests) {
                            if (r.status === 'server' || r.status === 'downloading') continue;
                            candidatesChecked++;
                            const reqNorm = normalizeText(r.title);
                            const reqOrigNorm = r.originalTitle ? normalizeText(r.originalTitle) : null;
                            if (!reqNorm && !reqOrigNorm) continue;

                            // Coincidencia exacta normalizada (título español o título original)
                            if (reqNorm === normTitle || (reqOrigNorm && reqOrigNorm === normTitle)) {
                                bestMatch = r; bestScore = 1; break;
                            }

                            // includes en ambas direcciones (título español)
                            if (reqNorm && (reqNorm.includes(normTitle) || normTitle.includes(reqNorm))) {
                                const score = 0.9;
                                if (score > bestScore) { bestMatch = r; bestScore = score; }
                                continue;
                            }

                            // includes en ambas direcciones (título original/inglés)
                            if (reqOrigNorm && (reqOrigNorm.includes(normTitle) || normTitle.includes(reqOrigNorm))) {
                                const score = 0.9;
                                if (score > bestScore) { bestMatch = r; bestScore = score; }
                                continue;
                            }

                            // Similitud por palabras coincidentes (mejor score entre título español y original)
                            let sim = calculateSimilarity(title, r.title);
                            if (r.originalTitle) {
                                const simOrig = calculateSimilarity(title, r.originalTitle);
                                if (simOrig > sim) sim = simOrig;
                            }
                            if (sim > bestScore && sim >= 0.5) {
                                bestMatch = r;
                                bestScore = sim;
                            }
                        }

                        console.log(`📋 Candidatos evaluados: ${candidatesChecked}`);
                        if (bestMatch) {
                            requestToUpdate = bestMatch;
                            console.log(`📋 Match encontrado (score: ${bestScore.toFixed(2)}): "${title}" → "${bestMatch.title}"`);
                        } else {
                            console.log(`📋 ⚠️ No se encontró match para: "${title}"`);
                        }
                    } else if (!title) {
                        console.log(`📋 ⚠️ No se recibió título - no se puede hacer matching`);
                    }

                    if (requestToUpdate && !['server', 'downloading', 'rejected'].includes(requestToUpdate.status)) {
                        requestToUpdate.status = 'downloading';
                        await writeRequests(requestsData);
                        console.log(`📋 Petición actualizada a "downloading": ${requestToUpdate.title}`);
                        notifyRequestUpdate(requestToUpdate);
                        return requestToUpdate;
                    }
                } catch (reqError) {
                    console.error('Error actualizando petición:', reqError.message);
                }
                return null;
            }

            // Intentar matching SIEMPRE (incluso con URL duplicada)
            console.log(`📥 Título recibido de extensión: "${title || '(sin título)'}"`);
            const updatedRequest = await matchRequestByTitle(title, requestId);

            // Si es duplicado, eliminar la entrada antigua para re-crearla
            if (isDuplicate) {
                const idx = queue.findIndex(item => item.url === url);
                if (idx !== -1) queue.splice(idx, 1);
                console.log(`📥 URL duplicada eliminada de cola para re-añadir: ${url}`);
            }

            // Usar título de la petición que hizo match si el título de OK.ru es incorrecto
            const queueTitle = updatedRequest ? updatedRequest.title
                : (title || (url.length > 50 ? url.substring(0, 50) + '...' : url));

            const queueItem = {
                url: url,
                format: 'mp4',
                status: 'pending',
                added_at: new Date().toISOString(),
                title: queueTitle,
                requestId: updatedRequest ? updatedRequest.id : null
            };

            queue.push(queueItem);
            await writeDownloadQueue(queue);
            console.log(`📥 URL añadida a cola de descargas: ${url} (título: "${queueTitle}")`);

            // Verificar si la app ya está ejecutándose
            const isRunning = await isDownloaderAppRunning();
            let appLaunched = false;
            let message = 'URL añadida a la cola de descargas';

            if (isRunning) {
                console.log('✅ App de descargas ya está abierta - la cola se actualizará automáticamente');
                message = 'URL añadida - La app actualizará la cola automáticamente';
            } else if (!isDownloaderAppRecentlyLaunched()) {
                appLaunched = launchDownloaderApp();
                if (appLaunched) {
                    message = 'URL añadida - Abriendo aplicación de descargas';
                }
            }

            res.json({
                success: true,
                message,
                queueItem,
                appLaunched,
                appWasRunning: isRunning,
                updatedRequest: updatedRequest ? { id: updatedRequest.id, title: updatedRequest.title, status: 'downloading' } : null
            });
        } catch (error) {
            console.error('Error al añadir a cola:', error);
            res.status(500).json({ error: 'Error al añadir a la cola de descargas' });
        }
    });

    // GET /api/download-queue - Ver estado de la cola
    router.get('/download-queue', async (req, res) => {
        try {
            const queue = await readDownloadQueue();
            const stats = {
                total: queue.length,
                pending: queue.filter(q => q.status === 'pending').length,
                downloading: queue.filter(q => q.status === 'downloading').length,
                completed: queue.filter(q => q.status === 'completed').length,
                error: queue.filter(q => q.status === 'error').length
            };
            res.json({ queue, stats });
        } catch (error) {
            res.status(500).json({ error: 'Error al leer la cola' });
        }
    });

    // DELETE /api/download-queue/completed - Limpiar descargas completadas
    router.delete('/download-queue/completed', async (req, res) => {
        try {
            const queue = await readDownloadQueue();
            const before = queue.length;
            const filtered = queue.filter(q => q.status !== 'completed');
            const removed = before - filtered.length;

            await writeDownloadQueue(filtered);

            // Limpiar también del estado en memoria
            for (const item of queue) {
                if (item.status === 'completed') {
                    getLastQueueState().delete(item.url);
                }
            }

            console.log(`🗑️ Cola limpiada: ${removed} descargas completadas eliminadas`);
            res.json({ success: true, removed, remaining: filtered.length });
        } catch (error) {
            console.error('Error limpiando cola:', error);
            res.status(500).json({ error: 'Error al limpiar la cola' });
        }
    });

    // DELETE /api/download-queue/all - Limpiar toda la cola
    router.delete('/download-queue/all', async (req, res) => {
        try {
            await writeDownloadQueue([]);
            getLastQueueState().clear();
            console.log('🗑️ Cola de descargas vaciada completamente');
            res.json({ success: true, message: 'Cola vaciada' });
        } catch (error) {
            res.status(500).json({ error: 'Error al vaciar la cola' });
        }
    });

    // POST /api/search-torrents - Buscar película en todotorrents.org con Tor Browser
    router.post('/search-torrents', async (req, res) => {
        try {
            const { movieTitle } = req.body;

            if (!movieTitle) {
                return res.status(400).json({ error: 'Título de película requerido' });
            }

            if (!fsSync.existsSync(TOR_BROWSER_PATH)) {
                console.log('⚠️ Tor Browser no encontrado en:', TOR_BROWSER_PATH);
                return res.status(404).json({ error: 'Tor Browser no encontrado' });
            }

            const psCmd = isWindows ? 'powershell' : 'powershell.exe';

            // Copiar título al portapapeles
            const safeTitle = movieTitle.replace(/"/g, '').replace(/'/g, '');
            const clipCmd = isWindows
                ? `echo ${safeTitle}| clip`
                : `cmd.exe /c echo ${safeTitle}| clip.exe`;

            exec(clipCmd, (error) => {
                if (error) {
                    console.log('⚠️ Error al copiar al portapapeles:', error.message);
                } else {
                    console.log(`📋 Título copiado: ${safeTitle}`);
                }
            });

            console.log(`🔍 Buscando en TodoTorrents: ${movieTitle}`);

            const torRunning = await isTorBrowserRunning();
            const now = Date.now();

            if (torRunning) {
                console.log(`🧅 Tor Browser ya está abierto. Título copiado al portapapeles.`);
            } else {
                // Protección anti-doble clic (10 segundos)
                if (now - lastTorLaunch < 10000) {
                    console.log(`⏳ Tor Browser iniciándose, espera...`);
                    return res.json({
                        success: true,
                        message: `Tor Browser ya se está iniciando, espera unos segundos...`,
                        torWasRunning: false
                    });
                }
                lastTorLaunch = now;

                console.log(`🧅 Iniciando Tor Browser...`);
                exec(`${psCmd} -Command "Start-Process -FilePath '${TOR_BROWSER_PATH_WIN}' -ArgumentList '${TODOTORRENTS_URL}'"`, (error) => {
                    if (error) console.log('⚠️ Error al abrir Tor Browser:', error.message);
                });
            }

            res.json({
                success: true,
                message: `Buscando "${movieTitle}" en TodoTorrents (automático)...`,
                torWasRunning: torRunning
            });
        } catch (error) {
            console.error('Error al buscar en TodoTorrents:', error);
            res.status(500).json({ error: 'Error al abrir Tor Browser' });
        }
    });

    return router;
};
