/**
 * Modulo de Base de Datos SQLite para Media (Peliculas, Series, Colecciones, Descargas)
 * Reemplaza 6 archivos JSON: cache.json, cache-series.json, series-episodes.json,
 * collections.json, download-queue.json
 *
 * @author IsiPrime
 * @version 1.0.0
 */

const Database = require('better-sqlite3');
const path = require('path');

// Ruta de la base de datos
const DB_PATH = path.join(__dirname, '..', 'isiprime.db');

// Instancia de la base de datos (singleton)
let db = null;

// Campos JSON que deben ser parseados/stringificados
const MOVIE_JSON_FIELDS = ['genre_ids', 'videos', 'recommendations', 'cast_json', 'collection_json'];
const SERIES_JSON_FIELDS = [
    'genre_ids', 'genres', 'networks', 'created_by', 'cast_json',
    'videos', 'recommendations', 'seasons_info', 'last_watched'
];
const COLLECTION_JSON_FIELDS = ['movies', 'genre_ids'];

/**
 * Inicializa la base de datos y crea las tablas si no existen
 */
function init() {
    if (db) return db;

    console.log('🗄️  Inicializando base de datos media SQLite...');

    // Crear conexion
    db = new Database(DB_PATH);

    // Habilitar WAL mode para mejor rendimiento y concurrencia
    db.pragma('journal_mode = WAL');

    // Crear tabla de cache de peliculas
    db.exec(`
        CREATE TABLE IF NOT EXISTS movies_cache (
            filename TEXT PRIMARY KEY,
            tmdb_id INTEGER,
            title TEXT,
            original_title TEXT,
            overview TEXT,
            poster_path TEXT,
            backdrop_path TEXT,
            release_date TEXT,
            vote_average REAL,
            genre_ids TEXT,
            runtime INTEGER,
            videos TEXT,
            recommendations TEXT,
            cast_json TEXT,
            collection_json TEXT,
            cached_at INTEGER,
            tmdb_raw TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_movies_tmdb ON movies_cache(tmdb_id);
    `);

    // Crear tabla de cache de series
    db.exec(`
        CREATE TABLE IF NOT EXISTS series_cache (
            folder_name TEXT PRIMARY KEY,
            tmdb_id INTEGER,
            title TEXT,
            original_title TEXT,
            overview TEXT,
            poster_path TEXT,
            backdrop_path TEXT,
            first_air_date TEXT,
            last_air_date TEXT,
            vote_average REAL,
            genre_ids TEXT,
            genres TEXT,
            status TEXT,
            number_of_seasons INTEGER,
            number_of_episodes INTEGER,
            episode_runtime INTEGER,
            networks TEXT,
            created_by TEXT,
            cast_json TEXT,
            videos TEXT,
            recommendations TEXT,
            seasons_info TEXT,
            last_watched TEXT,
            cached_at INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_series_tmdb ON series_cache(tmdb_id);
    `);

    // Crear tabla de episodios de series (JSON blob por tmdb_id)
    db.exec(`
        CREATE TABLE IF NOT EXISTS series_episodes (
            tmdb_id TEXT PRIMARY KEY,
            series_title TEXT,
            seasons_data TEXT NOT NULL
        );
    `);

    // Crear tabla de colecciones
    db.exec(`
        CREATE TABLE IF NOT EXISTS collections (
            collection_id TEXT PRIMARY KEY,
            name TEXT,
            overview TEXT,
            poster TEXT,
            backdrop TEXT,
            movies TEXT,
            genre_ids TEXT,
            cached_at INTEGER
        );
    `);

    // Crear tabla de cola de descargas
    db.exec(`
        CREATE TABLE IF NOT EXISTS download_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL UNIQUE,
            title TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            output_path TEXT,
            request_id INTEGER,
            added_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT
        );
    `);

    // Migración: añadir columnas de codec info si no existen
    const movieCols = db.prepare("PRAGMA table_info(movies_cache)").all().map(c => c.name);
    if (!movieCols.includes('video_codec')) {
        db.exec(`
            ALTER TABLE movies_cache ADD COLUMN video_codec TEXT;
            ALTER TABLE movies_cache ADD COLUMN audio_codec TEXT;
            ALTER TABLE movies_cache ADD COLUMN audio_channels INTEGER;
            ALTER TABLE movies_cache ADD COLUMN bitrate INTEGER;
            ALTER TABLE movies_cache ADD COLUMN width INTEGER;
            ALTER TABLE movies_cache ADD COLUMN height INTEGER;
            ALTER TABLE movies_cache ADD COLUMN duration_seconds INTEGER;
        `);
        console.log('🗄️  Columnas codec info añadidas a movies_cache');
    }

    console.log('🗄️  Tablas media SQLite creadas/verificadas');

    const movieCount = db.prepare('SELECT COUNT(*) as count FROM movies_cache').get().count;
    const seriesCount = db.prepare('SELECT COUNT(*) as count FROM series_cache').get().count;
    const collectionsCount = db.prepare('SELECT COUNT(*) as count FROM collections').get().count;
    console.log(`🗄️  Base de datos media lista (${movieCount} peliculas, ${seriesCount} series, ${collectionsCount} colecciones)`);

    return db;
}

