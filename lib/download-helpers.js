/**
 * lib/download-helpers.js - Cola de descargas y monitor de completadas
 *
 * Gestiona la cola de descargas y monitorea descargas completadas
 * para actualizar peticiones automaticamente.
 *
 * Adapted for Linux (NAS). Uses pgrep instead of tasklist.exe,
 * Linux paths, and graceful handling of missing executables.
 *
 * Usa SQLite via mediaDB en lugar de archivo JSON.
 *
 * Factory: recibe configuracion y dependencias, devuelve funciones de gestion.
 */

const fsSync = require('fs');
const { exec, spawn } = require('child_process');
const os = require('os');
const path = require('path');

/**
 * @param {Object} config
 * @param {Object} config.mediaDB - Instancia de db/media-db.js
 * @param {string} [config.DOWNLOADER_PROCESS_NAME] - Nombre del proceso a buscar con pgrep
 * @param {string} [config.DOWNLOADER_APP_PATH] - Ruta al ejecutable del downloader en Linux
 * @param {Function} config.calculateSimilarity - Funcion de similitud de titulos
 * @param {Object} config.requestsHelpers - { readRequests, writeRequests, notifyRequestUpdate }
 */
function createDownloadHelpers(config) {
    const {
        mediaDB,
        DOWNLOADER_PROCESS_NAME = 'YouTubeDownloader',
        DOWNLOADER_APP_PATH = path.join(os.homedir(), 'bin', 'YouTubeDownloader'),
        calculateSimilarity,
        requestsHelpers
    } = config;

    // Estado privado
    let lastQueueState = new Map();
    let downloaderAppLaunched = false;

    async function isDownloaderAppRunning() {
        return new Promise((resolve) => {
            exec(`pgrep -f "${DOWNLOADER_PROCESS_NAME}"`, (error, stdout) => {
                if (error) {
                    // pgrep returns exit code 1 when no process found - not a real error
                    resolve(false);
                    return;
                }
                const isRunning = stdout.trim().length > 0;
                console.log(`App de descargas ${isRunning ? 'esta abierta' : 'no esta abierta'}`);
                resolve(isRunning);
            });
        });
    }

    async function readDownloadQueue() {
        try {
            return mediaDB.getQueue();
        } catch (error) {
            console.error('Error leyendo cola de descargas de SQLite:', error.message);
            return [];
        }
    }

    async function writeDownloadQueue(queue) {
        try {
            // Limpiar toda la cola y re-insertar todos los items
            mediaDB.clearQueue();
            for (const item of queue) {
                mediaDB.addToQueue({
                    url: item.url,
                    title: item.title,
                    status: item.status || 'pending',
                    output_path: item.output_path || item.outputPath || null,
                    request_id: item.request_id || item.requestId || null,
                    added_at: item.added_at || item.addedAt || new Date().toISOString()
                });
            }
        } catch (error) {
            console.error('Error escribiendo cola de descargas a SQLite:', error.message);
            throw error;
        }
    }

    function launchDownloaderApp() {
        try {
            if (!fsSync.existsSync(DOWNLOADER_APP_PATH)) {
                console.log('App de descargas no encontrada en:', DOWNLOADER_APP_PATH);
                return false;
            }

            console.log('Abriendo aplicacion de descargas...');
            const child = spawn(DOWNLOADER_APP_PATH, [], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();

            downloaderAppLaunched = true;
            setTimeout(() => { downloaderAppLaunched = false; }, 5000);

            return true;
        } catch (error) {
            console.error('Error al abrir app de descargas:', error.message);
            return false;
        }
    }

    function isDownloaderAppRecentlyLaunched() {
        return downloaderAppLaunched;
    }

    function cleanDownloadTitle(title) {
        return (title || '')
            .replace(/\.f\d+.*$/, '')
            .replace(/\.fdash.*$/, '')
            .replace(/\s*\(\d{4}\)\s*$/, '')
            .trim();
    }

    async function checkCompletedDownloads() {
        try {
            const queue = await readDownloadQueue();

            for (const item of queue) {
                const prevStatus = lastQueueState.get(item.url);

                if (item.status === 'completed' && prevStatus !== 'completed') {
                    console.log(`Descarga completada detectada: ${item.title}`);

                    try {
                        const requestsData = await requestsHelpers.readRequests();
                        let bestMatch = null;
                        let bestScore = 0;

                        // 1. Match directo por requestId guardado en la cola
                        if (item.requestId || item.request_id) {
                            const reqId = item.requestId || item.request_id;
                            bestMatch = requestsData.requests.find(r => r.id === reqId);
                            if (bestMatch) {
                                bestScore = 1;
                                console.log(`   Match directo por requestId: ${reqId} -> "${bestMatch.title}"`);
                            }
                        }

                        // 2. Match por similitud de titulo
                        if (!bestMatch) {
                            const cleanedTitle = cleanDownloadTitle(item.title);

                            for (const r of requestsData.requests) {
                                if (r.status === 'server' || r.status === 'downloaded') continue;

                                // Comparar contra titulo en espanol
                                let similarity = calculateSimilarity(cleanedTitle, r.title);

                                // Comparar contra titulo original (ingles)
                                if (r.originalTitle) {
                                    const simOrig = calculateSimilarity(cleanedTitle, r.originalTitle);
                                    if (simOrig > similarity) similarity = simOrig;
                                }

                                if (similarity > bestScore && similarity >= 0.5) {
                                    bestScore = similarity;
                                    bestMatch = r;
                                }
                            }
                        }

                        if (bestMatch && !['server', 'downloaded'].includes(bestMatch.status)) {
                            bestMatch.status = 'downloaded';
                            await requestsHelpers.writeRequests(requestsData);
                            console.log(`Peticion "${bestMatch.title}" actualizada a "downloaded" (${(bestScore * 100).toFixed(0)}% coincidencia)`);
                            requestsHelpers.notifyRequestUpdate(bestMatch);
                        } else if (!bestMatch) {
                            console.log(`   No se encontro peticion coincidente para: ${item.title}`);
                        }
                    } catch (e) {
                        console.error('Error actualizando peticion tras descarga:', e.message);
                    }
                }

                lastQueueState.set(item.url, item.status);
            }
        } catch (e) {
            // Silenciar errores si la BD no está disponible
        }
    }

    // Inicializar estado de la cola (evita detectar "completed" antiguos como nuevos)
    async function initQueueState() {
        try {
            const queue = await readDownloadQueue();
            for (const item of queue) {
                lastQueueState.set(item.url, item.status);
            }
            console.log(`Monitor de descargas iniciado (${queue.length} items en cola, ${queue.filter(q => q.status === 'completed').length} completados)`);
        } catch (e) {
            console.log('Monitor de descargas completadas iniciado');
        }
    }

    // Acceso al estado para las rutas que necesitan limpiar lastQueueState
    function getLastQueueState() {
        return lastQueueState;
    }

    return {
        isDownloaderAppRunning,
        readDownloadQueue,
        writeDownloadQueue,
        launchDownloaderApp,
        isDownloaderAppRecentlyLaunched,
        cleanDownloadTitle,
        checkCompletedDownloads,
        initQueueState,
        getLastQueueState
    };
}

module.exports = { createDownloadHelpers };
