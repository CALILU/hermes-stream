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

            if (isDuplicate) {
                return res.status(409).json({ error: 'Esta URL ya está en la cola' });
            }

            const queueItem = {
                url: url,
                format: 'mp4',
                status: 'pending',
                added_at: new Date().toISOString(),
                title: title || (url.length > 50 ? url.substring(0, 50) + '...' : url)
            };

            queue.push(queueItem);
            await writeDownloadQueue(queue);

            console.log(`📥 URL añadida a cola de descargas: ${url}`);

            // Actualizar estado de la petición a "downloading"
            let updatedRequest = null;
            try {
                const requestsData = await readRequests();
                let requestToUpdate = null;

                if (requestId) {
                    requestToUpdate = requestsData.requests.find(r => r.id === requestId);
                }

                if (!requestToUpdate && title) {
                    const normalizedTitle = title.toLowerCase()
                        .replace(/[._-]/g, ' ')
                        .replace(/\s+/g, ' ')
                        .trim();

                    requestToUpdate = requestsData.requests.find(r => {
                        const reqTitle = (r.title || '').toLowerCase()
                            .replace(/[._-]/g, ' ')
                            .replace(/\s+/g, ' ')
                            .trim();
                        return reqTitle.includes(normalizedTitle) || normalizedTitle.includes(reqTitle);
                    });
                }

                if (requestToUpdate && requestToUpdate.status !== 'server' && requestToUpdate.status !== 'downloading') {
                    requestToUpdate.status = 'downloading';
                    await writeRequests(requestsData);
                    updatedRequest = requestToUpdate;
                    console.log(`📋 Petición actualizada a "downloading": ${requestToUpdate.title}`);
                    notifyRequestUpdate(requestToUpdate);
                }
            } catch (reqError) {
                console.error('Error actualizando petición:', reqError.message);
            }

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
