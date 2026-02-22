/**
 * DLNA/UPnP Service - Descubrimiento y control de dispositivos
 * Permite enviar streams de IsiPrime a TVs compatibles con DLNA
 */

const { Client: SSDPClient } = require('node-ssdp');
const MediaRendererClient = require('upnp-mediarenderer-client');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');

const STORAGE_SETTINGS_PATH = path.join(__dirname, '..', 'storage-settings.json');

// Estado del servicio
const state = {
    devices: new Map(),       // url -> { name, url, location, lastSeen }
    activeClient: null,       // MediaRendererClient activo
    activeDevice: null,       // URL del dispositivo activo
    playbackStatus: null,     // { state, currentTime, duration, volume }
    statusInterval: null,     // Polling interval del estado
    scanInterval: null,       // Interval de re-escaneo
    serverAddress: null,      // http://IP:PORT
    mediaTokens: new Map()    // token -> { url, filename, created }
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

    // Cargar dispositivos manuales persistidos
    loadManualDevices();

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
 * Probar una URL y extraer friendlyName
 */
function probeUrl(url) {
    return new Promise((resolve) => {
        const req = http.get(url, { timeout: 3000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const nameMatch = data.match(/<friendlyName>([^<]+)<\/friendlyName>/);
                if (nameMatch) {
                    resolve({ name: nameMatch[1], url, xml: data });
                } else {
                    resolve(null);
                }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

/**
 * Comprobar si un puerto responde HTTP (cualquier status code)
 */
function checkHttpPort(ip, port) {
    return new Promise((resolve) => {
        const req = http.get(`http://${ip}:${port}/`, { timeout: 2000 }, (res) => {
            res.resume();
            resolve(true);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

/**
 * Escanear rango de puertos TCP abiertos
 */
function scanPortRange(ip, start, end) {
    return new Promise((resolve) => {
        const open = [];
        let pending = end - start + 1;
        for (let port = start; port <= end; port++) {
            const sock = new (require('net')).Socket();
            const p = port;
            sock.setTimeout(1000);
            sock.on('connect', () => { open.push(p); sock.destroy(); });
            sock.on('error', () => sock.destroy());
            sock.on('timeout', () => sock.destroy());
            sock.on('close', () => { if (--pending === 0) resolve(open.sort((a, b) => a - b)); });
            sock.connect(p, ip);
        }
    });
}

/**
 * Añadir dispositivo manual por IP
 * Fase 1: prueba puertos UPnP conocidos con XML paths
 * Fase 2: escanea rango de puertos LG y prueba XML paths
 * Fase 3: si encuentra HTTP sin XML, registra con nombre generico
 */
async function addManualDevice(ip, customName) {
    const knownPorts = [49152, 8008, 8060, 1400, 52235, 9197, 7676, 36866, 7000];
    const xmlPaths = [
        '/xml/device_description.xml',
        '/description.xml',
        '/dmr.xml',
        '/rootDesc.xml',
        '/DeviceDescription.xml',
        '/upnp/desc/aios_device/aios_device.xml',
        '/MediaRenderer/desc.xml',
        '/LGwebOSTV/rootDesc.xml',
        '/dmr/rootDesc.xml',
        '/'
    ];

    // Fase 1: Puertos conocidos con XML paths
    console.log(`📺 DLNA: Buscando dispositivo en ${ip} (puertos conocidos)...`);
    for (const port of knownPorts) {
        for (const xmlPath of xmlPaths) {
            const url = `http://${ip}:${port}${xmlPath}`;
            const result = await probeUrl(url);
            if (result) {
                return registerManualDevice(ip, port, result.url, result.name);
            }
        }
    }

    // Fase 2: Escanear rango de puertos alto (LG usa puertos dinamicos 36000-37000)
    console.log(`📺 DLNA: Escaneando puertos altos en ${ip}...`);
    const highPorts = await scanPortRange(ip, 36000, 37000);
    const extraPorts = highPorts.filter(p => !knownPorts.includes(p));

    for (const port of extraPorts) {
        for (const xmlPath of xmlPaths) {
            const url = `http://${ip}:${port}${xmlPath}`;
            const result = await probeUrl(url);
            if (result) {
                return registerManualDevice(ip, port, result.url, result.name);
            }
        }
    }

    // Fase 3: Si hay un puerto HTTP activo, registrar con nombre generico
    const allHttpPorts = [...knownPorts, ...extraPorts];
    let httpPort = null;
    for (const port of allHttpPorts) {
        if (await checkHttpPort(ip, port)) {
            httpPort = port;
            break;
        }
    }

    if (httpPort) {
        const name = customName || `TV (${ip})`;
        const url = `http://${ip}:${httpPort}/`;
        return registerManualDevice(ip, httpPort, url, name);
    }

    throw new Error(`No se encontro ningun dispositivo DLNA en ${ip}. Verifica que el TV esta encendido y soporta DLNA/UPnP.`);
}

/**
 * Registrar un dispositivo manual en el Map y persistir
 */
function registerManualDevice(ip, port, url, name) {
    const device = {
        name,
        url,
        address: ip,
        lastSeen: Date.now(),
        manual: true
    };
    state.devices.set(url, device);
    saveManualDevices();
    console.log(`📺 DLNA: Dispositivo manual añadido: ${name} (${ip}:${port})`);
    return device;
}

/**
 * Eliminar dispositivo manual por IP
 */
function removeManualDevice(ip) {
    let removed = false;
    for (const [url, device] of state.devices) {
        if (device.address === ip && device.manual) {
            state.devices.delete(url);
            removed = true;
        }
    }
    if (removed) {
        saveManualDevices();
        console.log(`📺 DLNA: Dispositivo manual eliminado: ${ip}`);
    }
    return removed;
}

/**
 * Cargar dispositivos manuales desde storage-settings.json
 */
function loadManualDevices() {
    try {
        if (!fs.existsSync(STORAGE_SETTINGS_PATH)) return;
        const settings = JSON.parse(fs.readFileSync(STORAGE_SETTINGS_PATH, 'utf8'));
        const manualDevices = settings.dlnaManualDevices || [];
        for (const d of manualDevices) {
            state.devices.set(d.url, {
                name: d.name,
                url: d.url,
                address: d.ip,
                lastSeen: Date.now(),
                manual: true
            });
        }
        if (manualDevices.length > 0) {
            console.log(`📺 DLNA: ${manualDevices.length} dispositivo(s) manual(es) cargado(s)`);
        }
    } catch (err) {
        console.error('📺 DLNA: Error cargando dispositivos manuales:', err.message);
    }
}

/**
 * Persistir dispositivos manuales a storage-settings.json
 */
function saveManualDevices() {
    try {
        let settings = {};
        if (fs.existsSync(STORAGE_SETTINGS_PATH)) {
            settings = JSON.parse(fs.readFileSync(STORAGE_SETTINGS_PATH, 'utf8'));
        }
        settings.dlnaManualDevices = [];
        for (const [url, device] of state.devices) {
            if (device.manual) {
                settings.dlnaManualDevices.push({
                    ip: device.address,
                    name: device.name,
                    url: device.url
                });
            }
        }
        fs.writeFileSync(STORAGE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf8');
    } catch (err) {
        console.error('📺 DLNA: Error guardando dispositivos manuales:', err.message);
    }
}

/**
 * Eliminar dispositivos no vistos en 2 minutos (excepto manuales)
 */
function cleanStaleDevices() {
    const twoMinutesAgo = Date.now() - 120000;
    for (const [url, device] of state.devices) {
        if (device.manual) continue;
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
        address: d.address,
        manual: !!d.manual
    }));
}

/**
 * Crear un token corto para proxy de media (evita URLs con caracteres especiales)
 */
function createMediaToken(videoUrl, filename) {
    const token = Math.random().toString(36).substring(2, 10);
    state.mediaTokens.set(token, {
        url: videoUrl,
        filename: filename,
        created: Date.now()
    });
    // Limpiar tokens viejos (>1 hora)
    for (const [t, info] of state.mediaTokens) {
        if (Date.now() - info.created > 3600000) {
            state.mediaTokens.delete(t);
        }
    }
    return token;
}

/**
 * Resolver un token de media a su URL original
 */
function resolveMediaToken(token) {
    return state.mediaTokens.get(token) || null;
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
 * Conectar a TV LG webOS via WebSocket y devolver el cliente
 */
function connectLGWebOS(ip) {
    return new Promise((resolve, reject) => {
        const lgtv = require('lgtv2');

        console.log(`📺 LG webOS: Conectando a ${ip}...`);

        const tv = lgtv({
            url: `ws://${ip}:3000`,
            timeout: 10000,
            reconnect: false
        });

        let resolved = false;

        tv.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                console.error('📺 LG webOS: Error de conexion:', err.message);
                reject(new Error(`No se pudo conectar a la TV: ${err.message}`));
            }
        });

        tv.on('prompt', () => {
            console.log('📺 LG webOS: Esperando aceptacion en la TV...');
        });

        tv.on('connect', () => {
            resolved = true;
            console.log('📺 LG webOS: Conectado!');
            resolve(tv);
        });

        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                tv.disconnect();
                reject(new Error('Timeout conectando a la TV LG. Verifica que esta encendida.'));
            }
        }, 15000);
    });
}

/**
 * Enviar request SSAP y esperar respuesta
 */
function ssapRequest(tv, uri, payload) {
    return new Promise((resolve, reject) => {
        tv.request(uri, payload, (err, data) => {
            if (err) return reject(err);
            resolve(data);
        });
    });
}

/**
 * Estrategia 1: Reproductor multimedia nativo de la TV (media.viewer)
 * Usa una URL proxy limpia sin caracteres especiales
 */
async function tryMediaViewer(tv, device, videoInfo) {
    const filename = videoInfo.filename || '';
    const ext = filename.split('.').pop().toLowerCase();
    const mediaExt = ext === 'mkv' ? 'mkv' : 'mp4';
    const mimeType = ext === 'mkv' ? 'video/x-matroska' : 'video/mp4';

    // Crear URL proxy limpia (sin espacios ni caracteres especiales)
    const token = createMediaToken(videoInfo.url, filename);
    const cleanUrl = `${state.serverAddress}/dlna/media/${token}.${mediaExt}`;
    const title = videoInfo.title || videoInfo.filename || 'IsiPrime';

    console.log(`📺 LG webOS [Estrategia 1]: media.viewer/open -> ${cleanUrl}`);

    const data = await ssapRequest(tv, 'ssap://media.viewer/open', {
        target: cleanUrl,
        title: title,
        loop: false
    });

    if (data && data.returnValue !== false) {
        console.log(`📺 LG webOS: media.viewer abierto correctamente`);
        return true;
    }

    console.log(`📺 LG webOS: media.viewer devolvio returnValue=false`);
    return false;
}

/**
 * Estrategia 2: Web Video Caster (app de terceros instalada en la TV)
 */
async function tryWebVideoCaster(tv, device, videoInfo) {
    const streamUrl = `${state.serverAddress}${videoInfo.url}`;
    const title = videoInfo.title || videoInfo.filename || 'IsiPrime';

    console.log(`📺 LG webOS [Estrategia 2]: Web Video Caster -> ${streamUrl}`);

    try {
        const data = await ssapRequest(tv, 'ssap://system.launcher/launch', {
            id: 'com.instantbits.cast.webvideo',
            params: {
                url: streamUrl,
                title: title
            }
        });

        if (data && data.returnValue !== false) {
            console.log(`📺 LG webOS: Web Video Caster abierto`);
            return true;
        }
    } catch (err) {
        console.log(`📺 LG webOS: Web Video Caster no disponible: ${err.message}`);
    }

    return false;
}

/**
 * Estrategia 3: Navegador con cast-player + fMP4 TV-Stream
 * Usa FFmpeg remux a fMP4 que es mas compatible con browsers de TV
 */
async function tryBrowserTVStream(tv, device, videoInfo) {
    const filename = videoInfo.filename || '';

    // Crear token para el tv-stream (fMP4 remux via FFmpeg)
    const token = createMediaToken(videoInfo.url, filename);
    const tvStreamUrl = `${state.serverAddress}/dlna/tv-stream/${token}.mp4`;
    const title = videoInfo.title || videoInfo.filename || 'IsiPrime';
    const playerUrl = `${state.serverAddress}/dlna/cast-player?url=${encodeURIComponent(tvStreamUrl)}&title=${encodeURIComponent(title)}`;

    console.log(`📺 LG webOS [Estrategia 3]: Navegador + TV-Stream (fMP4) -> ${playerUrl}`);

    const data = await ssapRequest(tv, 'ssap://system.launcher/launch', {
        id: 'com.webos.app.browser',
        params: { target: playerUrl }
    });

    if (data && data.returnValue !== false) {
        console.log(`📺 LG webOS: Navegador abierto con TV-Stream fMP4`);
        return true;
    }

    return false;
}

/**
 * Estrategia 4: Navegador con cast-player + proxy directo (fallback)
 * Usa el media proxy sin remux - para TVs que soportan MP4 directo
 */
async function tryBrowserDirectProxy(tv, device, videoInfo) {
    const filename = videoInfo.filename || '';
    const ext = filename.split('.').pop().toLowerCase();
    const mediaExt = ext === 'mkv' ? 'mkv' : 'mp4';

    const token = createMediaToken(videoInfo.url, filename);
    const cleanStreamUrl = `${state.serverAddress}/dlna/media/${token}.${mediaExt}`;
    const title = videoInfo.title || videoInfo.filename || 'IsiPrime';
    const playerUrl = `${state.serverAddress}/dlna/cast-player?url=${encodeURIComponent(cleanStreamUrl)}&title=${encodeURIComponent(title)}`;

    console.log(`📺 LG webOS [Estrategia 4]: Navegador + proxy directo -> ${playerUrl}`);

    const data = await ssapRequest(tv, 'ssap://system.launcher/launch', {
        id: 'com.webos.app.browser',
        params: { target: playerUrl }
    });

    if (data && data.returnValue !== false) {
        console.log(`📺 LG webOS: Navegador abierto con proxy directo`);
        return true;
    }

    return false;
}

/**
 * Reproducir video en un dispositivo LG webOS via WebSocket (lgtv2)
 * Prueba multiples estrategias en orden:
 * 1. Reproductor nativo (media.viewer/open)
 * 2. Web Video Caster
 * 3. Navegador con cast-player
 */
async function playViaLGWebOS(device, videoInfo) {
    const ip = device.address;
    const title = videoInfo.title || videoInfo.filename || '';
    const tv = await connectLGWebOS(ip);

    // Guardar referencia para poder cerrar despues
    state.lgtvClient = tv;
    state.activeDevice = device.url;

    const strategies = [
        { name: 'Navegador + TV-Stream fMP4', fn: () => tryBrowserTVStream(tv, device, videoInfo) },
        { name: 'Media Viewer nativo', fn: () => tryMediaViewer(tv, device, videoInfo) },
        { name: 'Web Video Caster', fn: () => tryWebVideoCaster(tv, device, videoInfo) },
        { name: 'Navegador + proxy directo', fn: () => tryBrowserDirectProxy(tv, device, videoInfo) }
    ];

    for (const strategy of strategies) {
        try {
            const success = await strategy.fn();
            if (success) {
                console.log(`📺 LG webOS: Reproduciendo "${title}" en ${device.name} (via ${strategy.name})`);
                state.playbackStatus = { state: 'playing', currentTime: 0, duration: 0, active: true };
                return { success: true, device: device.name, method: strategy.name };
            }
        } catch (err) {
            console.log(`📺 LG webOS: ${strategy.name} fallo: ${err.message}`);
        }
    }

    tv.disconnect();
    state.lgtvClient = null;
    state.activeDevice = null;
    throw new Error('No se pudo reproducir en la TV. Ninguna estrategia funciono.');
}

/**
 * Reproducir video en un dispositivo DLNA
 */
function play(deviceUrl, videoInfo) {
    // Buscar el dispositivo en el map
    const device = state.devices.get(deviceUrl);

    // Si es un dispositivo manual, intentar via LG webOS primero
    if (device && device.manual) {
        return playViaLGWebOS(device, videoInfo).catch((lgErr) => {
            console.log(`📺 DLNA: LG webOS fallo (${lgErr.message}), intentando DLNA clasico...`);
            return playViaDLNA(deviceUrl, videoInfo);
        });
    }

    return playViaDLNA(deviceUrl, videoInfo);
}

/**
 * Reproducir video via DLNA clasico (upnp-mediarenderer-client)
 */
function playViaDLNA(deviceUrl, videoInfo) {
    return new Promise((resolve, reject) => {
        try {
            // Detener reproduccion anterior si existe
            if (state.activeClient) {
                try { state.activeClient.stop(); } catch (e) { /* ignore */ }
                stopStatusPolling();
                state.activeClient = null;
            }

            console.log(`📺 DLNA: Conectando a ${deviceUrl}...`);
            const client = new MediaRendererClient(deviceUrl);

            // Timeout si no conecta en 10s
            const connectTimeout = setTimeout(() => {
                console.error('📺 DLNA: Timeout conectando al dispositivo');
                state.activeClient = null;
                state.activeDevice = null;
                reject(new Error('Timeout conectando al dispositivo. Verifica que el TV esta encendido y acepta DLNA.'));
            }, 10000);

            client.on('error', (err) => {
                clearTimeout(connectTimeout);
                console.error('📺 DLNA: Error de cliente:', err.message);
            });

            state.activeClient = client;
            state.activeDevice = deviceUrl;

            // Construir URL proxy simplificada para el TV
            const filename = videoInfo.filename || '';
            const ext = filename.split('.').pop().toLowerCase();
            const mimeType = ext === 'mkv' ? 'video/x-matroska' : 'video/mp4';
            const mediaExt = ext === 'mkv' ? 'mkv' : 'mp4';

            // Crear token proxy con URL limpia (sin espacios ni caracteres especiales)
            const token = createMediaToken(videoInfo.url, filename);
            const streamUrl = `${state.serverAddress}/dlna/media/${token}.${mediaExt}`;

            console.log(`📺 DLNA: Stream URL (proxy): ${streamUrl}`);
            console.log(`📺 DLNA: URL original: ${state.serverAddress}${videoInfo.url}`);
            console.log(`📺 DLNA: MIME type: ${mimeType}`);

            const metadata = buildDIDL(
                videoInfo.title || filename,
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
                clearTimeout(connectTimeout);
                if (err) {
                    state.activeClient = null;
                    state.activeDevice = null;
                    console.error('📺 DLNA: Error al cargar video:', err.message);
                    return reject(new Error(`Error al enviar video al TV: ${err.message}`));
                }

                console.log(`📺 DLNA: Reproduciendo "${videoInfo.title}" en ${getDeviceName(deviceUrl)}`);
                startStatusPolling();
                resolve({ success: true, device: getDeviceName(deviceUrl) });
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
            console.error('📺 DLNA: Error creando cliente:', err.message, err.stack);
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
        // Si hay cliente LG webOS, desconectar
        if (state.lgtvClient) {
            try { state.lgtvClient.disconnect(); } catch (e) { /* ignore */ }
            state.lgtvClient = null;
            state.activeDevice = null;
            state.playbackStatus = null;
            return resolve({ success: true });
        }
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
    addManualDevice,
    removeManualDevice,
    play,
    pause,
    resume,
    stop,
    seek,
    setVolume,
    getStatus,
    getServerAddress: () => state.serverAddress,
    resolveMediaToken,
    destroy
};
