#!/usr/bin/env node

/**
 * Migracion de archivos JSON a SQLite
 *
 * Lee los archivos JSON existentes y los inserta en la base de datos SQLite
 * usando el modulo db/media-db.js.
 *
 * Archivos migrados:
 *   - cache.json           -> movies_cache
 *   - cache-series.json    -> series_cache
 *   - series-episodes.json -> series_episodes  (one row per series, seasons as JSON blob)
 *   - collections.json     -> collections      (movies stored as JSON in `movies` column)
 *   - download-queue.json  -> download_queue   (opcional)
 *
 * Uso: node scripts/migrate-json-to-sqlite.js
 *
 * Los archivos JSON originales NO se eliminan (sirven como backup).
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// Directorio base del proyecto
const BASE_DIR = path.join(__dirname, '..');

// Cargar el modulo de base de datos
const mediaDB = require(path.join(BASE_DIR, 'db', 'media-db'));

// ===================================================================
// Utilidades
// ===================================================================

/**
 * Lee y parsea un archivo JSON. Devuelve null si no existe o hay error.
 */
function readJSON(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            console.log(`  [SKIP] Archivo no encontrado: ${filePath}`);
            return null;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        return data;
    } catch (error) {
        console.error(`  [ERROR] Error leyendo ${filePath}: ${error.message}`);
        return null;
    }
}

/**
 * Convierte un valor a timestamp Unix en milisegundos (INTEGER).
 * Si ya es un numero grande (ms), lo devuelve tal cual.
 * Si es un numero pequeno (segundos), lo multiplica.
 * Si es un string ISO, lo convierte.
 * Devuelve Date.now() como fallback.
 */
function toTimestamp(val) {
    if (val === null || val === undefined) return Date.now();
    // Si ya es un numero grande (ms), devolver tal cual
    if (typeof val === 'number' && val > 1e12) return val;
    // Si es un numero pequeno (segundos), convertir a ms
    if (typeof val === 'number' && val > 0) return val * 1000;
    // Si es un string ISO, parsear
    if (typeof val === 'string') {
        const parsed = new Date(val).getTime();
        return isNaN(parsed) ? Date.now() : parsed;
    }
    return Date.now();
}

/**
 * Serializa un valor a JSON string si no es null/undefined.
 */
function toJSON(val) {
    if (val === null || val === undefined) return null;
    try {
        return JSON.stringify(val);
    } catch {
        return null;
    }
}

// ===================================================================
// Separador visual para consola
// ===================================================================

function separator(title) {
    console.log('');
    console.log('='.repeat(60));
    console.log(`  ${title}`);
    console.log('='.repeat(60));
}

// ===================================================================
// Migracion: cache.json -> movies_cache
// ===================================================================

function migrateMoviesCache(db) {
    separator('MIGRANDO: cache.json -> movies_cache');

    const filePath = path.join(BASE_DIR, 'cache.json');
    const cache = readJSON(filePath);
    if (!cache) return { migrated: 0, errors: 0 };

    const entries = Object.entries(cache);
    console.log(`  Encontradas ${entries.length} peliculas en cache.json`);

    if (entries.length === 0) return { migrated: 0, errors: 0 };

    // Schema: filename, tmdb_id, title, original_title, overview, poster_path,
    //         backdrop_path, release_date, vote_average, genre_ids, runtime,
    //         videos, recommendations, cast_json, collection_json, cached_at (INTEGER), tmdb_raw
    const insert = db.prepare(`
        INSERT OR REPLACE INTO movies_cache
        (filename, tmdb_id, title, original_title, overview,
         poster_path, backdrop_path, release_date, vote_average,
         genre_ids, runtime, videos, recommendations, cast_json,
         collection_json, cached_at, tmdb_raw)
        VALUES
        (@filename, @tmdb_id, @title, @original_title, @overview,
         @poster_path, @backdrop_path, @release_date, @vote_average,
         @genre_ids, @runtime, @videos, @recommendations, @cast_json,
         @collection_json, @cached_at, @tmdb_raw)
    `);

    let migrated = 0;
    let errors = 0;

    const transaction = db.transaction(() => {
        for (const [filename, data] of entries) {
            try {
                insert.run({
                    filename,
                    tmdb_id: data.tmdb_id || data.id || null,
                    title: data.title || null,
                    original_title: data.original_title || null,
                    overview: data.overview || null,
                    poster_path: data.poster_path || data.poster || null,
                    backdrop_path: data.backdrop_path || data.backdrop || null,
                    release_date: data.release_date || null,
                    vote_average: data.vote_average || null,
                    genre_ids: toJSON(data.genre_ids || []),
                    runtime: data.runtime || null,
                    videos: toJSON(data.videos || []),
                    recommendations: toJSON(data.recommendations || []),
                    cast_json: toJSON(data.cast || []),
                    collection_json: toJSON(data.collection || null),
                    cached_at: toTimestamp(data.cached_at),
                    tmdb_raw: toJSON(data)
                });

                migrated++;
            } catch (error) {
                console.error(`  [ERROR] Fallo al migrar "${filename}": ${error.message}`);
                errors++;
            }
        }
    });

    transaction();
    console.log(`  Migradas: ${migrated} | Errores: ${errors}`);
    return { migrated, errors };
}

