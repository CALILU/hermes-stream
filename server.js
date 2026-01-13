require('dotenv').config(); // Cargar variables de entorno del archivo .env

const express = require('express');
const ftp = require("basic-ftp");
const cors = require('cors');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');

const app = express();

// Configurar CORS para permitir peticiones desde el frontend
app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json()); // Middleware para parsear JSON en todas las rutas

// Middleware de logging para debug
app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path}`);
    next();
});

// Endpoint de test para verificar conectividad
app.get('/api/test', (req, res) => {
    console.log('✅ Test endpoint alcanzado');
    res.json({ success: true, message: 'Backend funcionando correctamente', timestamp: new Date().toISOString() });
});

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

// ========== FUNCIONES PARA TMDB ==========
const CACHE_FILE = path.join(__dirname, 'cache.json');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 días en milisegundos

// Leer caché
async function readCache() {
    try {
        const data = await fs.readFile(CACHE_FILE, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
}

// Escribir caché
async function writeCache(cache) {
    await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2));
}

// Verificar si la entrada del caché está expirada
function isCacheExpired(cacheEntry) {
    if (!cacheEntry || !cacheEntry.cached_at) {
        return true;
    }
    const now = Date.now();
    const cacheAge = now - cacheEntry.cached_at;
    return cacheAge > CACHE_TTL;
}

// Limpiar nombre de archivo para búsqueda
function cleanMovieName(filename) {
    // Quitar extensión
    let name = filename.replace(/\.(mp4|mkv|avi|mov)$/i, '');

    // Extraer año si existe (ej: "Película (1999)" o "1999 Película")
    const yearMatch = name.match(/\((\d{4})\)|^(\d{4})\s+/);
    const year = yearMatch ? (yearMatch[1] || yearMatch[2]) : null;

    // Quitar año del nombre
    name = name.replace(/\(?\d{4}\)?/g, '').trim();

    // Quitar caracteres especiales y números al inicio
    name = name.replace(/^[\d\s\-_.]+/, '').trim();

    return { title: name, year: year ? parseInt(year) : null };
}

// Buscar película en TMDB con timeout agresivo
async function searchTMDB(filename) {
    const { title, year } = cleanMovieName(filename);

    try {
        const searchUrl = `${TMDB_BASE_URL}/search/movie`;
        const params = {
            api_key: TMDB_API_KEY,
            query: title,
            language: 'es-ES',
            ...(year && { year })
        };

        const response = await axios.get(searchUrl, {
            params,
            timeout: 5000,  // 5 segundos timeout
            headers: {
                'Accept': 'application/json'
            }
        });

        if (response.data.results && response.data.results.length > 0) {
            const movie = response.data.results[0];
            console.log(`✅ TMDB: ${title} -> ${movie.title}`);
            return {
                tmdb_id: movie.id,
                title: movie.title,
                overview: movie.overview,
                poster_path: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
                backdrop_path: movie.backdrop_path ? `${TMDB_IMAGE_BASE}${movie.backdrop_path}` : null,
                release_date: movie.release_date,
                vote_average: movie.vote_average,
                genre_ids: movie.genre_ids || []
            };
        }

        return null;
    } catch (error) {
        console.error(`❌ TMDB timeout/error: ${title}`);
        return null;
    }
}

// Obtener metadata con caché y TTL
async function getMovieMetadata(filename) {
    const cache = await readCache();

    // Si está en caché y no ha expirado, devolverlo
    if (cache[filename] && !isCacheExpired(cache[filename])) {
        console.log(`💾 Caché válido para: ${filename}`);
        return cache[filename];
    }

    // Si no está o expiró, buscar en TMDB
    console.log(`🔍 Buscando en TMDB: ${filename}`);
    const metadata = await searchTMDB(filename);

    // Guardar en caché con timestamp
    if (metadata) {
        cache[filename] = {
            ...metadata,
            cached_at: Date.now()
        };
        await writeCache(cache);
    }

    return metadata;
}

// Servir archivos estáticos del frontend (solo en producción)
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'my-ui/build')));
}

// 1. Listar archivos para la interfaz
app.get('/api/videos', async (req, res) => {
    const client = new ftp.Client();
    client.ftp.timeout = 10000; // Timeout de 10 segundos
    try {
        await client.access(FTP_CONFIG);
        const list = await client.list("/volume-1");
        const videoFiles = list.filter(file => file.name.match(/\.(mp4|mkv|avi|mov)$/i));

        // Obtener metadatos de TMDB en paralelo
        const videosWithMetadata = await Promise.all(
            videoFiles.map(async (file, index) => {
                const metadata = await getMovieMetadata(file.name);

                // Si no hay genre_ids, asignar algunos aleatorios para testing
                let genreIds = metadata?.genre_ids || [];
                if (genreIds.length === 0) {
                    // Asignar 1-3 géneros aleatorios basados en el índice
                    const allGenres = [28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 53];
                    const numGenres = 1 + (index % 3);
                    for (let i = 0; i < numGenres; i++) {
                        genreIds.push(allGenres[(index + i * 7) % allGenres.length]);
                    }
                }

                // Si no hay poster, usar SVG generado dinámicamente
                let posterUrl = metadata?.poster_path || null;
                let backdropUrl = metadata?.backdrop_path || null;

                if (!posterUrl && genreIds.length > 0) {
                    // Colores por género para placeholders
                    const genreColors = {
                        28: '#8B0000',   // Acción - Rojo oscuro
                        12: '#FF8C00',   // Aventura - Naranja
                        16: '#FF1493',   // Animación - Rosa
                        35: '#FFD700',   // Comedia - Dorado
                        80: '#2F4F4F',   // Crimen - Gris oscuro
                        99: '#8B4513',   // Documental - Marrón
                        18: '#4169E1',   // Drama - Azul
                        10751: '#32CD32', // Familia - Verde claro
                        14: '#9370DB',   // Fantasía - Púrpura
                        36: '#D2691E',   // Historia - Chocolate
                        27: '#000000',   // Terror - Negro
                        10402: '#FF69B4', // Música - Rosa fuerte
                        9648: '#191970', // Misterio - Azul oscuro
                        10749: '#DC143C', // Romance - Carmesí
                        878: '#00CED1',  // Ciencia ficción - Cian
                        53: '#B22222',   // Suspense - Rojo ladrillo
                        10752: '#556B2F', // Bélica - Verde oliva
                        37: '#A0522D'    // Western - Sienna
                    };

                    const color = genreColors[genreIds[0]] || '#808080';
                    const title = file.name.replace(/\.(mp4|mkv|avi|mov)$/i, '').substring(0, 25);
                    const encodedTitle = title.replace(/[<>&'"]/g, '');

                    // Generar SVG como Data URL para poster (500x750)
                    const posterSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="500" height="750">
                        <rect width="500" height="750" fill="${color}"/>
                        <text x="250" y="375" font-family="Arial" font-size="24" fill="white" text-anchor="middle">
                            ${encodedTitle}
                        </text>
                    </svg>`;
                    posterUrl = `data:image/svg+xml;base64,${Buffer.from(posterSvg).toString('base64')}`;

                    // Generar SVG para backdrop (1280x720)
                    const backdropSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
                        <rect width="1280" height="720" fill="${color}"/>
                        <text x="640" y="360" font-family="Arial" font-size="32" fill="white" text-anchor="middle">
                            ${encodedTitle}
                        </text>
                    </svg>`;
                    backdropUrl = `data:image/svg+xml;base64,${Buffer.from(backdropSvg).toString('base64')}`;
                }

                return {
                    filename: file.name,
                    title: metadata?.title || file.name.replace(/\.(mp4|mkv|avi|mov)$/i, ''),
                    size: (file.size / (1024 * 1024)).toFixed(1) + " MB",
                    url: `http://localhost:${PORT}/stream/${encodeURIComponent(file.name)}`,
                    poster: posterUrl,
                    backdrop: backdropUrl,
                    overview: metadata?.overview || `Película: ${file.name.replace(/\.(mp4|mkv|avi|mov)$/i, '')}`,
                    releaseDate: metadata?.release_date || null,
                    rating: metadata?.vote_average || null,
                    genreIds: genreIds
                };
            })
        );

        res.json(videosWithMetadata);
    } catch (err) {
        console.error('Error al listar videos:', err);
        res.status(500).json({ error: "No se pudo conectar al disco" });
    } finally {
        client.close();
    }
});

