/**
 * lib/requests-helpers.js - Lectura/escritura de peticiones de peliculas
 *
 * SQLite-only mode (no FTP).
 *
 * Factory: recibe configuracion y dependencias, devuelve funciones de gestion.
 */

/**
 * @param {Object} config
 * @param {Object} config.storageConfig - Configuracion de almacenamiento (por referencia, mutable)
 * @param {Object} config.requestsDB - Modulo SQLite de peticiones
 * @param {Set} config.requestsSSEClients - Set de clientes SSE (por referencia)
 */
function createRequestsHelpers(config) {
    const { requestsDB, requestsSSEClients } = config;

    // Leer peticiones desde SQLite
    async function readRequests() {
        const requests = requestsDB.getAll();
        return { requests, nextId: null };
    }

    // Escribir peticiones - SQLite maneja escrituras internamente
    async function writeRequests(data) {
        console.log('Cambios guardados en SQLite');
    }

    // Notificar a todos los clientes SSE
    function notifyRequestUpdate(request) {
        const data = JSON.stringify({ type: 'update', request });
        requestsSSEClients.forEach(client => {
            client.write(`data: ${data}\n\n`);
        });
    }

    return {
        readRequests,
        writeRequests,
        notifyRequestUpdate
    };
}

module.exports = { createRequestsHelpers };