// ===================================================================
// Migracion: cache-series.json -> series_cache
// ===================================================================

function migrateSeriesCache(db) {
    separator('MIGRANDO: cache-series.json -> series_cache');

    const filePath = path.join(BASE_DIR, 'cache-series.json');
    const cache = readJSON(filePath);
    if (!cache) return { migrated: 0, errors: 0 };

    const entries = Object.entries(cache);
    console.log(`  Encontradas ${entries.length} series en cache-series.json`);

    if (entries.length === 0) return { migrated: 0, errors: 0 };

    // Schema: folder_name, tmdb_id, title, original_title, overview, poster_path,
    //         backdrop_path, first_air_date, last_air_date, vote_average,
    //         genre_ids, genres, status, number_of_seasons, number_of_episodes,
    //         episode_runtime, networks, created_by, cast_json, videos,
    //         recommendations, seasons_info, last_watched, cached_at (INTEGER)
    const insert = db.prepare(`
        INSERT OR REPLACE INTO series_cache
        (folder_name, tmdb_id, title, original_title, overview,
         poster_path, backdrop_path, first_air_date, last_air_date,
         vote_average, genre_ids, genres, status, number_of_seasons,
         number_of_episodes, episode_runtime, networks, created_by,
         cast_json, videos, recommendations, seasons_info,
         last_watched, cached_at)
        VALUES
        (@folder_name, @tmdb_id, @title, @original_title, @overview,
         @poster_path, @backdrop_path, @first_air_date, @last_air_date,
         @vote_average, @genre_ids, @genres, @status, @number_of_seasons,
         @number_of_episodes, @episode_runtime, @networks, @created_by,
         @cast_json, @videos, @recommendations, @seasons_info,
         @last_watched, @cached_at)
    `);

    let migrated = 0;
    let errors = 0;

    const transaction = db.transaction(() => {
        for (const [folderName, data] of entries) {
            try {
                insert.run({
                    folder_name: folderName,
                    tmdb_id: data.tmdb_id || data.id || null,
                    title: data.title || null,
                    original_title: data.original_title || null,
                    overview: data.overview || null,
                    poster_path: data.poster || data.poster_path || null,
                    backdrop_path: data.backdrop || data.backdrop_path || null,
                    first_air_date: data.first_air_date || null,
                    last_air_date: data.last_air_date || null,
                    vote_average: data.vote_average || null,
                    genre_ids: toJSON(data.genre_ids || []),
                    genres: toJSON(data.genres || []),
                    status: data.status || null,
                    number_of_seasons: data.number_of_seasons || null,
                    number_of_episodes: data.number_of_episodes || null,
                    episode_runtime: data.episode_runtime || null,
                    networks: toJSON(data.networks || []),
                    created_by: toJSON(data.created_by || []),
                    cast_json: toJSON(data.cast || []),
                    videos: toJSON(data.videos || []),
                    recommendations: toJSON(data.recommendations || []),
                    seasons_info: toJSON(data.seasons_info || null),
                    last_watched: toJSON(data.last_watched || null),
                    cached_at: toTimestamp(data.cached_at)
                });

                migrated++;
            } catch (error) {
                console.error(`  [ERROR] Fallo al migrar serie "${folderName}": ${error.message}`);
                errors++;
            }
        }
    });

    transaction();
    console.log(`  Migradas: ${migrated} | Errores: ${errors}`);
    return { migrated, errors };
}