// ============================================================
// Utilidades para JSON
// ============================================================

/**
 * Stringifica campos JSON de un objeto para almacenamiento
 * @param {Object} data - Datos originales
 * @param {Array<string>} fields - Campos que contienen JSON
 * @returns {Object} Datos con campos JSON stringificados
 */
function stringifyJsonFields(data, fields) {
    const result = { ...data };
    for (const field of fields) {
        if (result[field] !== undefined && result[field] !== null && typeof result[field] !== 'string') {
            result[field] = JSON.stringify(result[field]);
        }
    }
    return result;
}

/**
 * Parsea campos JSON de una fila de BD
 * @param {Object} row - Fila de la BD
 * @param {Array<string>} fields - Campos que contienen JSON
 * @returns {Object} Datos con campos JSON parseados
 */
function parseJsonFields(row, fields) {
    if (!row) return null;
    const result = { ...row };
    for (const field of fields) {
        if (result[field] && typeof result[field] === 'string') {
            try {
                result[field] = JSON.parse(result[field]);
            } catch (e) {
                // Si no es JSON valido, dejar como string
            }
        }
    }
    return result;
}

// ============================================================
// Movies Cache
// ============================================================

/**
 * Obtiene todas las peliculas como objeto indexado por filename
 * Compatible con el formato de cache.json
 * @returns {Object} { filename: movieData, ... }
 */
function getAllMovies() {
    init();
    const rows = db.prepare('SELECT * FROM movies_cache').all();
    const result = {};
    for (const row of rows) {
        const parsed = parseJsonFields(row, MOVIE_JSON_FIELDS);
        const filename = parsed.filename;
        delete parsed.filename;
        result[filename] = parsed;
    }
    return result;
}

/**
 * Obtiene una pelicula por filename
 * @param {string} filename
 * @returns {Object|null}
 */
function getMovie(filename) {
    init();
    const row = db.prepare('SELECT * FROM movies_cache WHERE filename = ?').get(filename);
    if (!row) return null;
    const parsed = parseJsonFields(row, MOVIE_JSON_FIELDS);
    delete parsed.filename;
    return parsed;
}

/**
 * Inserta o actualiza una pelicula
 * @param {string} filename
 * @param {Object} data - Datos de la pelicula
 */