// 1.5 Obtener lista de géneros de TMDB
app.get('/api/genres', async (req, res) => {
    // Lista fija de géneros de TMDB (evita problemas de conectividad)
    const genres = [
        { id: 28, name: 'Acción' },
        { id: 12, name: 'Aventura' },
        { id: 16, name: 'Animación' },
        { id: 35, name: 'Comedia' },
        { id: 80, name: 'Crimen' },
        { id: 99, name: 'Documental' },
        { id: 18, name: 'Drama' },
        { id: 10751, name: 'Familia' },
        { id: 14, name: 'Fantasía' },
        { id: 36, name: 'Historia' },
        { id: 27, name: 'Terror' },
        { id: 10402, name: 'Música' },
        { id: 9648, name: 'Misterio' },
        { id: 10749, name: 'Romance' },
        { id: 878, name: 'Ciencia ficción' },
        { id: 10770, name: 'Película de TV' },
        { id: 53, name: 'Suspense' },
        { id: 10752, name: 'Bélica' },
        { id: 37, name: 'Western' }
    ];

    console.log('📚 Géneros cargados localmente:', genres.length);
    res.json(genres);
});

// 1.75 Enriquecer películas con metadata de TMDB (Backend como proxy)
app.post('/api/movies/enrich', async (req, res) => {
    try {
        const { filenames } = req.body;

        if (!Array.isArray(filenames) || filenames.length === 0) {
            return res.status(400).json({ error: 'Se requiere un array de filenames' });
        }

        console.log(`🎬 Enriqueciendo ${filenames.length} películas desde backend...`);

        const results = [];

        // Procesar de forma secuencial para respetar rate limiting de TMDB
        for (const filename of filenames) {
            try {
                const metadata = await getMovieMetadata(filename);

                if (metadata) {
                    results.push({
                        filename,
                        success: true,
                        metadata: {
                            poster: metadata.poster_path,
                            backdrop: metadata.backdrop_path,
                            overview: metadata.overview,
                            rating: metadata.vote_average,
                            releaseDate: metadata.release_date,
                            title: metadata.title,
                            genreIds: metadata.genre_ids || []
                        }
                    });
                } else {
                    results.push({
                        filename,
                        success: false,
                        error: 'No se encontró en TMDB'
                    });
                }

                // Esperar 350ms entre peticiones para respetar rate limit
                await new Promise(resolve => setTimeout(resolve, 350));

            } catch (error) {
                console.error(`❌ Error procesando ${filename}:`, error.message);
                results.push({
                    filename,
                    success: false,
                    error: error.message
                });
            }
        }

        console.log(`✅ Enriquecimiento completado: ${results.filter(r => r.success).length}/${filenames.length} exitosos`);
        res.json({ success: true, results });

    } catch (error) {
        console.error('Error en /api/movies/enrich:', error);
        res.status(500).json({ error: 'Error al enriquecer películas' });
    }
});

