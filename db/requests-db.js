/**
 * Módulo de Base de Datos SQLite para Peticiones de Películas
 * Reemplaza el sistema JSON anterior para mayor robustez
 *
 * @author IsiPrime
 * @version 1.0.0
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Ruta de la base de datos
const DB_PATH = path.join(__dirname, '..', 'requests.db');
const JSON_PATH = path.join(__dirname, '..', 'movie-requests.json');
const JSON_MIGRATED_PATH = path.join(__dirname, '..', 'movie-requests.json.migrated');

// Instancia de la base de datos (singleton)
let db = null;

// Estados válidos para peticiones
const VALID_STATUSES = ['pending', 'downloading', 'downloaded', 'mp4', 'server', 'rejected'];

/**
 * Inicializa la base de datos y crea las tablas si no existen
 * También migra datos desde JSON si es necesario
 */
function init() {
    if (db) return db;

    console.log('🗄️  Inicializando base de datos SQLite...');

    // Crear conexión
    db = new Database(DB_PATH);

    // Habilitar WAL mode para mejor rendimiento y concurrencia
    db.pragma('journal_mode = WAL');

    // Crear tabla de peticiones
    db.exec(`
        CREATE TABLE IF NOT EXISTS requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tmdb_id INTEGER,
            title TEXT NOT NULL,
            original_title TEXT,
            year TEXT,
            poster TEXT,
            overview TEXT,
            rating REAL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'downloading', 'downloaded', 'mp4', 'server', 'rejected')),
            requested_by TEXT DEFAULT 'Usuario',
            admin_notes TEXT,
            requested_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        -- Índices para búsquedas frecuentes
        CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
        CREATE INDEX IF NOT EXISTS idx_requests_tmdb_id ON requests(tmdb_id);
        CREATE INDEX IF NOT EXISTS idx_requests_updated_at ON requests(updated_at);
    `);

    // Crear trigger para actualizar updated_at automáticamente
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS update_requests_timestamp
        AFTER UPDATE ON requests
        FOR EACH ROW
        WHEN NEW.updated_at = OLD.updated_at
        BEGIN
            UPDATE requests SET updated_at = datetime('now') WHERE id = NEW.id;
        END;
    `);

    console.log('🗄️  Tablas SQLite creadas/verificadas');

    // Migrar desde JSON si existe y la BD está vacía
    const count = db.prepare('SELECT COUNT(*) as count FROM requests').get().count;
    if (count === 0 && fs.existsSync(JSON_PATH)) {
        migrateFromJSON();
    }

    console.log(`🗄️  Base de datos lista (${getStats().total} peticiones)`);
    return db;
}

/**
 * Migra datos desde el archivo JSON existente
 */
function migrateFromJSON() {
    console.log('📦 Migrando datos desde JSON a SQLite...');

    try {
        const content = fs.readFileSync(JSON_PATH, 'utf8');
        const data = JSON.parse(content);

        if (!data.requests || !Array.isArray(data.requests)) {
            console.log('⚠️  JSON no contiene peticiones válidas');
            return;
        }

        const insert = db.prepare(`
            INSERT INTO requests (
                id, tmdb_id, title, original_title, year, poster, overview,
                rating, status, requested_by, admin_notes, requested_at, updated_at
            ) VALUES (
                @id, @tmdb_id, @title, @original_title, @year, @poster, @overview,
                @rating, @status, @requested_by, @admin_notes, @requested_at, @updated_at
            )
        `);

        const transaction = db.transaction((requests) => {
            for (const req of requests) {
                insert.run({
                    id: req.id,
                    tmdb_id: req.tmdbId || null,
                    title: req.title,
                    original_title: req.originalTitle || null,
                    year: req.year || null,
                    poster: req.poster || null,
                    overview: req.overview || null,
                    rating: req.rating || null,
                    status: VALID_STATUSES.includes(req.status) ? req.status : 'pending',
                    requested_by: req.requestedBy || 'Usuario',
                    admin_notes: req.adminNotes || null,
                    requested_at: req.requestedAt || new Date().toISOString(),
                    updated_at: req.updatedAt || new Date().toISOString()
                });
            }
        });

        transaction(data.requests);

        // Renombrar el archivo JSON para indicar que fue migrado
        fs.renameSync(JSON_PATH, JSON_MIGRATED_PATH);

        console.log(`✅ Migración completada: ${data.requests.length} peticiones migradas`);
        console.log(`📁 Archivo JSON renombrado a: movie-requests.json.migrated`);

    } catch (error) {
        console.error('❌ Error en migración:', error.message);
    }
}

/**
 * Obtiene todas las peticiones
 * @param {string} [status] - Filtrar por estado (opcional)
 * @returns {Array} Lista de peticiones
 */
function getAll(status = null) {
    init();

    let stmt;
    if (status && VALID_STATUSES.includes(status)) {
        stmt = db.prepare('SELECT * FROM requests WHERE status = ? ORDER BY id DESC');
        return stmt.all(status).map(mapToLegacyFormat);
    } else {
        stmt = db.prepare('SELECT * FROM requests ORDER BY id DESC');
        return stmt.all().map(mapToLegacyFormat);
    }
}

/**
 * Obtiene una petición por ID
 * @param {number} id
 * @returns {Object|null}
 */
function getById(id) {
    init();
    const stmt = db.prepare('SELECT * FROM requests WHERE id = ?');
    const row = stmt.get(id);
    return row ? mapToLegacyFormat(row) : null;
}

/**
 * Obtiene una petición por TMDB ID
 * @param {number} tmdbId
 * @returns {Object|null}
 */
function getByTmdbId(tmdbId) {
    init();
    const stmt = db.prepare('SELECT * FROM requests WHERE tmdb_id = ?');
    const row = stmt.get(tmdbId);
    return row ? mapToLegacyFormat(row) : null;
}

/**
 * Crea una nueva petición
 * @param {Object} data - Datos de la petición
 * @returns {Object} Petición creada
 */
function create(data) {
    init();

    const now = new Date().toISOString();

    const stmt = db.prepare(`
        INSERT INTO requests (
            tmdb_id, title, original_title, year, poster, overview,
            rating, status, requested_by, admin_notes, requested_at, updated_at
        ) VALUES (
            @tmdb_id, @title, @original_title, @year, @poster, @overview,
            @rating, @status, @requested_by, @admin_notes, @requested_at, @updated_at
        )
    `);

    const info = stmt.run({
        tmdb_id: data.tmdbId || null,
        title: data.title,
        original_title: data.originalTitle || null,
        year: data.year || null,
        poster: data.poster || null,
        overview: data.overview || null,
        rating: data.rating || null,
        status: VALID_STATUSES.includes(data.status) ? data.status : 'pending',
        requested_by: data.requestedBy || 'Usuario',
        admin_notes: data.adminNotes || null,
        requested_at: now,
        updated_at: now
    });

    return getById(info.lastInsertRowid);
}

/**
 * Crea múltiples peticiones en una transacción
 * @param {Array} items - Array de datos de peticiones
 * @param {string} requestedBy - Quién realiza la petición
 * @returns {Object} Resultado { created, duplicates }
 */
function createMany(items, requestedBy = 'Usuario') {
    init();

    const now = new Date().toISOString();
    let created = 0;
    let duplicates = 0;

    const checkStmt = db.prepare('SELECT id FROM requests WHERE tmdb_id = ?');
    const insertStmt = db.prepare(`
        INSERT INTO requests (
            tmdb_id, title, original_title, year, poster, overview,
            rating, status, requested_by, requested_at, updated_at
        ) VALUES (
            @tmdb_id, @title, @original_title, @year, @poster, @overview,
            @rating, @status, @requested_by, @requested_at, @updated_at
        )
    `);

    const transaction = db.transaction((movies) => {
        for (const movie of movies) {
            const tmdbId = movie.tmdbId || movie.tmdb_id || movie.id;

            // Verificar duplicado
            if (tmdbId && checkStmt.get(tmdbId)) {
                duplicates++;
                continue;
            }

            insertStmt.run({
                tmdb_id: tmdbId || null,
                title: movie.title,
                original_title: movie.originalTitle || movie.original_title || null,
                year: movie.year || (movie.release_date ? movie.release_date.split('-')[0] : null),
                poster: movie.poster || (movie.poster_path ? `https://image.tmdb.org/t/p/w342${movie.poster_path}` : null),
                overview: movie.overview || null,
                rating: movie.rating || movie.vote_average || null,
                status: 'pending',
                requested_by: requestedBy,
                requested_at: now,
                updated_at: now
            });
            created++;
        }
    });

    transaction(items);

    return { created, duplicates, total: getStats().total };
}