function upsertMovie(filename, data) {
    init();
    const prepared = stringifyJsonFields(data, MOVIE_JSON_FIELDS);

    // Si tmdb_raw es un objeto, stringificarlo tambien
    if (prepared.tmdb_raw && typeof prepared.tmdb_raw !== 'string') {
        prepared.tmdb_raw = JSON.stringify(prepared.tmdb_raw);
    }

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO movies_cache (
            filename, tmdb_id, title, original_title, overview,
            poster_path, backdrop_path, release_date, vote_average,
            genre_ids, runtime, videos, recommendations, cast_json,
            collection_json, cached_at, tmdb_raw
        ) VALUES (
            @filename, @tmdb_id, @title, @original_title, @overview,
            @poster_path, @backdrop_path, @release_date, @vote_average,
            @genre_ids, @runtime, @videos, @recommendations, @cast_json,
            @collection_json, @cached_at, @tmdb_raw
        )
    `);

    stmt.run({
        filename,
        tmdb_id: prepared.tmdb_id ?? null,
        title: prepared.title ?? null,
        original_title: prepared.original_title ?? null,
        overview: prepared.overview ?? null,
        poster_path: prepared.poster_path ?? null,
        backdrop_path: prepared.backdrop_path ?? null,
        release_date: prepared.release_date ?? null,
        vote_average: prepared.vote_average ?? null,
        genre_ids: prepared.genre_ids ?? null,
        runtime: prepared.runtime ?? null,
        videos: prepared.videos ?? null,
        recommendations: prepared.recommendations ?? null,
        cast_json: prepared.cast_json ?? null,
        collection_json: prepared.collection_json ?? null,
        cached_at: prepared.cached_at ?? Date.now(),
        tmdb_raw: prepared.tmdb_raw ?? null
    });
}

/**
 * Inserta o actualiza multiples peliculas en una transaccion
 * @param {Object} moviesObj - Objeto { filename: movieData, ... }
 */
function upsertMoviesBatch(moviesObj) {
    init();

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO movies_cache (
            filename, tmdb_id, title, original_title, overview,
            poster_path, backdrop_path, release_date, vote_average,
            genre_ids, runtime, videos, recommendations, cast_json,
            collection_json, cached_at, tmdb_raw
        ) VALUES (
            @filename, @tmdb_id, @title, @original_title, @overview,
            @poster_path, @backdrop_path, @release_date, @vote_average,
            @genre_ids, @runtime, @videos, @recommendations, @cast_json,
            @collection_json, @cached_at, @tmdb_raw
        )
    `);

    const transaction = db.transaction((entries) => {
        for (const [filename, data] of entries) {
            const prepared = stringifyJsonFields(data, MOVIE_JSON_FIELDS);

            if (prepared.tmdb_raw && typeof prepared.tmdb_raw !== 'string') {
                prepared.tmdb_raw = JSON.stringify(prepared.tmdb_raw);
            }

            stmt.run({
                filename,
                tmdb_id: prepared.tmdb_id ?? null,
                title: prepared.title ?? null,
                original_title: prepared.original_title ?? null,
                overview: prepared.overview ?? null,
                poster_path: prepared.poster_path ?? null,
                backdrop_path: prepared.backdrop_path ?? null,
                release_date: prepared.release_date ?? null,
                vote_average: prepared.vote_average ?? null,
                genre_ids: prepared.genre_ids ?? null,
                runtime: prepared.runtime ?? null,
                videos: prepared.videos ?? null,
                recommendations: prepared.recommendations ?? null,
                cast_json: prepared.cast_json ?? null,
                collection_json: prepared.collection_json ?? null,
                cached_at: prepared.cached_at ?? Date.now(),
                tmdb_raw: prepared.tmdb_raw ?? null
            });
        }
    });

    transaction(Object.entries(moviesObj));
}

/**
 * Elimina una pelicula del cache
 * @param {string} filename
 * @returns {boolean} true si se elimino
 */
function deleteMovie(filename) {
    init();
    const info = db.prepare('DELETE FROM movies_cache WHERE filename = ?').run(filename);
    return info.changes > 0;
}

/**
 * Elimina todas las peliculas del cache
 * @returns {number} Numero de peliculas eliminadas
 */
function clearMovies() {
    init();
    const info = db.prepare('DELETE FROM movies_cache').run();
    return info.changes;
}

/**
 * Elimina peliculas huerfanas que ya no existen en el almacenamiento
 * @param {Array<string>} existingFilenames - Lista de filenames que existen actualmente
 * @returns {number} Numero de peliculas eliminadas
 */