// ===================================================================
// Migracion: series-episodes.json -> series_episodes
// ===================================================================

function migrateSeriesEpisodes(db) {
    separator('MIGRANDO: series-episodes.json -> series_episodes');

    const filePath = path.join(BASE_DIR, 'series-episodes.json');
    const data = readJSON(filePath);
    if (!data) return { migrated: 0, errors: 0 };

    const seriesKeys = Object.keys(data);
    console.log(`  Encontradas ${seriesKeys.length} series con episodios`);

    if (seriesKeys.length === 0) return { migrated: 0, errors: 0 };

    // Schema: tmdb_id TEXT PRIMARY KEY, series_title TEXT, seasons_data TEXT
    // Each series is stored as one row with all seasons as a JSON blob in seasons_data
    const insert = db.prepare(`
        INSERT OR REPLACE INTO series_episodes
        (tmdb_id, series_title, seasons_data)
        VALUES
        (@tmdb_id, @series_title, @seasons_data)
    `);

    let migrated = 0;
    let errors = 0;

    const transaction = db.transaction(() => {
        for (const [tmdbId, seriesData] of Object.entries(data)) {
            try {
                // seriesData has: { series_title, seasons: { "1": { episodes: [...] }, ... } }
                const seriesTitle = seriesData.series_title || null;
                const seasons = seriesData.seasons || {};

                insert.run({
                    tmdb_id: String(tmdbId),
                    series_title: seriesTitle,
                    seasons_data: JSON.stringify(seasons)
                });

                migrated++;
            } catch (error) {
                console.error(`  [ERROR] Fallo al migrar episodios de tmdb_id=${tmdbId}: ${error.message}`);
                errors++;
            }
        }
    });

    transaction();
    console.log(`  Series migradas: ${migrated} | Errores: ${errors}`);
    return { migrated, errors };
}

// ===================================================================
// Migracion: collections.json -> collections
// ===================================================================

function migrateCollections(db) {
    separator('MIGRANDO: collections.json -> collections');

    const filePath = path.join(BASE_DIR, 'collections.json');
    const data = readJSON(filePath);
    if (!data) return { migrated: 0, errors: 0 };

    const entries = Object.entries(data);
    console.log(`  Encontradas ${entries.length} colecciones`);

    if (entries.length === 0) return { migrated: 0, errors: 0 };

    // Schema: collection_id TEXT PRIMARY KEY, name TEXT, overview TEXT,
    //         poster TEXT, backdrop TEXT, movies TEXT (JSON), genre_ids TEXT (JSON),
    //         cached_at INTEGER
    // NOTE: NO collection_items table. Movies are stored as JSON array in `movies` column.
    const insertCollection = db.prepare(`
        INSERT OR REPLACE INTO collections
        (collection_id, name, overview, poster, backdrop, movies, genre_ids, cached_at)
        VALUES
        (@collection_id, @name, @overview, @poster, @backdrop, @movies, @genre_ids, @cached_at)
    `);

    let migrated = 0;
    let errors = 0;

    const transaction = db.transaction(() => {
        for (const [collectionId, col] of entries) {
            try {
                // movies is an array of { filename, tmdb_id, title, poster, release_date, genre_ids }
                const movies = col.movies || col.parts || [];

                insertCollection.run({
                    collection_id: String(collectionId),
                    name: col.name || `Coleccion ${collectionId}`,
                    overview: col.overview || null,
                    poster: col.poster || col.poster_path || null,
                    backdrop: col.backdrop || col.backdrop_path || null,
                    movies: toJSON(movies),
                    genre_ids: toJSON(col.genre_ids || []),
                    cached_at: toTimestamp(col.cached_at)
                });

                migrated++;
            } catch (error) {
                console.error(`  [ERROR] Coleccion ${collectionId} "${col.name}": ${error.message}`);
                errors++;
            }
        }
    });

    transaction();
    console.log(`  Colecciones migradas: ${migrated} | Errores: ${errors}`);
    return { migrated, errors };
}

