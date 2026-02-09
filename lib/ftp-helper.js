/**
 * lib/ftp-helper.js - Helper para conexiones FTP reutilizable
 * Reemplaza las 16 instanciaciones manuales de ftp.Client en server.js
 */

const ftp = require('basic-ftp');

/**
 * Crear un cliente FTP conectado y listo para usar.
 * @param {Object} ftpConfig - { host, user, password, port }
 * @param {Object} options - { timeout: ms, verbose: boolean }
 * @returns {ftp.Client}
 */
async function createFTPClient(ftpConfig, options = {}) {
    const client = new ftp.Client();
    client.ftp.verbose = options.verbose || false;
    if (options.timeout) {
        client.ftp.timeout = options.timeout;
    }
    await client.access({
        host: ftpConfig.host,
        user: ftpConfig.user,
        password: ftpConfig.password,
        port: ftpConfig.port || 21,
        secure: false,
        passive: true
    });
    return client;
}

/**
 * Ejecutar operación FTP con conexión auto-gestionada (open + close).
 * El cliente se cierra automáticamente al finalizar (éxito o error).
 *
 * @param {Object} ftpConfig - { host, user, password, port }
 * @param {Function} callback - async (client) => result
 * @param {Object} options - { timeout: ms, verbose: boolean }
 * @returns {*} resultado del callback
 *
 * @example
 * const files = await withFTPClient(FTP_CONFIG, async (client) => {
 *     return await client.list('/volume-1');
 * });
 */
async function withFTPClient(ftpConfig, callback, options = {}) {
    const client = await createFTPClient(ftpConfig, options);
    try {
        return await callback(client);
    } finally {
        client.close();
    }
}

module.exports = {
    createFTPClient,
    withFTPClient
};