function cleanupMovies(existingFilenames) {
    init();

    if (!existingFilenames || existingFilenames.length === 0) {
        return 0;
    }

    // Obtener todos los filenames en cache
    const cachedFilenames = db.prepare('SELECT filename FROM movies_cache').all().map(r => r.filename);

    // Encontrar huerfanos
    const existingSet = new Set(existingFilenames);
    const orphans = cachedFilenames.filter(f => !existingSet.has(f));

    if (orphans.length === 0) return 0;

    // Eliminar huerfanos en transaccion
    const deleteStmt = db.prepare('DELETE FROM movies_cache WHERE filename = ?');
    const transaction = db.transaction((filenames) => {
        for (const filename of filenames) {
            deleteStmt.run(filename);
        }
    });

    transaction(orphans);
    return orphans.length;
}

/**
 * Actualiza la info de codec de una película
 * @param {string} filename
 * @param {Object} codecInfo - { video_codec, audio_codec, audio_channels, bitrate, width, height, duration_seconds }
 */
function updateMovieCodecInfo(filename, codecInfo) {
    init();
    const stmt = db.prepare(`
        UPDATE movies_cache SET
            video_codec = @video_codec,
            audio_codec = @audio_codec,
            audio_channels = @audio_channels,
            bitrate = @bitrate,
            width = @width,
            height = @height,
            duration_seconds = @duration_seconds
        WHERE filename = @filename
    `);
    stmt.run({
        filename,
        video_codec: codecInfo.video_codec || null,
        audio_codec: codecInfo.audio_codec || null,
        audio_channels: codecInfo.audio_channels || null,
        bitrate: codecInfo.bitrate || null,
        width: codecInfo.width || null,
        height: codecInfo.height || null,
        duration_seconds: codecInfo.duration_seconds || null
    });
}

/**
 * Actualiza codec info en batch (transacción)
 * @param {Array} entries - [{ filename, video_codec, audio_codec, ... }, ...]
 */
function updateMovieCodecInfoBatch(entries) {
    init();
    const stmt = db.prepare(`
        UPDATE movies_cache SET
            video_codec = @video_codec,
            audio_codec = @audio_codec,
            audio_channels = @audio_channels,
            bitrate = @bitrate,
            width = @width,
            height = @height,
            duration_seconds = @duration_seconds
        WHERE filename = @filename
    `);
    const transaction = db.transaction((items) => {
        for (const item of items) {
            stmt.run({
                filename: item.filename,
                video_codec: item.video_codec || null,
                audio_codec: item.audio_codec || null,
                audio_channels: item.audio_channels || null,
                bitrate: item.bitrate || null,
                width: item.width || null,
                height: item.height || null,
                duration_seconds: item.duration_seconds || null
            });
        }
    });
    transaction(entries);
}

/**
 * Obtiene películas sin info de codec
 * @returns {Array<string>} filenames sin codec info
 */
function getMoviesWithoutCodecInfo() {
    init();
    return db.prepare('SELECT filename FROM movies_cache WHERE video_codec IS NULL').all().map(r => r.filename);
}

// ============================================================
// Series Cache
// ============================================================

/**
 * Obtiene todas las series como objeto indexado por folder_name
 * Compatible con el formato de cache-series.json
 * @returns {Object} { folderName: seriesData, ... }
 */
function getAllSeries() {
    init();
    const rows = db.prepare('SELECT * FROM series_cache').all();
    const result = {};
    for (const row of rows) {
        const parsed = parseJsonFields(row, SERIES_JSON_FIELDS);
        const folderName = parsed.folder_name;
        delete parsed.folder_name;
        result[folderName] = parsed;
    }
    return result;
}

/**
 * Obtiene una serie por folder_name
 * @param {string} folderName
 * @returns {Object|null}
 */
function getSeries(folderName) {
    init();
    const row = db.prepare('SELECT * FROM series_cache WHERE folder_name = ?').get(folderName);
    if (!row) return null;
    const parsed = parseJsonFields(row, SERIES_JSON_FIELDS);
    delete parsed.folder_name;
    return parsed;
}

