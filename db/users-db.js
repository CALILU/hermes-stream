/**
 * Modulo de Base de Datos SQLite para Usuarios y Autenticacion
 * Gestiona usuarios, sesiones, progreso de visualizacion, favoritos e invitaciones
 *
 * Usa isiprime.db (compartida con media-db.js) - WAL mode permite multiples conexiones
 *
 * @author IsiPrime
 * @version 1.0.0
 */

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// Ruta de la base de datos (misma que media-db.js)
const DB_PATH = path.join(__dirname, '..', 'isiprime.db');

// Instancia de la base de datos (singleton independiente de media-db.js)
let db = null;

// Hash SHA256 por defecto del admin (admin123) - se migrara a bcrypt en primer login
const DEFAULT_ADMIN_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9';

/**
 * Inicializa la base de datos y crea las tablas si no existen
 * Si no hay usuarios, inserta el admin por defecto
 */
function init() {
    if (db) return db;

    console.log('🔐 Inicializando base de datos de usuarios SQLite...');

    // Crear conexion
    db = new Database(DB_PATH);

    // Habilitar WAL mode y foreign keys
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Crear tabla de usuarios
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            display_name TEXT,
            role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'viewer')),
            invited_by INTEGER REFERENCES users(id),
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_login DATETIME,
            active INTEGER DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);

    // Crear tabla de sesiones
    db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            refresh_token TEXT UNIQUE NOT NULL,
            device_info TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            revoked INTEGER DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token);
    `);

    // Crear tabla de progreso de visualizacion
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            video_path TEXT NOT NULL,
            position_seconds REAL DEFAULT 0,
            duration_seconds REAL,
            completed INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, video_path)
        );
        CREATE INDEX IF NOT EXISTS idx_progress_user ON user_progress(user_id);
        CREATE INDEX IF NOT EXISTS idx_progress_lookup ON user_progress(user_id, video_path);
        CREATE INDEX IF NOT EXISTS idx_progress_recent ON user_progress(user_id, updated_at DESC);
    `);

    // Crear tabla de favoritos
    db.exec(`
        CREATE TABLE IF NOT EXISTS user_favorites (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            video_path TEXT NOT NULL,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, video_path)
        );
        CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id);
    `);

    // Crear tabla de invitaciones
    db.exec(`
        CREATE TABLE IF NOT EXISTS invitations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            created_by INTEGER NOT NULL REFERENCES users(id),
            role TEXT DEFAULT 'viewer',
            expires_at DATETIME NOT NULL,
            used_by INTEGER REFERENCES users(id),
            used_at DATETIME
        );
        CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
    `);

    // Migrar: añadir columna role a invitaciones si no existe
    try {
        db.prepare("SELECT role FROM invitations LIMIT 1").get();
    } catch (e) {
        db.exec("ALTER TABLE invitations ADD COLUMN role TEXT DEFAULT 'viewer'");
        console.log('🔐 Columna role añadida a invitations');
    }

    // Migrar: añadir columna email a users si no existe
    try { db.prepare("SELECT email FROM users LIMIT 1").get(); } catch(e) {
        db.exec("ALTER TABLE users ADD COLUMN email TEXT");
        console.log('🔐 Columna email añadida a users');
    }
    try { db.prepare("SELECT email_notifications FROM users LIMIT 1").get(); } catch(e) {
        db.exec("ALTER TABLE users ADD COLUMN email_notifications INTEGER DEFAULT 1");
        console.log('🔐 Columna email_notifications añadida a users');
    }

    // Crear tabla de logs de newsletter
    db.exec(`
        CREATE TABLE IF NOT EXISTS newsletter_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            subject TEXT NOT NULL,
            movie_count INTEGER DEFAULT 0,
            recipients_count INTEGER DEFAULT 0,
            sent_by INTEGER REFERENCES users(id),
            sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status TEXT DEFAULT 'sent'
        );
    `);

    // Crear tabla de peliculas enviadas por newsletter
    db.exec(`
        CREATE TABLE IF NOT EXISTS newsletter_movies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            newsletter_id INTEGER REFERENCES newsletter_logs(id),
            filename TEXT NOT NULL,
            title TEXT,
            sent_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_newsletter_movies_filename ON newsletter_movies(filename);`);

    console.log('🔐 Tablas de usuarios SQLite creadas/verificadas');

    // Seed admin si no hay usuarios
    const count = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (count === 0) {
        seedAdmin();
    }

    const userCount = db.prepare('SELECT COUNT(*) as count FROM users WHERE active = 1').get().count;
    console.log(`🔐 Base de datos de usuarios lista (${userCount} usuarios activos)`);

    return db;
}