// ===================================================================
// Migracion: download-queue.json -> download_queue
// ===================================================================

function migrateDownloadQueue(db) {
    separator('MIGRANDO: download-queue.json -> download_queue');

    // Try multiple possible locations
    const possiblePaths = [
        path.join(BASE_DIR, 'download-queue.json'),
        path.join(os.homedir(), '.youtube_downloader_queue.json')
    ];

    let data = null;
    for (const filePath of possiblePaths) {
        data = readJSON(filePath);
        if (data) break;
    }

    if (!data) return { migrated: 0, errors: 0 };

    if (!Array.isArray(data)) {
        console.log('  [SKIP] El archivo no contiene un array valido');
        return { migrated: 0, errors: 0 };
    }

    console.log(`  Encontrados ${data.length} items en cola de descargas`);

    if (data.length === 0) return { migrated: 0, errors: 0 };

    // Schema: id INTEGER PRIMARY KEY AUTOINCREMENT, url TEXT NOT NULL UNIQUE,
    //         title TEXT, status TEXT NOT NULL DEFAULT 'pending',
    //         output_path TEXT, request_id INTEGER,
    //         added_at TEXT NOT NULL, completed_at TEXT
    const insert = db.prepare(`
        INSERT OR IGNORE INTO download_queue
        (url, title, status, output_path, request_id, added_at, completed_at)
        VALUES
        (@url, @title, @status, @output_path, @request_id, @added_at, @completed_at)
    `);

    let migrated = 0;
    let errors = 0;

    const transaction = db.transaction(() => {
        for (const item of data) {
            try {
                const validStatuses = ['pending', 'downloading', 'completed', 'failed', 'cancelled'];
                const status = validStatuses.includes(item.status) ? item.status : 'pending';

                insert.run({
                    url: item.url || '',
                    title: item.title || null,
                    status,
                    output_path: item.output_path || item.outputPath || null,
                    request_id: item.requestId || item.request_id || null,
                    added_at: item.added_at || item.addedAt || new Date().toISOString(),
                    completed_at: item.completed_at || item.completedAt || null
                });

                migrated++;
            } catch (error) {
                if (!error.message.includes('UNIQUE')) {
                    console.error(`  [ERROR] Item "${item.title || item.url}": ${error.message}`);
                }
                errors++;
            }
        }
    });

    transaction();
    console.log(`  Migrados: ${migrated} | Errores: ${errors}`);
    return { migrated, errors };
}

// ===================================================================
// Verificacion post-migracion
// ===================================================================

function verifyMigration(db, results) {
    separator('VERIFICACION POST-MIGRACION');

    const counts = {
        movies_cache: db.prepare('SELECT COUNT(*) as count FROM movies_cache').get().count,
        series_cache: db.prepare('SELECT COUNT(*) as count FROM series_cache').get().count,
        series_episodes: db.prepare('SELECT COUNT(*) as count FROM series_episodes').get().count,
        collections: db.prepare('SELECT COUNT(*) as count FROM collections').get().count,
        download_queue: db.prepare('SELECT COUNT(*) as count FROM download_queue').get().count
    };

    console.log('');
    console.log('  Tabla                 | SQLite  | JSON    | Estado');
    console.log('  ' + '-'.repeat(56));

    // movies_cache
    const moviesOk = counts.movies_cache === results.movies.migrated;
    console.log(`  movies_cache          | ${String(counts.movies_cache).padStart(5)}   | ${String(results.movies.migrated).padStart(5)}   | ${moviesOk ? 'OK' : 'DIFERENCIA'}`);

    // series_cache
    const seriesOk = counts.series_cache >= results.series.migrated;
    console.log(`  series_cache          | ${String(counts.series_cache).padStart(5)}   | ${String(results.series.migrated).padStart(5)}   | ${seriesOk ? 'OK' : 'DIFERENCIA'}`);

    // series_episodes (one row per series)
    const episodesOk = counts.series_episodes === results.episodes.migrated;
    console.log(`  series_episodes       | ${String(counts.series_episodes).padStart(5)}   | ${String(results.episodes.migrated).padStart(5)}   | ${episodesOk ? 'OK' : 'DIFERENCIA'}`);

    // collections
    const collectionsOk = counts.collections === results.collections.migrated;
    console.log(`  collections           | ${String(counts.collections).padStart(5)}   | ${String(results.collections.migrated).padStart(5)}   | ${collectionsOk ? 'OK' : 'DIFERENCIA'}`);

    // download_queue
    const downloadsOk = counts.download_queue === results.downloads.migrated;
    console.log(`  download_queue        | ${String(counts.download_queue).padStart(5)}   | ${String(results.downloads.migrated).padStart(5)}   | ${downloadsOk ? 'OK' : 'DIFERENCIA'}`);

    console.log('');

    const allOk = moviesOk && seriesOk && episodesOk && collectionsOk && downloadsOk;
    if (allOk) {
        console.log('  RESULTADO: Todas las tablas verificadas correctamente.');
    } else {
        console.log('  RESULTADO: Hay diferencias en algunas tablas. Revisa los errores arriba.');
        console.log('  (Diferencias pueden deberse a registros duplicados o datos invalidos)');
    }

    return allOk;
}