/**
 * Inserta o actualiza una serie
 * @param {string} folderName
 * @param {Object} data - Datos de la serie
 */
function upsertSeries(folderName, data) {
    init();
    const prepared = stringifyJsonFields(data, SERIES_JSON_FIELDS);

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO series_cache (
            folder_name, tmdb_id, title, original_title, overview,
            poster_path, backdrop_path, first_air_date, last_air_date,
            vote_average, genre_ids, genres, status, number_of_seasons,
            number_of_episodes, episode_runtime, networks, created_by,
            cast_json, videos, recommendations, seasons_info,
            last_watched, cached_at
        ) VALUES (
            @folder_name, @tmdb_id, @title, @original_title, @overview,
            @poster_path, @backdrop_path, @first_air_date, @last_air_date,
            @vote_average, @genre_ids, @genres, @status, @number_of_seasons,
            @number_of_episodes, @episode_runtime, @networks, @created_by,
            @cast_json, @videos, @recommendations, @seasons_info,
            @last_watched, @cached_at
        )
    `);

    stmt.run({
        folder_name: folderName,
        tmdb_id: prepared.tmdb_id ?? null,
        title: prepared.title ?? null,
        original_title: prepared.original_title ?? null,
        overview: prepared.overview ?? null,
        poster_path: prepared.poster_path ?? null,
        backdrop_path: prepared.backdrop_path ?? null,
        first_air_date: prepared.first_air_date ?? null,
        last_air_date: prepared.last_air_date ?? null,
        vote_average: prepared.vote_average ?? null,
        genre_ids: prepared.genre_ids ?? null,
        genres: prepared.genres ?? null,
        status: prepared.status ?? null,
        number_of_seasons: prepared.number_of_seasons ?? null,
        number_of_episodes: prepared.number_of_episodes ?? null,
        episode_runtime: prepared.episode_runtime ?? null,
        networks: prepared.networks ?? null,
        created_by: prepared.created_by ?? null,
        cast_json: prepared.cast_json ?? null,
        videos: prepared.videos ?? null,
        recommendations: prepared.recommendations ?? null,
        seasons_info: prepared.seasons_info ?? null,
        last_watched: prepared.last_watched ?? null,
        cached_at: prepared.cached_at ?? Date.now()
    });
}

/**
 * Inserta o actualiza multiples series en una transaccion
 * @param {Object} seriesObj - Objeto { folderName: seriesData, ... }
 */
function upsertSeriesBatch(seriesObj) {
    init();

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO series_cache (
            folder_name, tmdb_id, title, original_title, overview,
            poster_path, backdrop_path, first_air_date, last_air_date,
            vote_average, genre_ids, genres, status, number_of_seasons,
            number_of_episodes, episode_runtime, networks, created_by,
            cast_json, videos, recommendations, seasons_info,
            last_watched, cached_at
        ) VALUES (
            @folder_name, @tmdb_id, @title, @original_title, @overview,
            @poster_path, @backdrop_path, @first_air_date, @last_air_date,
            @vote_average, @genre_ids, @genres, @status, @number_of_seasons,
            @number_of_episodes, @episode_runtime, @networks, @created_by,
            @cast_json, @videos, @recommendations, @seasons_info,
            @last_watched, @cached_at
        )
    `);

    const transaction = db.transaction((entries) => {
        for (const [folderName, data] of entries) {
            const prepared = stringifyJsonFields(data, SERIES_JSON_FIELDS);

            stmt.run({
                folder_name: folderName,
                tmdb_id: prepared.tmdb_id ?? null,
                title: prepared.title ?? null,
                original_title: prepared.original_title ?? null,
                overview: prepared.overview ?? null,
                poster_path: prepared.poster_path ?? null,
                backdrop_path: prepared.backdrop_path ?? null,
                first_air_date: prepared.first_air_date ?? null,
                last_air_date: prepared.last_air_date ?? null,
                vote_average: prepared.vote_average ?? null,
                genre_ids: prepared.genre_ids ?? null,
                genres: prepared.genres ?? null,
                status: prepared.status ?? null,
                number_of_seasons: prepared.number_of_seasons ?? null,
                number_of_episodes: prepared.number_of_episodes ?? null,
                episode_runtime: prepared.episode_runtime ?? null,
                networks: prepared.networks ?? null,
                created_by: prepared.created_by ?? null,
                cast_json: prepared.cast_json ?? null,
                videos: prepared.videos ?? null,
                recommendations: prepared.recommendations ?? null,
                seasons_info: prepared.seasons_info ?? null,
                last_watched: prepared.last_watched ?? null,
                cached_at: prepared.cached_at ?? Date.now()
            });
        }
    });

    transaction(Object.entries(seriesObj));
}