// 2. Transmisión de vídeo (Manejo de códecs al vuelo)
app.get('/stream/:filename', (req, res) => {
    const filename = decodeURIComponent(req.params.filename);
    const ftpUrl = `ftp://${FTP_CONFIG.user}:${FTP_CONFIG.password}@${FTP_CONFIG.host}:${FTP_CONFIG.port}/volume-1/${filename}`;

    console.log('🎬 Iniciando streaming de:', filename);
    console.log('📡 URL FTP:', ftpUrl.replace(FTP_CONFIG.password, '***'));

    res.contentType('video/mp4');
    ffmpeg(ftpUrl)
        .format('mp4')
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions('-movflags frag_keyframe+empty_moov')
        .on('start', (cmd) => console.log('✓ FFmpeg iniciado:', cmd.substring(0, 100) + '...'))
        .on('error', (err) => {
            console.error('❌ Error streaming:', err.message);
            if (!res.headersSent) {
                res.status(500).send('Error al transmitir video');
            }
        })
        .on('end', () => console.log('✓ Streaming completado'))
        .pipe(res, { end: true });
});

// 3. Endpoint para actualizar/limpiar caché de metadatos
app.post('/api/sync-metadata', async (req, res) => {
    try {
        console.log('🔄 Limpiando todo el caché de TMDB...');
        const cache = {};
        await writeCache(cache);
        res.json({ success: true, message: 'Caché limpiado. Los metadatos se volverán a buscar en la próxima carga.' });
    } catch (error) {
        console.error('Error al limpiar caché:', error);
        res.status(500).json({ error: 'Error al limpiar caché' });
    }
});