/**
 * Inserta el usuario admin por defecto
 */
function seedAdmin() {
    console.log('🔐 Creando usuario admin por defecto...');

    db.prepare(`
        INSERT INTO users (username, password_hash, display_name, role)
        VALUES (@username, @password_hash, @display_name, @role)
    `).run({
        username: 'admin',
        password_hash: DEFAULT_ADMIN_HASH,
        display_name: 'Administrador',
        role: 'admin'
    });

    console.log('🔐 Usuario admin creado (usuario: admin, contraseña: admin123)');
}

// ============================================================
// Users
// ============================================================

/**
 * Obtiene un usuario por username
 * @param {string} username
 * @returns {Object|null} Fila del usuario o null
 */
function getUserByUsername(username) {
    init();
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username) || null;
}

/**
 * Obtiene un usuario por ID
 * @param {number} id
 * @returns {Object|null} Fila del usuario o null
 */
function getUserById(id) {
    init();
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

/**
 * Crea un nuevo usuario
 * @param {Object} data - { username, passwordHash, role, displayName, invitedBy }
 * @returns {Object} Usuario creado
 */
function createUser({ username, passwordHash, role, displayName, invitedBy }) {
    init();

    const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, display_name, role, invited_by)
        VALUES (@username, @password_hash, @display_name, @role, @invited_by)
    `);

    const info = stmt.run({
        username,
        password_hash: passwordHash,
        display_name: displayName || null,
        role: role || 'viewer',
        invited_by: invitedBy || null
    });

    return getUserById(info.lastInsertRowid);
}

/**
 * Actualiza campos de un usuario
 * @param {number} id - ID del usuario
 * @param {Object} data - Campos a actualizar (password_hash, display_name, role, active, last_login)
 * @returns {Object|null} Usuario actualizado o null si no existe
 */
function updateUser(id, data) {
    init();

    const updates = [];
    const params = { id };

    if (data.password_hash !== undefined) {
        updates.push('password_hash = @password_hash');
        params.password_hash = data.password_hash;
    }
    if (data.display_name !== undefined) {
        updates.push('display_name = @display_name');
        params.display_name = data.display_name;
    }
    if (data.role !== undefined) {
        updates.push('role = @role');
        params.role = data.role;
    }
    if (data.active !== undefined) {
        updates.push('active = @active');
        params.active = data.active;
    }
    if (data.last_login !== undefined) {
        updates.push('last_login = @last_login');
        params.last_login = data.last_login;
    }
    if (data.email !== undefined) {
        updates.push('email = @email');
        params.email = data.email;
    }
    if (data.email_notifications !== undefined) {
        updates.push('email_notifications = @email_notifications');
        params.email_notifications = data.email_notifications;
    }

    if (updates.length === 0) {
        return getUserById(id);
    }

    const stmt = db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = @id`);
    const info = stmt.run(params);

    if (info.changes === 0) {
        return null;
    }

    return getUserById(id);
}

/**
 * Obtiene todos los usuarios (sin password_hash)
 * @returns {Array} Lista de usuarios
 */
function getAllUsers() {
    init();
    return db.prepare(`
        SELECT id, username, display_name, role, invited_by, created_at, last_login, active, email, email_notifications
        FROM users
        ORDER BY id ASC
    `).all();
}

/**
 * Soft-delete de un usuario (active=0)
 * @param {number} id
 * @returns {boolean} true si se desactivo
 */
function deleteUser(id) {
    init();
    const info = db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
    return info.changes > 0;
}

// ============================================================
// Sessions
// ============================================================

/**
 * Crea una nueva sesion
 * @param {Object} data - { userId, refreshToken, deviceInfo, ipAddress, expiresAt }
 * @returns {Object} Sesion creada
 */