/**
 * Elimina una serie del cache
 * @param {string} folderName
 * @returns {boolean} true si se elimino
 */
function deleteSeries(folderName) {
    init();
    const info = db.prepare('DELETE FROM series_cache WHERE folder_name = ?').run(folderName);
    return info.changes > 0;
}

// ============================================================
// Series Episodes
// ============================================================

/**
 * Obtiene todos los episodios como objeto indexado por tmdb_id
 * Compatible con el formato de series-episodes.json
 * @returns {Object} { tmdbId: { seriesTitle, seasons }, ... }
 */
function getAllEpisodes() {
    init();
    const rows = db.prepare('SELECT * FROM series_episodes').all();
    const result = {};
    for (const row of rows) {
        let seasonsData = row.seasons_data;
        if (typeof seasonsData === 'string') {
            try {
                seasonsData = JSON.parse(seasonsData);
            } catch (e) {
                seasonsData = {};
            }
        }
        result[row.tmdb_id] = {
            seriesTitle: row.series_title,
            seasons: seasonsData
        };
    }
    return result;
}

/**
 * Obtiene episodios de una serie por tmdb_id
 * @param {string|number} tmdbId
 * @returns {Object|null} { seriesTitle, seasons }
 */
function getEpisodes(tmdbId) {
    init();
    const row = db.prepare('SELECT * FROM series_episodes WHERE tmdb_id = ?').get(String(tmdbId));
    if (!row) return null;

    let seasonsData = row.seasons_data;
    if (typeof seasonsData === 'string') {
        try {
            seasonsData = JSON.parse(seasonsData);
        } catch (e) {
            seasonsData = {};
        }
    }

    return {
        seriesTitle: row.series_title,
        seasons: seasonsData
    };
}

/**
 * Inserta o actualiza episodios de una serie
 * @param {string|number} tmdbId
 * @param {Object} data - { seriesTitle, seasons } o { series_title, seasons }
 */
function upsertEpisodes(tmdbId, data) {
    init();

    const seriesTitle = data.seriesTitle || data.series_title || null;
    let seasonsData = data.seasons || data.seasons_data || {};

    if (typeof seasonsData !== 'string') {
        seasonsData = JSON.stringify(seasonsData);
    }

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO series_episodes (tmdb_id, series_title, seasons_data)
        VALUES (@tmdb_id, @series_title, @seasons_data)
    `);

    stmt.run({
        tmdb_id: String(tmdbId),
        series_title: seriesTitle,
        seasons_data: seasonsData
    });
}

/**
 * Inserta o actualiza multiples episodios en una transaccion
 * @param {Object} episodesObj - Objeto { tmdbId: { seriesTitle, seasons }, ... }
 */
function upsertEpisodesBatch(episodesObj) {
    init();

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO series_episodes (tmdb_id, series_title, seasons_data)
        VALUES (@tmdb_id, @series_title, @seasons_data)
    `);

    const transaction = db.transaction((entries) => {
        for (const [tmdbId, data] of entries) {
            const seriesTitle = data.seriesTitle || data.series_title || null;
            let seasonsData = data.seasons || data.seasons_data || {};

            if (typeof seasonsData !== 'string') {
                seasonsData = JSON.stringify(seasonsData);
            }

            stmt.run({
                tmdb_id: String(tmdbId),
                series_title: seriesTitle,
                seasons_data: seasonsData
            });
        }
    });

    transaction(Object.entries(episodesObj));
}

