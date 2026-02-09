/**
 * Script para regenerar el cache completo de películas
 * Busca metadatos en TMDB para todas las películas en el disco
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w342';
const CACHE_FILE = path.join(__dirname, 'cache.json');
const STORAGE_FILE = path.join(__dirname, 'storage-settings.json');

// Cargar configuración de almacenamiento
function getLocalPath() {
    try {
        const data = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
        return data.localPath || 'E:\\';
    } catch (e) {
        return 'E:\\';
    }
}

// Limpiar nombre de archivo para búsqueda
function cleanFilename(filename) {
    let name = filename
        .replace(/\.(mp4|mkv|avi|mov)$/i, '')
        .replace(/\(\d{4}\)/, (match) => match) // Mantener año
        .replace(/[\._-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Extraer año si existe
    const yearMatch = name.match(/\((\d{4})\)/);
    const year = yearMatch ? yearMatch[1] : null;
    name = name.replace(/\(\d{4}\)/, '').trim();

    return { name, year };
}

// Buscar película en TMDB
async function searchTMDB(query, year) {
    try {
        const params = {
            api_key: TMDB_API_KEY,
            language: 'es-ES',
            query: query
        };
        if (year) params.year = year;

        const response = await axios.get(`${TMDB_BASE_URL}/search/movie`, { params, timeout: 10000 });

        if (response.data.results && response.data.results.length > 0) {
            const movie = response.data.results[0];
            return {
                tmdb_id: movie.id,
                title: movie.title,
                overview: movie.overview,
                poster: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
                poster_path: movie.poster_path ? `${TMDB_IMAGE_BASE}${movie.poster_path}` : null,
                backdrop: movie.backdrop_path ? `${TMDB_IMAGE_BASE}${movie.backdrop_path}` : null,
                backdrop_path: movie.backdrop_path ? `${TMDB_IMAGE_BASE}${movie.backdrop_path}` : null,
                release_date: movie.release_date,
                vote_average: movie.vote_average,
                genre_ids: movie.genre_ids || [],
                cached_at: Date.now()
            };
        }
        return null;
    } catch (error) {
        console.error(`Error buscando "${query}":`, error.message);
        return null;
    }
}

// Función principal
async function regenerateCache() {
    const localPath = getLocalPath();
    console.log(`\n🎬 Regenerando cache de películas`);
    console.log(`📂 Directorio: ${localPath}\n`);

    // Verificar que existe el directorio
    if (!fs.existsSync(localPath)) {
        console.error(`❌ El directorio no existe: ${localPath}`);
        process.exit(1);
    }

    // Listar archivos de video
    const files = fs.readdirSync(localPath)
        .filter(name => name.match(/\.(mp4|mkv|avi|mov)$/i));

    console.log(`📦 Encontradas ${files.length} películas\n`);

    // Cargar cache existente
    let cache = {};
    try {
        cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        console.log(`📋 Cache existente: ${Object.keys(cache).length} entradas\n`);
    } catch (e) {
        console.log(`📋 Creando nuevo cache\n`);
    }

    let processed = 0;
    let found = 0;
    let skipped = 0;
    let notFound = 0;

    for (const filename of files) {
        processed++;

        // Si ya tiene cache con poster, saltar
        if (cache[filename] && (cache[filename].poster || cache[filename].poster_path)) {
            skipped++;
            process.stdout.write(`\r⏭️  ${processed}/${files.length} - Saltando (ya en cache): ${filename.substring(0, 50)}...`);
            continue;
        }

        const { name, year } = cleanFilename(filename);
        process.stdout.write(`\r🔍 ${processed}/${files.length} - Buscando: ${name.substring(0, 40)}...                    `);

        const metadata = await searchTMDB(name, year);

        if (metadata) {
            cache[filename] = metadata;
            found++;
            console.log(`\n✅ ${filename} → ${metadata.title}`);
        } else {
            notFound++;
            // Guardar entrada vacía para no volver a buscar
            cache[filename] = {
                title: name,
                notFound: true,
                cached_at: Date.now()
            };
        }

        // Guardar cache cada 50 películas
        if (processed % 50 === 0) {
            fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
            console.log(`\n💾 Cache guardado (${Object.keys(cache).length} entradas)`);
        }

        // Pausa para no saturar TMDB (respeta rate limit)
        await new Promise(r => setTimeout(r, 250));
    }

    // Guardar cache final
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));

    console.log(`\n\n========================================`);
    console.log(`✅ Proceso completado!`);
    console.log(`========================================`);
    console.log(`📊 Total películas: ${files.length}`);
    console.log(`✅ Encontradas en TMDB: ${found}`);
    console.log(`⏭️  Ya en cache: ${skipped}`);
    console.log(`❌ No encontradas: ${notFound}`);
    console.log(`💾 Cache guardado: ${Object.keys(cache).length} entradas`);
    console.log(`========================================\n`);
}

// Ejecutar
regenerateCache().catch(console.error);