// 4. Endpoint para actualizar una película específica
app.delete('/api/cache/:filename', async (req, res) => {
    try {
        const filename = decodeURIComponent(req.params.filename);
        const cache = await readCache();

        if (cache[filename]) {
            delete cache[filename];
            await writeCache(cache);
            console.log(`🗑️ Eliminado del caché: ${filename}`);
            res.json({ success: true, message: `Caché de "${filename}" eliminado. Se buscará de nuevo en TMDB.` });
        } else {
            res.json({ success: false, message: `"${filename}" no está en caché.` });
        }
    } catch (error) {
        console.error('Error al eliminar del caché:', error);
        res.status(500).json({ error: 'Error al eliminar del caché' });
    }
});

// 5. Endpoint para renombrar archivo y actualizar metadatos
app.put('/api/rename', async (req, res) => {
    console.log('🎯 Petición PUT /api/rename recibida');
    console.log('📦 Body:', req.body);

    const { oldName, newName } = req.body;

    if (!oldName || !newName) {
        console.log('❌ Faltan parámetros');
        return res.status(400).json({ error: 'Se requieren oldName y newName' });
    }

    const client = new ftp.Client();
    try {
        console.log(`📝 Renombrando: "${oldName}" → "${newName}"`);

        // Conectar al FTP
        await client.access(FTP_CONFIG);

        // Renombrar archivo en el FTP
        await client.rename(`/volume-1/${oldName}`, `/volume-1/${newName}`);
        console.log('✓ Archivo renombrado en el FTP');

        // Limpiar caché de la entrada antigua
        const cache = await readCache();
        if (cache[oldName]) {
            delete cache[oldName];
            await writeCache(cache);
            console.log('✓ Caché antiguo eliminado');
        }

        // Buscar nuevos metadatos en TMDB
        const metadata = await getMovieMetadata(newName);
        console.log('✓ Nuevos metadatos obtenidos de TMDB');

        // Devolver información actualizada
        const updatedVideo = {
            filename: newName,
            title: metadata?.title || newName.replace(/\.(mp4|mkv|avi|mov)$/i, ''),
            url: `http://localhost:${PORT}/stream/${encodeURIComponent(newName)}`,
            poster: metadata?.poster_path || null,
            backdrop: metadata?.backdrop_path || null,
            overview: metadata?.overview || null,
            releaseDate: metadata?.release_date || null,
            rating: metadata?.vote_average || null
        };

        res.json({
            success: true,
            message: `Archivo renombrado y metadatos actualizados`,
            video: updatedVideo
        });

    } catch (error) {
        console.error('❌ Error al renombrar:', error.message);
        res.status(500).json({ error: `Error al renombrar: ${error.message}` });
    } finally {
        client.close();
    }
});

// Ruta catch-all para SPA (debe ir al final, después de las rutas de API)
if (process.env.NODE_ENV === 'production') {
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'my-ui/build', 'index.html'));
    });
}

const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0'; // Escuchar en todas las interfaces (IPv4 + IPv6)

app.listen(PORT, HOST, () => {
    console.log(`🚀 Servidor Hermes activo en puerto ${PORT}`);
    console.log(`📍 Escuchando en http://localhost:${PORT}`);
});