/**
 * Elimina episodios de una serie
 * @param {string|number} tmdbId
 * @returns {boolean} true si se elimino
 */
function deleteEpisodes(tmdbId) {
    init();
    const info = db.prepare('DELETE FROM series_episodes WHERE tmdb_id = ?').run(String(tmdbId));
    return info.changes > 0;
}

// ============================================================
// Collections
// ============================================================

/**
 * Obtiene todas las colecciones como objeto indexado por collection_id
 * Compatible con el formato de collections.json
 * @returns {Object} { collectionId: collectionData, ... }
 */
function getAllCollections() {
    init();
    const rows = db.prepare('SELECT * FROM collections').all();
    const result = {};
    for (const row of rows) {
        const parsed = parseJsonFields(row, COLLECTION_JSON_FIELDS);
        const id = parsed.collection_id;
        delete parsed.collection_id;
        result[id] = parsed;
    }
    return result;
}

/**
 * Obtiene una coleccion por ID
 * @param {string} id
 * @returns {Object|null}
 */
function getCollection(id) {
    init();
    const row = db.prepare('SELECT * FROM collections WHERE collection_id = ?').get(String(id));
    if (!row) return null;
    const parsed = parseJsonFields(row, COLLECTION_JSON_FIELDS);
    delete parsed.collection_id;
    return parsed;
}

/**
 * Inserta o actualiza una coleccion
 * @param {string} id
 * @param {Object} data - Datos de la coleccion
 */
