/**
 * DLNA/UPnP Service - Descubrimiento y control de dispositivos
 * Permite enviar streams de IsiPrime a TVs compatibles con DLNA
 */

const { Client: SSDPClient } = require('node-ssdp');
const MediaRendererClient = require('upnp-mediarenderer-client');
const os = require('os');

// Estado del servicio
const state = {
    devices: new Map(),       // url -> { name, url, location, lastSeen }
    activeClient: null,       // MediaRendererClient activo
    activeDevice: null,       // URL del dispositivo activo
    playbackStatus: null,     // { state, currentTime, duration, volume }
    statusInterval: null,     // Polling interval del estado
    scanInterval: null,       // Interval de re-escaneo
    serverAddress: null       // http://IP:PORT
};

/**
 * Detectar IP local del servidor en la LAN
 */
function detectServerIP(port) {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                if (/^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(iface.address)) {
                    return `http://${iface.address}:${port}`;
                }
            }
        }
    }
    return `http://127.0.0.1:${port}`;
}

/**
 * Iniciar el servicio DLNA
 */
function init(port) {
    state.serverAddress = detectServerIP(port);
    console.log(`📺 DLNA: Servidor accesible en ${state.serverAddress}`);

    // Escaneo inicial
    scanDevices();

    // Re-escaneo periodico cada 30 segundos
    state.scanInterval = setInterval(() => {
        cleanStaleDevices();
        scanDevices();
    }, 30000);
}

/**
 * Escanear dispositivos DLNA MediaRenderer en la red
 */
function scanDevices() {
    return new Promise((resolve) => {
        try {
            const client = new SSDPClient();

            client.on('response', (headers, statusCode, rinfo) => {
                if (statusCode !== 200) return;
                const location = headers.LOCATION || headers.location;
                if (!location) return;

                // Obtener nombre del dispositivo via descripcion XML
                fetchDeviceName(location).then(name => {
                    const device = {
                        name: name || `Dispositivo (${rinfo.address})`,
                        url: location,
                        address: rinfo.address,
                        lastSeen: Date.now()
                    };
                    state.devices.set(location, device);
                }).catch(() => {
                    // Si falla, registrar con IP como nombre
                    state.devices.set(location, {
                        name: `TV (${rinfo.address})`,
                        url: location,
                        address: rinfo.address,
                        lastSeen: Date.now()
                    });
                });
            });

            // Buscar MediaRenderers
            client.search('urn:schemas-upnp-org:device:MediaRenderer:1');

            // Cerrar despues de 5 segundos
            setTimeout(() => {
                try { client.stop(); } catch (e) { /* ignore */ }
                resolve(getDevices());
            }, 5000);
        } catch (err) {
            console.error('📺 DLNA: Error en scan:', err.message);
            resolve(getDevices());
        }
    });
}

/**
 * Obtener nombre del dispositivo desde su descripcion XML
 */
