const express = require('express');
const ftp = require("basic-ftp");
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');

const app = express();
app.use(cors());

// Configuración FTP desde variables de entorno
const FTP_CONFIG = {
    host: process.env.FTP_HOST || "calilu.mooo.com",
    user: process.env.FTP_USER,
    password: process.env.FTP_PASSWORD,
    port: parseInt(process.env.FTP_PORT) || 21
};

// Verificar que FFmpeg está instalado
ffmpeg.getAvailableFormats((err, formats) => {
    if (err) {
        console.error('⚠️  FFmpeg no detectado. Instalar con: apt install ffmpeg');
    } else {
        console.log('✓ FFmpeg disponible');
    }
});

// Servir archivos estáticos del frontend (solo en producción)
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'my-ui/build')));
}

// 1. Listar archivos para la interfaz
app.get('/api/videos', async (req, res) => {
    const client = new ftp.Client();
    try {
        await client.access(FTP_CONFIG);
        const list = await client.list("/volume-2");
        const videos = list
            .filter(file => file.name.match(/\.(mp4|mkv|avi|mov)$/i))
            .map(file => ({
                title: file.name,
                size: (file.size / (1024 * 1024)).toFixed(1) + " MB",
                // La URL es relativa para que funcione tanto en desarrollo como en producción
                url: `/stream/${encodeURIComponent(file.name)}`
            }));
        res.json(videos);
    } catch (err) {
        res.status(500).json({ error: "No se pudo conectar al disco" });
    } finally {
        client.close();
    }
});

// 2. Transmisión de vídeo (Manejo de códecs al vuelo)
app.get('/stream/:filename', (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const ftpUrl = `ftp://${FTP_CONFIG.user}:${FTP_CONFIG.password}@${FTP_CONFIG.host}:${FTP_CONFIG.port}/volume-2/${filename}`;

    res.contentType('video/mp4');
    ffmpeg(ftpUrl)
        .format('mp4')
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions('-movflags frag_keyframe+empty_moov')
        .on('error', (err) => console.log('Error streaming:', err.message))
        .pipe(res, { end: true });
});

// Ruta catch-all para SPA (debe ir al final, después de las rutas de API)
if (process.env.NODE_ENV === 'production') {
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'my-ui/build', 'index.html'));
    });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 Servidor Hermes activo en puerto ${PORT}`));