function upsertCollection(id, data) {
    init();
    const prepared = stringifyJsonFields(data, COLLECTION_JSON_FIELDS);

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO collections (
            collection_id, name, overview, poster, backdrop,
            movies, genre_ids, cached_at
        ) VALUES (
            @collection_id, @name, @overview, @poster, @backdrop,
            @movies, @genre_ids, @cached_at
        )
    `);

    stmt.run({
        collection_id: String(id),
        name: prepared.name ?? null,
        overview: prepared.overview ?? null,
        poster: prepared.poster ?? null,
        backdrop: prepared.backdrop ?? null,
        movies: prepared.movies ?? null,
        genre_ids: prepared.genre_ids ?? null,
        cached_at: prepared.cached_at ?? Date.now()
    });
}

/**
 * Inserta o actualiza multiples colecciones en una transaccion
 * @param {Object} collectionsObj - Objeto { id: collectionData, ... }
 */
function upsertCollectionsBatch(collectionsObj) {
    init();

    const stmt = db.prepare(`
        INSERT OR REPLACE INTO collections (
            collection_id, name, overview, poster, backdrop,
            movies, genre_ids, cached_at
        ) VALUES (
            @collection_id, @name, @overview, @poster, @backdrop,
            @movies, @genre_ids, @cached_at
        )
    `);

    const transaction = db.transaction((entries) => {
        for (const [id, data] of entries) {
            const prepared = stringifyJsonFields(data, COLLECTION_JSON_FIELDS);

            stmt.run({
                collection_id: String(id),
                name: prepared.name ?? null,
                overview: prepared.overview ?? null,
                poster: prepared.poster ?? null,
                backdrop: prepared.backdrop ?? null,
                movies: prepared.movies ?? null,
                genre_ids: prepared.genre_ids ?? null,
                cached_at: prepared.cached_at ?? Date.now()
            });
        }
    });

    transaction(Object.entries(collectionsObj));
}

/**
 * Elimina una coleccion
 * @param {string} id
 * @returns {boolean} true si se elimino
 */
function deleteCollection(id) {
    init();
    const info = db.prepare('DELETE FROM collections WHERE collection_id = ?').run(String(id));
    return info.changes > 0;
}

// ============================================================
// Download Queue
// ============================================================

/**
 * Obtiene toda la cola de descargas como array
 * @returns {Array}
 */
function getQueue() {
    init();
    return db.prepare('SELECT * FROM download_queue ORDER BY id ASC').all();
}

/**
 * Agrega un item a la cola de descargas
 * @param {Object} item - { url, title, status, output_path, request_id }
 * @returns {Object} Item creado
 */
function addToQueue(item) {
    init();

    const stmt = db.prepare(`
        INSERT INTO download_queue (url, title, status, output_path, request_id, added_at)
        VALUES (@url, @title, @status, @output_path, @request_id, @added_at)
    `);

    const info = stmt.run({
        url: item.url,
        title: item.title ?? null,
        status: item.status ?? 'pending',
        output_path: item.output_path ?? item.outputPath ?? null,
        request_id: item.request_id ?? item.requestId ?? null,
        added_at: item.added_at ?? item.addedAt ?? new Date().toISOString()
    });

    return db.prepare('SELECT * FROM download_queue WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Actualiza un item de la cola por URL
 * @param {string} url
 * @param {Object} data - Campos a actualizar
 * @returns {boolean} true si se actualizo
 */
function updateQueueItem(url, data) {
    init();

    const updates = [];
    const params = { url };

    if (data.status !== undefined) {
        updates.push('status = @status');
        params.status = data.status;
    }
    if (data.title !== undefined) {
        updates.push('title = @title');
        params.title = data.title;
    }
    if (data.output_path !== undefined || data.outputPath !== undefined) {
        updates.push('output_path = @output_path');
        params.output_path = data.output_path ?? data.outputPath;
    }
    if (data.completed_at !== undefined || data.completedAt !== undefined) {
        updates.push('completed_at = @completed_at');
        params.completed_at = data.completed_at ?? data.completedAt;
    }

    if (updates.length === 0) return false;

    const stmt = db.prepare(`UPDATE download_queue SET ${updates.join(', ')} WHERE url = @url`);
    const info = stmt.run(params);
    return info.changes > 0;
}

/**
 * Elimina un item de la cola por URL
 * @param {string} url
 * @returns {boolean} true si se elimino
 */
function removeFromQueue(url) {
    init();
    const info = db.prepare('DELETE FROM download_queue WHERE url = ?').run(url);
    return info.changes > 0;
}

/**
 * Limpia toda la cola de descargas
 * @returns {number} Numero de items eliminados
 */
function clearQueue() {
    init();
    const info = db.prepare('DELETE FROM download_queue').run();
    return info.changes;
}

// ============================================================
// Utilidades generales
// ============================================================

/**
 * Obtiene la instancia raw de la BD (para operaciones avanzadas)
 * @returns {Database}
 */
function getDb() {
    init();
    return db;
}

/**
 * Cierra la conexion a la base de datos
 */
function close() {
    if (db) {
        db.close();
        db = null;
        console.log('🗄️  Base de datos media cerrada');
    }
}

// Cerrar conexion al salir
process.on('exit', close);
process.on('SIGINT', () => { close(); process.exit(); });
process.on('SIGTERM', () => { close(); process.exit(); });

module.exports = {
    init,

    // Movies Cache
    getAllMovies,
    getMovie,
    upsertMovie,
    upsertMoviesBatch,
    deleteMovie,
    clearMovies,
    cleanupMovies,
    updateMovieCodecInfo,
    updateMovieCodecInfoBatch,
    getMoviesWithoutCodecInfo,

    // Series Cache
    getAllSeries,
    getSeries,
    upsertSeries,
    upsertSeriesBatch,
    deleteSeries,

    // Series Episodes
    getAllEpisodes,
    getEpisodes,
    upsertEpisodes,
    upsertEpisodesBatch,
    deleteEpisodes,

    // Collections
    getAllCollections,
    getCollection,
    upsertCollection,
    upsertCollectionsBatch,
    deleteCollection,

    // Download Queue
    getQueue,
    addToQueue,
    updateQueueItem,
    removeFromQueue,
    clearQueue,

    // Utilities
    getDb,
    close
};
