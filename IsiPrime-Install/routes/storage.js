/**
 * routes/storage.js - Rutas de configuración de almacenamiento
 *
 * GET  /config - Obtener configuración actual
 * POST /mode   - Cambiar modo (ftp/local)
 * GET  /browse - Explorar carpeta local (diálogo Windows)
 *
 * Montado en: /api/storage
 */

const express = require('express');
const fsSync = require('fs');
const { exec } = require('child_process');
const router = express.Router();

module.exports = function createStorageRoutes(deps) {
    const { storageConfig, FTP_CONFIG, saveStorageSettings } = deps;

    // Obtener configuración actual de almacenamiento
    router.get('/config', (req, res) => {
        res.json({
            mode: storageConfig.mode,
            localPath: storageConfig.localPath,
            ftpHost: FTP_CONFIG.host
        });
    });

    // Cambiar modo de almacenamiento
    router.post('/mode', (req, res) => {
        const { mode, localPath } = req.body;

        if (!mode || !['ftp', 'local'].includes(mode)) {
            return res.status(400).json({ error: 'Modo inválido. Usar "ftp" o "local"' });
        }

        if (mode === 'local') {
            const pathToCheck = localPath || storageConfig.localPath;
            if (!fsSync.existsSync(pathToCheck)) {
                return res.status(400).json({ error: `La ruta local no existe: ${pathToCheck}` });
            }
            if (localPath) {
                storageConfig.localPath = localPath;
            }
        }

        const oldMode = storageConfig.mode;
        storageConfig.mode = mode;
        saveStorageSettings();

        console.log(`🔄 Modo almacenamiento cambiado: ${oldMode.toUpperCase()} -> ${mode.toUpperCase()}`);

        res.json({
            success: true,
            mode: storageConfig.mode,
            localPath: storageConfig.localPath,
            message: `Cambiado a modo ${mode === 'ftp' ? 'RED (FTP)' : 'LOCAL'}`
        });
    });

    // Explorar carpeta local (diálogo moderno Windows 11)
    router.get('/browse', (req, res) => {
        const psScript = `
[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null

# Usar el diálogo moderno de Windows 11 con Shell.Application
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
                        console.log(`📁 Carpeta seleccionada: ${selectedPath}`);
                        console.log(`   📼 Videos encontrados: ${videoFiles.length}`);
                        if (videoFiles.length === 0) {
                            console.log(`   ⚠️  No hay archivos de video en esta carpeta`);
                            console.log(`   📂 Contenido: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
                        }
                    } catch (e) {
                        console.log(`   ⚠️  Error leyendo carpeta: ${e.message}`);
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

    return router;
};
