/**
 * routes/storage.js - Rutas de configuracion de almacenamiento
 *
 * GET  /config     - Obtener configuracion actual
 * POST /mode       - Cambiar modo (solo local)
 * GET  /browse     - Explorar carpeta (solo Windows)
 * GET  /disk-usage - Espacio en disco local
 *
 * Montado en: /api/storage
 *
 * Local-only mode: no FTP, no Synology DSM, no NAS discovery.
 */

const express = require('express');
const fsSync = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const { exec } = require('child_process');
const { promisify } = require('util');
const router = express.Router();
const execAsync = promisify(exec);

// Cache de espacio en disco (5 minutos)
let diskUsageCache = null;
let diskUsageCacheTime = 0;
const DISK_CACHE_TTL = 5 * 60 * 1000;

async function getLocalDiskUsage(localPath) {
    // Intentar fs.statfs (Node 18.15+)
    try {
        if (fsPromises.statfs) {
            const stats = await fsPromises.statfs(localPath);
            const total = stats.bsize * stats.blocks;
            const free = stats.bsize * stats.bavail;
            const used = total - free;
            return { total, free, used, percentage: total > 0 ? Math.round((used / total) * 100) : 0 };
        }
    } catch (e) { /* fallback */ }

    // Fallback: df on Linux
    try {
        const { stdout } = await execAsync(`df -B1 "${localPath}" | tail -1`, { timeout: 10000 });
        const parts = stdout.trim().split(/\s+/);
        const total = parseInt(parts[1]);
        const used = parseInt(parts[2]);
        const free = parseInt(parts[3]);
        return { total, free, used, percentage: total > 0 ? Math.round((used / total) * 100) : 0 };
    } catch (e) {
        throw new Error('No se pudo obtener informacion del disco local: ' + e.message);
    }
}

module.exports = function createStorageRoutes(deps) {
    const { storageConfig, saveStorageSettings } = deps;

    // Obtener configuracion actual de almacenamiento
    router.get('/config', (req, res) => {
        res.json({
            mode: storageConfig.mode,
            localPath: storageConfig.localPath
        });
    });

    // Cambiar modo de almacenamiento (solo local soportado)
    router.post('/mode', (req, res) => {
        const { mode, localPath } = req.body;

        if (mode !== 'local') {
            return res.status(400).json({ error: 'Solo modo "local" soportado en esta instalacion' });
        }

        const pathToCheck = localPath || storageConfig.localPath;
        if (!fsSync.existsSync(pathToCheck)) {
            return res.status(400).json({ error: `La ruta local no existe: ${pathToCheck}` });
        }
        if (localPath) {
            storageConfig.localPath = localPath;
        }

        storageConfig.mode = 'local';
        diskUsageCache = null; // Invalidar cache al cambiar configuracion
        saveStorageSettings();

        console.log(`Modo almacenamiento confirmado: LOCAL (${storageConfig.localPath})`);

        res.json({
            success: true,
            mode: storageConfig.mode,
            localPath: storageConfig.localPath,
            message: 'Modo LOCAL configurado'
        });
    });

    // Explorar carpeta local (solo Windows - devuelve error en Linux)
    router.get('/browse', (req, res) => {
        if (os.platform() !== 'win32') {
            return res.status(501).json({
                success: false,
                error: 'La exploracion de carpetas con dialogo grafico solo esta disponible en Windows. En Linux, configura la ruta directamente via POST /api/storage/mode.'
            });
        }

        const psScript = `
[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null

$shell = New-Object -ComObject Shell.Application
$folder = $shell.BrowseForFolder(0, "ISIPRIME - Selecciona la carpeta con peliculas", 0x511, 17)

if ($folder -ne $null) {
    Write-Output $folder.Self.Path
}
`;

        exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
            { timeout: 120000, windowsHide: false },
            (error, stdout, stderr) => {
                const selectedPath = stdout.trim();

                if (selectedPath && fsSync.existsSync(selectedPath)) {
                    try {
                        const files = fsSync.readdirSync(selectedPath);
                        const videoFiles = files.filter(f => /\.(mp4|mkv|avi|mov)$/i.test(f));
                        console.log(`Carpeta seleccionada: ${selectedPath}`);
                        console.log(`   Videos encontrados: ${videoFiles.length}`);
                    } catch (e) {
                        console.log(`   Error leyendo carpeta: ${e.message}`);
                    }
                    res.json({ success: true, path: selectedPath });
                } else if (error && error.killed) {
                    res.json({ success: false, error: 'Timeout' });
                } else {
                    res.json({ success: false, cancelled: true });
                }
            }
        );
    });

    // Obtener espacio en disco (solo local)
    router.get('/disk-usage', async (req, res) => {
        const now = Date.now();
        const forceRefresh = req.query.refresh === 'true';

        if (!forceRefresh && diskUsageCache && now - diskUsageCacheTime < DISK_CACHE_TTL) {
            return res.json(diskUsageCache);
        }

        try {
            const result = await getLocalDiskUsage(storageConfig.localPath);

            diskUsageCache = { success: true, mode: 'local', ...result };
            diskUsageCacheTime = now;
            res.json(diskUsageCache);
        } catch (error) {
            console.error('Error obteniendo espacio en disco:', error.message);
            res.json({ success: false, error: error.message, mode: 'local' });
        }
    });

    return router;
};
