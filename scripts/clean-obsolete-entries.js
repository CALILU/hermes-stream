/**
 * Limpia entradas obsoletas (.avi/.mkv) de colecciones y movies_cache
 * Las conversiones AVI/MKV→MP4 dejaron duplicados en la base de datos
 */
const Database = require('better-sqlite3');
const db = new Database('isiprime.db');

// === 1. LIMPIAR COLECCIONES ===
const rows = db.prepare('SELECT collection_id, name, movies FROM collections').all();
let collsFixed = 0;
let entriesRemoved = 0;
let collsDeleted = 0;

const update = db.prepare('UPDATE collections SET movies = ? WHERE collection_id = ?');
const del = db.prepare('DELETE FROM collections WHERE collection_id = ?');

const txn = db.transaction(() => {
    for (const row of rows) {
        const movies = JSON.parse(row.movies);
        const hasObsolete = movies.some(m => m.filename && (m.filename.endsWith('.avi') || m.filename.endsWith('.mkv')));
        if (!hasObsolete) continue;

        // Deduplicar: por tmdb_id, preferir .mp4
        const seen = new Map();
        const cleaned = [];
        for (const m of movies) {
            const existing = seen.get(m.tmdb_id);
            if (!existing) {
                seen.set(m.tmdb_id, m);
                cleaned.push(m);
            } else if (m.filename.endsWith('.mp4') && !existing.filename.endsWith('.mp4')) {
                const idx = cleaned.indexOf(existing);
                cleaned[idx] = m;
                seen.set(m.tmdb_id, m);
            }
        }

        // Eliminar entradas que siguen siendo .avi/.mkv (no tienen versión .mp4)
        const final = cleaned.filter(m => m.filename.endsWith('.mp4'));

        entriesRemoved += movies.length - final.length;

        if (final.length === 0) {
            del.run(row.collection_id);
            collsDeleted++;
            console.log('  ELIMINADA:', row.name, '(0 películas MP4)');
        } else {
            update.run(JSON.stringify(final), row.collection_id);
            collsFixed++;
        }
    }
});
txn();

// === 2. LIMPIAR MOVIES_CACHE .mkv ===
const mkvDeleted = db.prepare("DELETE FROM movies_cache WHERE filename LIKE '%.mkv'").run();

// === 3. LIMPIAR MOVIES_CACHE .avi ===
const aviDeleted = db.prepare("DELETE FROM movies_cache WHERE filename LIKE '%.avi'").run();

console.log('\n=== RESULTADO ===');
console.log('Colecciones corregidas:', collsFixed);
console.log('Colecciones eliminadas (sin MP4):', collsDeleted);
console.log('Entradas obsoletas eliminadas de colecciones:', entriesRemoved);
console.log('Entradas .mkv eliminadas de movies_cache:', mkvDeleted.changes);
console.log('Entradas .avi eliminadas de movies_cache:', aviDeleted.changes);

db.close();