// ===================================================================
// Ejecucion principal
// ===================================================================

function main() {
    console.log('');
    console.log('*'.repeat(60));
    console.log('  MIGRACION JSON -> SQLite');
    console.log('  IsiPrime Media Database');
    console.log('  ' + new Date().toISOString());
    console.log('*'.repeat(60));

    // 1. Inicializar la base de datos
    console.log('\nInicializando base de datos SQLite...');
    let db;
    try {
        db = mediaDB.init();
        console.log('Base de datos inicializada correctamente.');
    } catch (error) {
        console.error(`\nERROR FATAL: No se pudo inicializar la base de datos: ${error.message}`);
        console.error('Asegurate de que el modulo db/media-db.js existe y better-sqlite3 esta instalado.');
        process.exit(1);
    }

    // 2. Ejecutar migraciones en orden
    const results = {};

    try {
        // Primero las caches (no tienen dependencias)
        results.movies = migrateMoviesCache(db);
        results.series = migrateSeriesCache(db);

        // Episodios: cada serie es una fila con seasons_data como JSON blob
        results.episodes = migrateSeriesEpisodes(db);

        // Colecciones: movies almacenadas como JSON en columna `movies`
        results.collections = migrateCollections(db);

        // Cola de descargas (independiente, archivo opcional)
        results.downloads = migrateDownloadQueue(db);

    } catch (error) {
        console.error(`\nERROR durante la migracion: ${error.message}`);
        console.error(error.stack);
    }

    // 3. Verificar resultados
    const allOk = verifyMigration(db, results);

    // 4. Resumen final
    separator('RESUMEN');

    const totalMigrated =
        (results.movies?.migrated || 0) +
        (results.series?.migrated || 0) +
        (results.episodes?.migrated || 0) +
        (results.collections?.migrated || 0) +
        (results.downloads?.migrated || 0);

    const totalErrors =
        (results.movies?.errors || 0) +
        (results.series?.errors || 0) +
        (results.episodes?.errors || 0) +
        (results.collections?.errors || 0) +
        (results.downloads?.errors || 0);

    console.log(`  Total registros migrados: ${totalMigrated}`);
    console.log(`  Total errores:            ${totalErrors}`);
    console.log('');
    console.log('  Los archivos JSON originales NO se han eliminado.');
    console.log('  Sirven como backup en caso de necesitar revertir.');
    console.log('');

    if (allOk && totalErrors === 0) {
        console.log('  Migracion completada exitosamente.');
    } else if (totalErrors > 0) {
        console.log(`  Migracion completada con ${totalErrors} error(es).`);
        console.log('  Revisa los mensajes de error arriba para mas detalles.');
    }

    // 5. Cerrar la base de datos
    mediaDB.close();

    console.log('');
    process.exit(allOk && totalErrors === 0 ? 0 : 1);
}

// Ejecutar
main();
