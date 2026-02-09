/**
 * lib/download-helpers.js - Cola de descargas y monitor de completadas
 *
 * Gestiona la cola de descargas del YouTubeDownloader y monitorea
 * descargas completadas para actualizar peticiones automáticamente.
 *
 * Factory: recibe configuración y dependencias, devuelve funciones de gestión.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const { exec, spawn } = require('child_process');
const os = require('os');

/**
 * @param {Object} config
 * @param {string} [config.DOWNLOAD_QUEUE_FILE] - Ruta al archivo de cola (default: ~/.youtube_downloader_queue.json)
 * @param {string} [config.DOWNLOADER_APP_PATH_WIN] - Ruta Windows al EXE
 * @param {string} [config.DOWNLOADER_APP_PATH_WSL] - Ruta WSL al EXE
 * @param {Function} config.calculateSimilarity - Función de similitud de títulos
 * @param {Object} config.requestsHelpers - { readRequests, writeRequests, notifyRequestUpdate }
 */
function createDownloadHelpers(config) {
    const {
        DOWNLOAD_QUEUE_FILE = require('path').join(os.homedir(), '.youtube_downloader_queue.json'),
        DOWNLOADER_APP_PATH_WIN = 'F:\\Utiles de python para videos\\descarga_youtube\\dist\\YouTubeDownloader.exe',
        DOWNLOADER_APP_PATH_WSL = '/mnt/f/Utiles de python para videos/descarga_youtube/dist/YouTubeDownloader.exe',
        calculateSimilarity,
        requestsHelpers
    } = config;

    // Estado privado
    let lastQueueState = new Map();
    let downloaderAppLaunched = false;

    async function isDownloaderAppRunning() {
        return new Promise((resolve) => {
            exec('tasklist.exe /FI "IMAGENAME eq YouTubeDownloader.exe" /NH', (error, stdout) => {
                if (error) {
                    console.log('⚠️ Error verificando proceso:', error.message);
                    resolve(false);
                    return;
                }
                const isRunning = stdout.toLowerCase().includes('youtubedownloader');
                console.log(`🔍 App de descargas ${isRunning ? 'está abierta' : 'no está abierta'}`);
                resolve(isRunning);
            });
        });
    }

    async function readDownloadQueue() {
        try {
            const data = await fs.readFile(DOWNLOAD_QUEUE_FILE, 'utf8');
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    async function writeDownloadQueue(queue) {
        await fs.writeFile(DOWNLOAD_QUEUE_FILE, JSON.stringify(queue, null, 2));
    }

    function launchDownloaderApp() {
        try {
            if (!fsSync.existsSync(DOWNLOADER_APP_PATH_WSL)) {
                console.log('⚠️ App de descargas no encontrada en:', DOWNLOADER_APP_PATH_WSL);
                return false;
            }

            console.log('🚀 Abriendo aplicación de descargas...');
            const child = spawn('cmd.exe', ['/c', 'start', '""', `"${DOWNLOADER_APP_PATH_WIN}"`], {
                detached: true,
                stdio: 'ignore',
                shell: true
            });
            child.unref();

            downloaderAppLaunched = true;
            setTimeout(() => { downloaderAppLaunched = false; }, 5000);

            return true;
        } catch (error) {
            console.error('Error al abrir app de descargas:', error);
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
                    console.log(`✅ Descarga completada detectada: ${item.title}`);

                    try {
                        const requestsData = await requestsHelpers.readRequests();
                        const cleanedTitle = cleanDownloadTitle(item.title);

                        let bestMatch = null;
                        let bestScore = 0;

                        for (const r of requestsData.requests) {
                            if (r.status === 'server' || r.status === 'downloaded') continue;

                            const similarity = calculateSimilarity(cleanedTitle, r.title);
                            console.log(`   📊 Comparando "${cleanedTitle}" vs "${r.title}": ${(similarity * 100).toFixed(0)}%`);

                            if (similarity > bestScore && similarity >= 0.5) {
                                bestScore = similarity;
                                bestMatch = r;
                            }
                        }

                        if (bestMatch) {
                            bestMatch.status = 'downloaded';
                            await requestsHelpers.writeRequests(requestsData);
                            console.log(`📋 Petición "${bestMatch.title}" actualizada a "downloaded" (${(bestScore * 100).toFixed(0)}% coincidencia)`);
                            requestsHelpers.notifyRequestUpdate(bestMatch);
                        } else {
                            console.log(`   ⚠️ No se encontró petición coincidente para: ${cleanedTitle}`);
                        }
                    } catch (e) {
                        console.error('Error actualizando petición tras descarga:', e.message);
                    }
                }

                lastQueueState.set(item.url, item.status);
            }
        } catch (e) {
            // Silenciar errores si el archivo no existe
        }
    }

    // Inicializar estado de la cola (evita detectar "completed" antiguos como nuevos)
    async function initQueueState() {
        try {
            const queue = await readDownloadQueue();
            for (const item of queue) {
                lastQueueState.set(item.url, item.status);
            }
            console.log(`👀 Monitor de descargas iniciado (${queue.length} items en cola, ${queue.filter(q => q.status === 'completed').length} completados)`);
        } catch (e) {
            console.log('👀 Monitor de descargas completadas iniciado');
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
