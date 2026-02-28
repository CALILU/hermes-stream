/**
 * lib/requests-helpers.js - Lectura/escritura de peticiones de películas
 *
 * Soporta dos modos:
 * - LOCAL: SQLite (requestsDB)
 * - FTP: archivo JSON en servidor FTP
 *
 * Factory: recibe configuración y dependencias, devuelve funciones de gestión.
 */

const { Readable, Writable } = require('stream');

const FTP_REQUESTS_PATH = '/volume-1/movie-requests.json';
const REQUESTS_CACHE_TTL = 30000; // 30 segundos de cache

/**
 * @param {Object} config
 * @param {Object} config.storageConfig - Configuración de almacenamiento (por referencia, mutable)
 * @param {Object} config.FTP_CONFIG - Configuración FTP
 * @param {Object} config.requestsDB - Módulo SQLite de peticiones
 * @param {Set} config.requestsSSEClients - Set de clientes SSE (por referencia)
 * @param {Function} config.withFTPClient - Helper FTP auto-gestionado
 */
function createRequestsHelpers(config) {
    const { storageConfig, FTP_CONFIG, requestsDB, requestsSSEClients, withFTPClient } = config;

    // Estado privado para caché FTP
    let requestsCache = null;
    let requestsCacheTime = 0;

    // Leer peticiones (LOCAL: SQLite, FTP: servidor FTP)
    async function readRequests() {
        // ========== MODO LOCAL: leer desde SQLite ==========
        if (storageConfig.mode === 'local') {
            const requests = requestsDB.getAll();
            return { requests, nextId: null };
        }

        // Usar cache si es reciente (solo para FTP)
        if (requestsCache && (Date.now() - requestsCacheTime) < REQUESTS_CACHE_TTL) {
            return requestsCache;
        }

        // ========== MODO FTP: leer desde servidor FTP ==========
        try {
            const result = await withFTPClient(FTP_CONFIG, async (client) => {
                const chunks = [];
                const writable = new Writable({
                    write(chunk, encoding, callback) {
                        chunks.push(chunk);
                        callback();
                    }
                });

                await client.downloadTo(writable, FTP_REQUESTS_PATH);
                const content = Buffer.concat(chunks).toString('utf8');
                return JSON.parse(content);
            });

            requestsCache = result;
            requestsCacheTime = Date.now();
            console.log(`📋 Peticiones cargadas desde FTP: ${requestsCache.requests?.length || 0}`);
            return requestsCache;
        } catch (error) {
            console.log('📋 Archivo de peticiones no existe en FTP:', error.message);
            return { requests: [], nextId: 1 };
        }
    }

    // Escribir peticiones (LOCAL: SQLite - no hace nada, FTP: servidor FTP)
    async function writeRequests(data) {
        // ========== MODO LOCAL: SQLite maneja escrituras internamente ==========
        if (storageConfig.mode === 'local') {
            console.log('📋 Cambios guardados en SQLite');
            return;
        }

        // Actualizar cache local (solo para FTP)
        requestsCache = data;
        requestsCacheTime = Date.now();

        // ========== MODO FTP: escribir en servidor FTP ==========
        try {
            await withFTPClient(FTP_CONFIG, async (client) => {
                // Primero borrar el archivo existente
                try {
                    await client.remove(FTP_REQUESTS_PATH);
                } catch (e) {
                    // Ignorar si no existe
                }

                const content = JSON.stringify(data, null, 2);
                const readable = Readable.from([content]);
                await client.uploadFrom(readable, FTP_REQUESTS_PATH);
            });
            console.log('📋 Peticiones guardadas en FTP');
        } catch (error) {
            console.error('❌ Error guardando peticiones en FTP:', error.message);
        }
    }

    // Notificar a todos los clientes SSE
    function notifyRequestUpdate(request) {
        const data = JSON.stringify({ type: 'update', request });
        requestsSSEClients.forEach(client => {
            client.write(`data: ${data}\n\n`);
        });
    }

    // Invalidar cache (útil cuando se sabe que los datos cambiaron externamente)
    function invalidateCache() {
        requestsCache = null;
        requestsCacheTime = 0;
    }

    return {
        readRequests,
        writeRequests,
        notifyRequestUpdate,
        invalidateCache
    };
}

module.exports = { createRequestsHelpers };