/**
 * Actualiza una petición
 * @param {number} id - ID de la petición
 * @param {Object} data - Datos a actualizar (status, adminNotes)
 * @returns {Object|null} Petición actualizada
 */
function update(id, data) {
    init();

    const updates = [];
    const params = { id };

    if (data.status && VALID_STATUSES.includes(data.status)) {
        updates.push('status = @status');
        params.status = data.status;
    }

    if (data.adminNotes !== undefined) {
        updates.push('admin_notes = @admin_notes');
        params.admin_notes = data.adminNotes;
    }

    if (updates.length === 0) {
        return getById(id);
    }

    // Siempre actualizar updated_at
    updates.push('updated_at = @updated_at');
    params.updated_at = new Date().toISOString();

    const stmt = db.prepare(`UPDATE requests SET ${updates.join(', ')} WHERE id = @id`);
    const info = stmt.run(params);

    if (info.changes === 0) {
        return null;
    }

    return getById(id);
}

/**
 * Actualiza el estado de múltiples peticiones por TMDB ID
 * @param {Array<number>} tmdbIds - Lista de TMDB IDs
 * @param {string} newStatus - Nuevo estado
 * @returns {number} Número de peticiones actualizadas
 */
function updateManyByTmdbId(tmdbIds, newStatus) {
    init();

    if (!VALID_STATUSES.includes(newStatus) || tmdbIds.length === 0) {
        return 0;
    }

    const now = new Date().toISOString();
    const placeholders = tmdbIds.map(() => '?').join(',');
    const stmt = db.prepare(`
        UPDATE requests
        SET status = ?, updated_at = ?
        WHERE tmdb_id IN (${placeholders}) AND status != ?
    `);

    const info = stmt.run(newStatus, now, ...tmdbIds, newStatus);
    return info.changes;
}