function createSession({ userId, refreshToken, deviceInfo, ipAddress, expiresAt }) {
    init();

    const stmt = db.prepare(`
        INSERT INTO sessions (user_id, refresh_token, device_info, ip_address, expires_at)
        VALUES (@user_id, @refresh_token, @device_info, @ip_address, @expires_at)
    `);

    const info = stmt.run({
        user_id: userId,
        refresh_token: refreshToken,
        device_info: deviceInfo || null,
        ip_address: ipAddress || null,
        expires_at: expiresAt instanceof Date ? expiresAt.toISOString() : expiresAt
    });

    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid);
}

/**
 * Obtiene una sesion por refresh token (solo no revocadas y no expiradas)
 * @param {string} refreshToken
 * @returns {Object|null} Sesion o null
 */
function getSessionByToken(refreshToken) {
    init();
    return db.prepare(`
        SELECT * FROM sessions
        WHERE refresh_token = ?
        AND revoked = 0
        AND expires_at > datetime('now')
    `).get(refreshToken) || null;
}

/**
 * Obtiene una sesion por ID
 * @param {number} id
 * @returns {Object|null} Sesion o null
 */
function getSessionById(id) {
    init();
    return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
}

/**
 * Revoca una sesion por ID
 * @param {number} id
 * @returns {boolean} true si se revoco
 */
function revokeSession(id) {
    init();
    const info = db.prepare('UPDATE sessions SET revoked = 1 WHERE id = ?').run(id);
    return info.changes > 0;
}

/**
 * Revoca todas las sesiones de un usuario
 * @param {number} userId
 * @returns {number} Numero de sesiones revocadas
 */
function revokeAllUserSessions(userId) {
    init();
    const info = db.prepare('UPDATE sessions SET revoked = 1 WHERE user_id = ? AND revoked = 0').run(userId);
    return info.changes;
}

/**
 * Obtiene todas las sesiones activas de un usuario
 * @param {number} userId
 * @returns {Array} Lista de sesiones activas
 */
function getUserSessions(userId) {
    init();
    return db.prepare(`
        SELECT * FROM sessions
        WHERE user_id = ?
        AND revoked = 0
        AND expires_at > datetime('now')
        ORDER BY created_at DESC
    `).all(userId);
}

/**
 * Elimina sesiones expiradas o revocadas
 * @returns {number} Numero de sesiones eliminadas
 */
function cleanExpiredSessions() {
    init();
    const info = db.prepare(`
        DELETE FROM sessions
        WHERE revoked = 1 OR expires_at <= datetime('now')
    `).run();

    if (info.changes > 0) {
        console.log(`🔐 Limpiadas ${info.changes} sesiones expiradas/revocadas`);
    }

    return info.changes;
}

// ============================================================
// Progress
// ============================================================

/**
 * Inserta o actualiza el progreso de visualizacion
 * Auto-marca como completado si position/duration > 0.9
 * @param {number} userId
 * @param {string} videoPath
 * @param {number} position - Posicion en segundos
 * @param {number} duration - Duracion total en segundos
 * @returns {Object} Registro de progreso
 */
function upsertProgress(userId, videoPath, position, duration) {
    init();

    const completed = (duration && duration > 0 && position / duration > 0.9) ? 1 : 0;

    const stmt = db.prepare(`
        INSERT INTO user_progress (user_id, video_path, position_seconds, duration_seconds, completed, updated_at)
        VALUES (@user_id, @video_path, @position_seconds, @duration_seconds, @completed, datetime('now'))
        ON CONFLICT(user_id, video_path) DO UPDATE SET
            position_seconds = @position_seconds,
            duration_seconds = @duration_seconds,
            completed = @completed,
            updated_at = datetime('now')
    `);

    stmt.run({
        user_id: userId,
        video_path: videoPath,
        position_seconds: position,
        duration_seconds: duration || null,
        completed
    });

    return getProgress(userId, videoPath);
}

/**
 * Obtiene el progreso de un video para un usuario
 * @param {number} userId
 * @param {string} videoPath
 * @returns {Object|null} Registro de progreso o null
 */
function getProgress(userId, videoPath) {
    init();
    return db.prepare(`
        SELECT * FROM user_progress
        WHERE user_id = ? AND video_path = ?
    `).get(userId, videoPath) || null;
}

/**
 * Obtiene videos para "Continuar Viendo" (incompletos, posicion > 30s)
 * @param {number} userId
 * @param {number} [limit=20] - Maximo de resultados
 * @returns {Array} Lista de progreso ordenada por updated_at DESC
 */
