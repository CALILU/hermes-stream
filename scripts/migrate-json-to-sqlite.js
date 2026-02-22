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
 *   - series-episodes.json -> series_episodes
 *   - collections.json     -> collections + collection_items
 *   - ~/.youtube_downloader_queue.json -> download_queue (opcional)
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
 * Convierte un timestamp Unix (milisegundos) a ISO string.
 */
function timestampToISO(ts) {
    if (!ts) return null;
    try {
        // Si es un numero grande (ms), convertir
        if (typeof ts === 'number' && ts > 1e12) {
            return new Date(ts).toISOString();
        }
        // Si ya es un string ISO, devolverlo tal cual
        if (typeof ts === 'string') return ts;
        // Si es un numero pequeno (segundos), convertir
        if (typeof ts === 'number') {
            return new Date(ts * 1000).toISOString();
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Extrae el ano de una fecha string (e.g. "2024-01-15" -> 2024).
 */
function extractYear(dateStr) {
    if (!dateStr) return null;
    const match = String(dateStr).match(/(\d{4})/);
    return match ? parseInt(match[1], 10) : null;
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

    const insert = db.prepare(`
        INSERT OR REPLACE INTO movies_cache
        (filename, tmdb_id, title, original_title, year, overview,
         poster_path, backdrop_path, vote_average, genres, runtime,
         director, cast_json, tmdb_raw, cached_at)
        VALUES
        (@filename, @tmdb_id, @title, @original_title, @year, @overview,
         @poster_path, @backdrop_path, @vote_average, @genres, @runtime,
         @director, @cast_json, @tmdb_raw, @cached_at)
    `);

    let migrated = 0;
    let errors = 0;

    const transaction = db.transaction(() => {
        for (const [filename, data] of entries) {
            try {
                // Extraer director del cast si existe
                let director = null;
                if (data.cast && Array.isArray(data.cast)) {
                    const dir = data.cast.find(c =>
                        c.known_for_department === 'Directing' ||
                        c.job === 'Director'
                    );
                    if (dir) director = dir.name;
                }

                // Generos: pueden ser genre_ids (numeros) o genres (strings)
                const genres = data.genres || data.genre_ids || [];

                insert.run({
                    filename,
                    tmdb_id: data.tmdb_id || data.id || null,
                    title: data.title || null,
                    original_title: data.original_title || null,
                    year: extractYear(data.release_date),
                    overview: data.overview || null,
                    poster_path: data.poster_path || data.poster || null,
                    backdrop_path: data.backdrop_path || data.backdrop || null,
                    vote_average: data.vote_average || null,
                    genres: toJSON(genres),
                    runtime: data.runtime || null,
                    director,
                    cast_json: toJSON(data.cast || []),
                    tmdb_raw: toJSON(data),
                    cached_at: timestampToISO(data.cached_at) || new Date().toISOString()
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

    const insert = db.prepare(`
        INSERT OR REPLACE INTO series_cache
        (folder_name, tmdb_id, title, original_title, overview,
         poster_path, backdrop_path, vote_average, genres,
         first_air_date, total_seasons, tmdb_raw, cached_at)
        VALUES
        (@folder_name, @tmdb_id, @title, @original_title, @overview,
         @poster_path, @backdrop_path, @vote_average, @genres,
         @first_air_date, @total_seasons, @tmdb_raw, @cached_at)
    `);

    let migrated = 0;
    let errors = 0;

    const transaction = db.transaction(() => {
        for (const [folderName, data] of entries) {
            try {
                const genres = data.genres || data.genre_ids || [];

                insert.run({
                    folder_name: folderName,
                    tmdb_id: data.tmdb_id || data.id || null,
                    title: data.title || null,
                    original_title: data.original_title || null,
                    overview: data.overview || null,
                    poster_path: data.poster || data.poster_path || null,
                    backdrop_path: data.backdrop || data.backdrop_path || null,
                    vote_average: data.vote_average || null,
                    genres: toJSON(genres),
                    first_air_date: data.first_air_date || null,
                    total_seasons: data.number_of_seasons || null,
                    tmdb_raw: toJSON(data),
                    cached_at: timestampToISO(data.cached_at) || new Date().toISOString()
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

    // Necesitamos mapear tmdb_id -> folder_name.
    // Primero obtener el mapeo de la tabla series_cache (ya migrada).
    const seriesRows = db.prepare('SELECT folder_name, tmdb_id FROM series_cache').all();
    const tmdbToFolder = new Map();
    for (const row of seriesRows) {
        if (row.tmdb_id) {
            tmdbToFolder.set(String(row.tmdb_id), row.folder_name);
        }
    }

    const insert = db.prepare(`
        INSERT OR REPLACE INTO series_episodes
        (series_folder, season, episode, filename, title, overview, still_path)
        VALUES
        (@series_folder, @season, @episode, @filename, @title, @overview, @still_path)
    `);

    let migrated = 0;
    let errors = 0;
    let skipped = 0;

    const transaction = db.transaction(() => {
        for (const [tmdbId, seriesData] of Object.entries(data)) {
            // Intentar obtener folder_name desde el mapeo
            let seriesFolder = tmdbToFolder.get(tmdbId);

            // Si no hay mapeo, usar series_title como fallback
            if (!seriesFolder && seriesData.series_title) {
                seriesFolder = seriesData.series_title;
            }

            if (!seriesFolder) {
                console.log(`  [SKIP] No se encontro folder para tmdb_id=${tmdbId}, series_title="${seriesData.series_title || 'N/A'}"`);
                skipped++;
                continue;
            }

            // Verificar que la serie existe en series_cache; si no, insertarla como placeholder
            const existing = db.prepare('SELECT folder_name FROM series_cache WHERE folder_name = ?').get(seriesFolder);
            if (!existing) {
                db.prepare(`
                    INSERT OR IGNORE INTO series_cache
                    (folder_name, tmdb_id, title, cached_at)
                    VALUES (?, ?, ?, datetime('now'))
                `).run(seriesFolder, parseInt(tmdbId, 10) || null, seriesData.series_title || seriesFolder);
            }

            const seasons = seriesData.seasons || {};
            for (const [seasonNum, seasonData] of Object.entries(seasons)) {
                const episodes = seasonData.episodes || [];
                for (const ep of episodes) {
                    try {
                        insert.run({
                            series_folder: seriesFolder,
                            season: parseInt(seasonNum, 10),
                            episode: ep.episode_number || 0,
                            filename: ep.filename || '',
                            title: ep.name || ep.title || null,
                            overview: ep.overview || null,
                            still_path: ep.still || ep.still_path || null
                        });
                        migrated++;
                    } catch (error) {
                        // UNIQUE constraint puede fallar si hay duplicados
                        if (!error.message.includes('UNIQUE')) {
                            console.error(`  [ERROR] S${seasonNum}E${ep.episode_number} de "${seriesFolder}": ${error.message}`);
                        }
                        errors++;
                    }
                }
            }
        }
    });

    transaction();
    console.log(`  Episodios migrados: ${migrated} | Errores: ${errors} | Series sin folder: ${skipped}`);
    return { migrated, errors, skipped };
}

// ===================================================================
// Migracion: collections.json -> collections + collection_items
// ===================================================================

function migrateCollections(db) {
    separator('MIGRANDO: collections.json -> collections + collection_items');

    const filePath = path.join(BASE_DIR, 'collections.json');
    const data = readJSON(filePath);
    if (!data) return { migrated: 0, items: 0, errors: 0 };

    const entries = Object.entries(data);
    console.log(`  Encontradas ${entries.length} colecciones`);

    if (entries.length === 0) return { migrated: 0, items: 0, errors: 0 };

    const insertCollection = db.prepare(`
        INSERT OR REPLACE INTO collections
        (id, name, description, type, poster_path, backdrop_path,
         genre_ids, auto_criteria, tmdb_raw, created_at, updated_at)
        VALUES
        (@id, @name, @description, @type, @poster_path, @backdrop_path,
         @genre_ids, @auto_criteria, @tmdb_raw, @created_at, @updated_at)
    `);

    const insertItem = db.prepare(`
        INSERT OR REPLACE INTO collection_items
        (collection_id, filename, tmdb_id, title, poster_path,
         release_date, position, added_at)
        VALUES
        (@collection_id, @filename, @tmdb_id, @title, @poster_path,
         @release_date, @position, datetime('now'))
    `);

    let migratedCollections = 0;
    let migratedItems = 0;
    let errors = 0;

    const transaction = db.transaction(() => {
        for (const [collectionId, col] of entries) {
            try {
                const now = new Date().toISOString();
                const cachedAt = timestampToISO(col.cached_at) || now;

                insertCollection.run({
                    id: parseInt(collectionId, 10) || null,
                    name: col.name || `Coleccion ${collectionId}`,
                    description: col.overview || col.description || null,
                    type: col.type || 'auto',
                    poster_path: col.poster || col.poster_path || null,
                    backdrop_path: col.backdrop || col.backdrop_path || null,
                    genre_ids: toJSON(col.genre_ids || []),
                    auto_criteria: toJSON(col.auto_criteria || null),
                    tmdb_raw: toJSON(col),
                    created_at: cachedAt,
                    updated_at: cachedAt
                });

                migratedCollections++;

                // Migrar los items (peliculas) de la coleccion
                const movies = col.movies || col.parts || [];
                for (let i = 0; i < movies.length; i++) {
                    const movie = movies[i];
                    try {
                        insertItem.run({
                            collection_id: parseInt(collectionId, 10),
                            filename: movie.filename || movie.title || `item_${i}`,
                            tmdb_id: movie.tmdb_id || movie.id || null,
                            title: movie.title || null,
                            poster_path: movie.poster || movie.poster_path || null,
                            release_date: movie.release_date || null,
                            position: i
                        });
                        migratedItems++;
                    } catch (itemError) {
                        if (!itemError.message.includes('UNIQUE')) {
                            console.error(`  [ERROR] Item "${movie.title}" en coleccion ${collectionId}: ${itemError.message}`);
                        }
                        errors++;
                    }
                }
            } catch (error) {
                console.error(`  [ERROR] Coleccion ${collectionId} "${col.name}": ${error.message}`);
                errors++;
            }
        }
    });

    transaction();
    console.log(`  Colecciones migradas: ${migratedCollections} | Items: ${migratedItems} | Errores: ${errors}`);
    return { migrated: migratedCollections, items: migratedItems, errors };
}

// ===================================================================
// Migracion: ~/.youtube_downloader_queue.json -> download_queue
// ===================================================================

function migrateDownloadQueue(db) {
    separator('MIGRANDO: download_queue.json -> download_queue');

    const filePath = path.join(os.homedir(), '.youtube_downloader_queue.json');
    const data = readJSON(filePath);
    if (!data) return { migrated: 0, errors: 0 };

    if (!Array.isArray(data)) {
        console.log('  [SKIP] El archivo no contiene un array valido');
        return { migrated: 0, errors: 0 };
    }

    console.log(`  Encontrados ${data.length} items en cola de descargas`);

    if (data.length === 0) return { migrated: 0, errors: 0 };

    const insert = db.prepare(`
        INSERT OR IGNORE INTO download_queue
        (url, title, format, status, output_path, request_id, added_at, updated_at)
        VALUES
        (@url, @title, @format, @status, @output_path, @request_id, @added_at, @updated_at)
    `);

    let migrated = 0;
    let errors = 0;

    const transaction = db.transaction(() => {
        for (const item of data) {
            try {
                // Mapear status: el JSON usa 'pending'/'completed'/etc.
                const validStatuses = ['pending', 'downloading', 'completed', 'failed', 'cancelled'];
                const status = validStatuses.includes(item.status) ? item.status : 'pending';

                insert.run({
                    url: item.url || '',
                    title: item.title || null,
                    format: item.format || null,
                    status,
                    output_path: item.output_path || item.outputPath || null,
                    request_id: item.requestId || item.request_id || null,
                    added_at: item.added_at || item.addedAt || new Date().toISOString(),
                    updated_at: item.updated_at || item.updatedAt || new Date().toISOString()
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
        collection_items: db.prepare('SELECT COUNT(*) as count FROM collection_items').get().count,
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

    // series_episodes
    const episodesOk = counts.series_episodes === results.episodes.migrated;
    console.log(`  series_episodes       | ${String(counts.series_episodes).padStart(5)}   | ${String(results.episodes.migrated).padStart(5)}   | ${episodesOk ? 'OK' : 'DIFERENCIA'}`);

    // collections
    const collectionsOk = counts.collections === results.collections.migrated;
    console.log(`  collections           | ${String(counts.collections).padStart(5)}   | ${String(results.collections.migrated).padStart(5)}   | ${collectionsOk ? 'OK' : 'DIFERENCIA'}`);

    // collection_items
    const itemsOk = counts.collection_items === results.collections.items;
    console.log(`  collection_items      | ${String(counts.collection_items).padStart(5)}   | ${String(results.collections.items).padStart(5)}   | ${itemsOk ? 'OK' : 'DIFERENCIA'}`);

    // download_queue
    const downloadsOk = counts.download_queue === results.downloads.migrated;
    console.log(`  download_queue        | ${String(counts.download_queue).padStart(5)}   | ${String(results.downloads.migrated).padStart(5)}   | ${downloadsOk ? 'OK' : 'DIFERENCIA'}`);

    console.log('');

    const allOk = moviesOk && seriesOk && episodesOk && collectionsOk && itemsOk && downloadsOk;
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

        // Episodios dependen de series_cache (necesita folder_name para mapear)
        results.episodes = migrateSeriesEpisodes(db);

        // Colecciones (independientes)
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
        (results.collections?.items || 0) +
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