/**
 * Elimina una petición
 * @param {number} id
 * @returns {boolean} true si se eliminó
 */
function remove(id) {
    init();
    const stmt = db.prepare('DELETE FROM requests WHERE id = ?');
    const info = stmt.run(id);
    return info.changes > 0;
}

/**
 * Elimina peticiones antiguas completadas
 * @param {number} daysOld - Días de antigüedad (default: 7)
 * @returns {number} Número de peticiones eliminadas
 */
function removeOldCompleted(daysOld = 7) {
    init();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();

    const stmt = db.prepare(`
        DELETE FROM requests
        WHERE status IN ('downloaded', 'server')
        AND requested_at < ?
    `);

    const info = stmt.run(cutoffISO);

    if (info.changes > 0) {
        console.log(`🗑️  Auto-eliminadas ${info.changes} peticiones antiguas (>7 días)`);
    }

    return info.changes;
}

/**
 * Obtiene estadísticas de peticiones
 * @returns {Object} Estadísticas por estado
 */
function getStats() {
    init();

    const stmt = db.prepare(`
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'downloading' THEN 1 ELSE 0 END) as downloading,
            SUM(CASE WHEN status = 'downloaded' THEN 1 ELSE 0 END) as downloaded,
            SUM(CASE WHEN status = 'mp4' THEN 1 ELSE 0 END) as mp4,
            SUM(CASE WHEN status = 'server' THEN 1 ELSE 0 END) as server,
            SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
        FROM requests
    `);

    return stmt.get();
}

/**
 * Obtiene todos los TMDB IDs de peticiones
 * @returns {Array<number>}
 */
function getAllTmdbIds() {
    init();
    const stmt = db.prepare('SELECT tmdb_id FROM requests WHERE tmdb_id IS NOT NULL');
    return stmt.all().map(row => row.tmdb_id);
}

/**
 * Convierte formato de BD a formato legacy (camelCase)
 * Para mantener compatibilidad con el frontend existente
 */
function mapToLegacyFormat(row) {
    return {
        id: row.id,
        tmdbId: row.tmdb_id,
        title: row.title,
        originalTitle: row.original_title,
        year: row.year,
        poster: row.poster,
        overview: row.overview,
        rating: row.rating,
        status: row.status,
        requestedBy: row.requested_by,
        adminNotes: row.admin_notes,
        requestedAt: row.requested_at,
        updatedAt: row.updated_at
    };
}

/**
 * Cierra la conexión a la base de datos
 */
function close() {
    if (db) {
        db.close();
        db = null;
        console.log('🗄️  Base de datos cerrada');
    }
}

// Cerrar conexión al salir
process.on('exit', close);
process.on('SIGINT', () => { close(); process.exit(); });
process.on('SIGTERM', () => { close(); process.exit(); });

module.exports = {
    init,
    getAll,
    getById,
    getByTmdbId,
    create,
    createMany,
    update,
    updateManyByTmdbId,
    remove,
    removeOldCompleted,
    getStats,
    getAllTmdbIds,
    close,
    VALID_STATUSES
};