function getContinueWatching(userId, limit = 20) {
    init();
    return db.prepare(`
        SELECT * FROM user_progress
        WHERE user_id = ?
        AND completed = 0
        AND position_seconds > 30
        ORDER BY updated_at DESC
        LIMIT ?
    `).all(userId, limit);
}

/**
 * Obtiene todo el progreso de un usuario
 * @param {number} userId
 * @returns {Array} Lista completa de progreso
 */
function getAllProgress(userId) {
    init();
    return db.prepare(`
        SELECT * FROM user_progress
        WHERE user_id = ?
        ORDER BY updated_at DESC
    `).all(userId);
}

/**
 * Elimina un registro de progreso
 * @param {number} userId
 * @param {string} videoPath
 * @returns {boolean} true si se elimino
 */
function deleteProgress(userId, videoPath) {
    init();
    const info = db.prepare('DELETE FROM user_progress WHERE user_id = ? AND video_path = ?').run(userId, videoPath);
    return info.changes > 0;
}

// ============================================================
// Favorites
// ============================================================

/**
 * Agrega un video a favoritos
 * @param {number} userId
 * @param {string} videoPath
 * @returns {boolean} true si se agrego (false si ya existia)
 */
function addFavorite(userId, videoPath) {
    init();
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO user_favorites (user_id, video_path)
        VALUES (?, ?)
    `);
    const info = stmt.run(userId, videoPath);
    return info.changes > 0;
}

/**
 * Elimina un video de favoritos
 * @param {number} userId
 * @param {string} videoPath
 * @returns {boolean} true si se elimino
 */
function removeFavorite(userId, videoPath) {
    init();
    const info = db.prepare('DELETE FROM user_favorites WHERE user_id = ? AND video_path = ?').run(userId, videoPath);
    return info.changes > 0;
}

/**
 * Obtiene todos los favoritos de un usuario
 * @param {number} userId
 * @returns {Array<string>} Lista de video_path
 */
function getFavorites(userId) {
    init();
    return db.prepare(`
        SELECT video_path FROM user_favorites
        WHERE user_id = ?
        ORDER BY added_at DESC
    `).all(userId).map(row => row.video_path);
}

/**
 * Verifica si un video es favorito del usuario
 * @param {number} userId
 * @param {string} videoPath
 * @returns {boolean}
 */
function isFavorite(userId, videoPath) {
    init();
    const row = db.prepare(`
        SELECT 1 FROM user_favorites
        WHERE user_id = ? AND video_path = ?
    `).get(userId, videoPath);
    return !!row;
}

// ============================================================
// Invitations
// ============================================================

/**
 * Crea una invitacion con codigo aleatorio
 * @param {number} createdBy - ID del usuario que crea la invitacion
 * @param {string} expiresAt - Fecha de expiracion ISO string
 * @param {string} [role='viewer'] - Rol asignado al registrarse
 * @returns {Object} { code, expiresAt, role }
 */
function createInvitation(createdBy, expiresAt, role) {
    init();

    const code = crypto.randomBytes(16).toString('hex');
    const invitationRole = role || 'viewer';

    db.prepare(`
        INSERT INTO invitations (code, created_by, expires_at, role)
        VALUES (@code, @created_by, @expires_at, @role)
    `).run({
        code,
        created_by: createdBy,
        expires_at: expiresAt,
        role: invitationRole
    });

    return { code, expiresAt, role: invitationRole };
}

/**
 * Obtiene una invitacion por codigo (solo no usadas y no expiradas)
 * @param {string} code
 * @returns {Object|null} Invitacion o null
 */
function getInvitationByCode(code) {
    init();
    return db.prepare(`
        SELECT * FROM invitations
        WHERE code = ?
        AND used_by IS NULL
        AND expires_at > datetime('now')
    `).get(code) || null;
}

/**
 * Marca una invitacion como usada
 * @param {string} code
 * @param {number} usedBy - ID del usuario que la usa
 * @returns {boolean} true si se marco
 */
function useInvitation(code, usedBy) {
    init();
    const info = db.prepare(`
        UPDATE invitations
        SET used_by = ?, used_at = datetime('now')
        WHERE code = ? AND used_by IS NULL
    `).run(usedBy, code);
    return info.changes > 0;
}

/**
 * Obtiene todas las invitaciones creadas por un usuario
 * @param {number} createdBy - ID del creador
 * @returns {Array} Lista de invitaciones
 */
function getInvitations(createdBy) {
    init();
    return db.prepare(`
        SELECT * FROM invitations
        WHERE created_by = ?
        ORDER BY id DESC
    `).all(createdBy);
}

/**
 * Elimina una invitacion (solo si no ha sido usada)
 * @param {number} id
 * @returns {boolean} true si se elimino
 */
function deleteInvitation(id) {
    init();
    const info = db.prepare('DELETE FROM invitations WHERE id = ? AND used_by IS NULL').run(id);
    return info.changes > 0;
}

// ============================================================
// Utilidades
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
        console.log('🔐 Base de datos de usuarios cerrada');
    }
}

// ============================================================
// Newsletter
// ============================================================

function getUsersWithEmail() {
    init();
    return db.prepare(`
        SELECT id, username, display_name, email
        FROM users
        WHERE active = 1 AND email IS NOT NULL AND email != '' AND email_notifications = 1
    `).all();
}

function updateUserEmail(id, email, emailNotifications) {
    init();
    const updates = [];
    const params = { id };
    if (email !== undefined) { updates.push('email = @email'); params.email = email; }
    if (emailNotifications !== undefined) { updates.push('email_notifications = @email_notifications'); params.email_notifications = emailNotifications ? 1 : 0; }
    if (updates.length === 0) return getUserById(id);
    db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = @id`).run(params);
    return getUserById(id);
}