async function fetchDeviceName(location) {
    const http = require('http');
    const https = require('https');

    return new Promise((resolve, reject) => {
        const client = location.startsWith('https') ? https : http;
        const req = client.get(location, { timeout: 3000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const nameMatch = data.match(/<friendlyName>([^<]+)<\/friendlyName>/);
                resolve(nameMatch ? nameMatch[1] : null);
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

/**
 * Eliminar dispositivos no vistos en 2 minutos
 */
function cleanStaleDevices() {
    const twoMinutesAgo = Date.now() - 120000;
    for (const [url, device] of state.devices) {
        if (device.lastSeen < twoMinutesAgo) {
            state.devices.delete(url);
        }
    }
}

/**
 * Obtener lista de dispositivos descubiertos
 */
function getDevices() {
    return Array.from(state.devices.values()).map(d => ({
        name: d.name,
        url: d.url,
        address: d.address
    }));
}

/**
 * Generar metadatos DIDL-Lite para el renderer
 */
function buildDIDL(title, streamUrl, mimeType, posterUrl) {
    const escapedTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const albumArt = posterUrl
        ? `<upnp:albumArtURI>${posterUrl.replace(/&/g, '&amp;')}</upnp:albumArtURI>`
        : '';

    return `<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"
        xmlns:dc="http://purl.org/dc/elements/1.1/"
        xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">
        <item id="1" parentID="0" restricted="1">
            <dc:title>${escapedTitle}</dc:title>
            <upnp:class>object.item.videoItem.movie</upnp:class>
            ${albumArt}
            <res protocolInfo="http-get:*:${mimeType}:DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000">${streamUrl.replace(/&/g, '&amp;')}</res>
        </item>
    </DIDL-Lite>`;
}

/**
 * Reproducir video en un dispositivo DLNA
 */
function play(deviceUrl, videoInfo) {
    return new Promise((resolve, reject) => {
        try {
            // Detener reproduccion anterior si existe
            if (state.activeClient) {
                try { state.activeClient.stop(); } catch (e) { /* ignore */ }
                stopStatusPolling();
            }

            const client = new MediaRendererClient(deviceUrl);
            state.activeClient = client;
            state.activeDevice = deviceUrl;

            // Construir URL absoluta del stream
            const ext = videoInfo.filename.split('.').pop().toLowerCase();
            const mimeType = ext === 'mkv' ? 'video/x-matroska' : 'video/mp4';
            const streamUrl = `${state.serverAddress}${videoInfo.url}`;

            const metadata = buildDIDL(
                videoInfo.title || videoInfo.filename,
                streamUrl,
                mimeType,
                videoInfo.poster || ''
            );

            const options = {
                autoplay: true,
                contentType: mimeType,
                metadata: metadata
            };

            client.load(streamUrl, options, (err) => {
                if (err) {
                    state.activeClient = null;
                    state.activeDevice = null;
                    console.error('📺 DLNA: Error al reproducir:', err.message);
                    return reject(err);
                }

                console.log(`📺 DLNA: Reproduciendo "${videoInfo.title}" en ${getDeviceName(deviceUrl)}`);
                startStatusPolling();
                resolve({ success: true, device: getDeviceName(deviceUrl) });
            });

            client.on('status', (status) => {
                // Evento emitido por el renderer
            });

            client.on('loading', () => {
                state.playbackStatus = { ...state.playbackStatus, state: 'loading' };
            });

            client.on('playing', () => {
                state.playbackStatus = { ...state.playbackStatus, state: 'playing' };
            });

            client.on('paused', () => {
                state.playbackStatus = { ...state.playbackStatus, state: 'paused' };
            });

            client.on('stopped', () => {
                state.playbackStatus = { ...state.playbackStatus, state: 'stopped' };
                stopStatusPolling();
            });

        } catch (err) {
            console.error('📺 DLNA: Error creando cliente:', err.message);
            reject(err);
        }
    });
}

/**
 * Pausar reproduccion
 */
function pause() {
    return new Promise((resolve, reject) => {
        if (!state.activeClient) return reject(new Error('No hay reproduccion activa'));
        state.activeClient.pause((err) => {
            if (err) return reject(err);
            resolve({ success: true });
        });
    });
}

/**
 * Reanudar reproduccion
 */
function resume() {
    return new Promise((resolve, reject) => {
        if (!state.activeClient) return reject(new Error('No hay reproduccion activa'));
        state.activeClient.play((err) => {
            if (err) return reject(err);
            resolve({ success: true });
        });
    });
}

/**
 * Detener reproduccion
 */
function stop() {
    return new Promise((resolve, reject) => {
        if (!state.activeClient) return reject(new Error('No hay reproduccion activa'));
        state.activeClient.stop((err) => {
            stopStatusPolling();
            state.activeClient = null;
            state.activeDevice = null;
            state.playbackStatus = null;
            if (err) return reject(err);
            resolve({ success: true });
        });
    });
}

/**
 * Saltar a posicion (en segundos)
 */
function seek(seconds) {
    return new Promise((resolve, reject) => {
        if (!state.activeClient) return reject(new Error('No hay reproduccion activa'));
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        const target = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

        state.activeClient.seek(target, (err) => {
            if (err) return reject(err);
            resolve({ success: true });
        });
    });
}

/**
 * Cambiar volumen (0-100)
 */
function setVolume(level) {
    return new Promise((resolve, reject) => {
        if (!state.activeClient) return reject(new Error('No hay reproduccion activa'));
        state.activeClient.setVolume(level, (err) => {
            if (err) return reject(err);
            resolve({ success: true });
        });
    });
}

/**
 * Obtener estado actual
 */
function getStatus() {
    return {
        active: !!state.activeClient,
        device: state.activeDevice ? getDeviceName(state.activeDevice) : null,
        deviceUrl: state.activeDevice,
        ...(state.playbackStatus || { state: 'idle' }),
        serverAddress: state.serverAddress
    };
}

/**
 * Polling de posicion/duracion del renderer
 */
function startStatusPolling() {
    stopStatusPolling();
    state.statusInterval = setInterval(() => {
        if (!state.activeClient) return;
        try {
            state.activeClient.getPosition((err, position) => {
                if (err) return;
                // position es un objeto con Track, RelTime, AbsTime
                const currentTime = parseTimeToSeconds(position.RelTime || '0:00:00');
                state.playbackStatus = {
                    ...state.playbackStatus,
                    currentTime
                };
            });
            state.activeClient.getDuration((err, duration) => {
                if (err) return;
                const totalTime = parseTimeToSeconds(duration.TrackDuration || '0:00:00');
                state.playbackStatus = {
                    ...state.playbackStatus,
                    duration: totalTime
                };
            });
        } catch (e) { /* ignore polling errors */ }
    }, 2000);
}

function stopStatusPolling() {
    if (state.statusInterval) {
        clearInterval(state.statusInterval);
        state.statusInterval = null;
    }
}

/**
 * Parsear tiempo HH:MM:SS a segundos
 */
function parseTimeToSeconds(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
}

/**
 * Obtener nombre de un dispositivo por URL
 */
function getDeviceName(url) {
    const device = state.devices.get(url);
    return device ? device.name : 'Desconocido';
}

/**
 * Limpiar al cerrar servidor
 */
function destroy() {
    stopStatusPolling();
    if (state.scanInterval) clearInterval(state.scanInterval);
    if (state.activeClient) {
        try { state.activeClient.stop(); } catch (e) { /* ignore */ }
    }
}

module.exports = {
    init,
    scanDevices,
    getDevices,
    play,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    getStatus,
    getServerAddress: () => state.serverAddress,
    destroy
};