function logNewsletter({ subject, movieCount, recipientsCount, sentBy, status }) {
    init();
    const stmt = db.prepare(`
        INSERT INTO newsletter_logs (subject, movie_count, recipients_count, sent_by, status)
        VALUES (@subject, @movie_count, @recipients_count, @sent_by, @status)
    `);
    const info = stmt.run({
        subject,
        movie_count: movieCount,
        recipients_count: recipientsCount,
        sent_by: sentBy,
        status: status || 'sent'
    });
    return db.prepare('SELECT * FROM newsletter_logs WHERE id = ?').get(info.lastInsertRowid);
}

function logNewsletterMovies(newsletterId, movies) {
    init();
    const stmt = db.prepare(`
        INSERT INTO newsletter_movies (newsletter_id, filename, title)
        VALUES (@newsletter_id, @filename, @title)
    `);
    const insertMany = db.transaction((items) => {
        for (const m of items) {
            stmt.run({
                newsletter_id: newsletterId,
                filename: m.filename || m.title || '',
                title: m.title || m.filename || ''
            });
        }
    });
    insertMany(movies);
}

function getSentMovieFilenames() {
    init();
    return db.prepare(`
        SELECT DISTINCT filename FROM newsletter_movies
    `).all().map(r => r.filename);
}

function deleteNewsletterLog(id) {
    init();
    db.prepare('DELETE FROM newsletter_movies WHERE newsletter_id = ?').run(id);
    db.prepare('DELETE FROM newsletter_logs WHERE id = ?').run(id);
}

function getNewsletterHistory(limit = 50) {
    init();
    return db.prepare(`
        SELECT nl.*, u.username as sent_by_username
        FROM newsletter_logs nl
        LEFT JOIN users u ON nl.sent_by = u.id
        ORDER BY nl.sent_at DESC
        LIMIT ?
    `).all(limit);
}

module.exports = {
    init,

    // Users
    getUserByUsername,
    getUserById,
    createUser,
    updateUser,
    getAllUsers,
    deleteUser,

    // Sessions
    createSession,
    getSessionByToken,
    getSessionById,
    revokeSession,
    revokeAllUserSessions,
    getUserSessions,
    cleanExpiredSessions,

    // Progress
    upsertProgress,
    getProgress,
    getContinueWatching,
    getAllProgress,
    deleteProgress,

    // Favorites
    addFavorite,
    removeFavorite,
    getFavorites,
    isFavorite,

    // Invitations
    createInvitation,
    getInvitationByCode,
    useInvitation,
    getInvitations,
    deleteInvitation,

    // Newsletter
    getUsersWithEmail,
    updateUserEmail,
    logNewsletter,
    logNewsletterMovies,
    getSentMovieFilenames,
    deleteNewsletterLog,
    getNewsletterHistory,

    // Utilities
    getDb,
    close
};
