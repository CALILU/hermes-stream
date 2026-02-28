/**
 * routes/movies.js - Rutas de gestión de películas (update-poster, delete)
 *
 * POST /update-poster   - Actualizar carátula con datos extendidos + rename
 * POST /delete          - Eliminar archivo (montado en /api/files)
 *
 * Montado en: /api/movies (update-poster) y /api/files (delete)
 */

const express = require('express');
const fsSync = require('fs');
const path = require('path');
const ftp = require('basic-ftp');

module.exports = function createMoviesRoutes(deps) {
    const {
        storageConfig, FTP_CONFIG,
        readCache, writeCache,
        updateCollectionWithMovie, removeMovieFromCollections,
        tmdbFetch, processTMDBExtendedData, normalizeCacheToAPI,
        TMDB_BASE_URL, TMDB_API_KEY
    } = deps;

    const moviesRouter = express.Router();
    const filesRouter = express.Router();

    // POST /api/movies/update-poster - Actualizar carátula con datos extendidos
    moviesRouter.post('/update-poster', async (req, res) => {
        try {
            const { filename, metadata } = req.body;

            if (!filename || !metadata) {
                return res.status(400).json({ error: 'Se requiere filename y metadata' });
            }

            console.log(`🔄 Actualizando carátula de: ${filename}`);

            // Preparar datos base (normalizar ambos formatos: camelCase del frontend o snake_case legacy)
            let extendedMetadata = {
                tmdb_id: metadata.tmdbId || metadata.tmdb_id || metadata.id,
                title: metadata.title,
                overview: metadata.overview,
                poster_path: metadata.poster || metadata.poster_path,
                backdrop_path: metadata.backdrop || metadata.backdrop_path,
                release_date: metadata.releaseDate || metadata.release_date,
                vote_average: metadata.rating || metadata.vote_average,
                genre_ids: metadata.genreIds || metadata.genre_ids || [],
                cached_at: Date.now()
            };

            // Si tenemos tmdb_id, obtener datos extendidos (videos, recomendaciones, runtime, cast)
            const tmdbId = metadata.tmdbId || metadata.tmdb_id || metadata.id;
            if (tmdbId && TMDB_API_KEY) {
                try {
                    console.log(`📡 Obteniendo datos extendidos de TMDB para ID: ${tmdbId}`);
                    const detailsResponse = await tmdbFetch(`${TMDB_BASE_URL}/movie/${tmdbId}`, {
                        params: {
                            api_key: TMDB_API_KEY,
                            language: 'es-ES',
                            append_to_response: 'videos,recommendations,credits'
                        },
                        timeout: 8000
                    });

                    const details = detailsResponse.data;
                    const extended = processTMDBExtendedData(details);
                    Object.assign(extendedMetadata, extended);

                    console.log(`✅ Datos extendidos: ${extendedMetadata.videos?.length || 0} videos, ${extendedMetadata.recommendations?.length || 0} recomendaciones, ${extendedMetadata.cast?.length || 0} actores`);
                } catch (e) {
                    console.warn(`⚠️ No se pudieron obtener datos extendidos: ${e.message}`);
                }
            }

            // Generar nuevo nombre de archivo basado en TMDB
            const title = extendedMetadata.title || metadata.title;
            const year = extendedMetadata.release_date?.substring(0, 4) || metadata.year;
            const extension = path.extname(filename).toLowerCase();

            // Función para quitar acentos (evita problemas de codificación en FTP)
            const removeAccents = (str) => {
                return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            };

            // Limpiar título para nombre de archivo (quitar caracteres no permitidos y acentos)
            const cleanTitle = removeAccents(title)
                .replace(/[<>:"/\\|?*]/g, '') // Caracteres no permitidos en Windows
                .replace(/\s+/g, ' ')
                .trim();

            const newFilename = year ? `${cleanTitle} (${year})${extension}` : `${cleanTitle}${extension}`;

            let finalFilename = filename; // Por defecto mantener el original
            let renamed = false;

            // Solo renombrar si el nombre es diferente
            if (newFilename !== filename) {
                console.log(`📝 Renombrando: "${filename}" → "${newFilename}"`);

                try {
                    if (storageConfig.mode === 'local') {
                        // ========== MODO LOCAL ==========
                        const oldPath = path.join(storageConfig.localPath, filename);
                        const newPath = path.join(storageConfig.localPath, newFilename);

                        // Verificar que el archivo original existe
                        if (fsSync.existsSync(oldPath)) {
                            // Verificar que el nuevo nombre no existe ya
                            if (fsSync.existsSync(newPath) && oldPath !== newPath) {
                                console.log(`⚠️ Ya existe un archivo con el nombre: ${newFilename}`);
                            } else {
                                fsSync.renameSync(oldPath, newPath);
                                finalFilename = newFilename;
                                renamed = true;
                                console.log(`✅ Archivo local renombrado: ${newFilename}`);
                            }
                        }
                    } else {
                        // ========== MODO FTP ==========
                        const client = new ftp.Client();
                        try {
                            await client.access({
                                ...FTP_CONFIG,
                                secure: false,
                                passive: true
                            });

                            // Verificar que no existe ya un archivo con ese nombre
                            const fileList = await client.list('/volume-1');
                            const exists = fileList.some(f => f.name === newFilename);

                            if (exists && newFilename !== filename) {
                                console.log(`⚠️ Ya existe un archivo con el nombre: ${newFilename}`);
                            } else {
                                await client.rename(`/volume-1/${filename}`, `/volume-1/${newFilename}`);
                                finalFilename = newFilename;
                                renamed = true;
                                console.log(`✅ Archivo FTP renombrado: ${newFilename}`);
                            }
                        } finally {
                            client.close();
                        }
                    }
                } catch (renameError) {
                    console.error(`⚠️ Error renombrando archivo: ${renameError.message}`);
                    // Continuar sin renombrar, no es crítico
                }
            }

            // Actualizar caché del backend
            const cache = await readCache();

            // Si se renombró, eliminar la entrada antigua y crear la nueva
            if (renamed && finalFilename !== filename) {
                delete cache[filename];
            }

            cache[finalFilename] = extendedMetadata;
            await writeCache(cache);

            // Actualizar colección/saga automáticamente si la película pertenece a una
            // Reutilizar datos de colección ya obtenidos en la primera llamada TMDB (evita doble petición)
            let collectionUpdated = false;
            if (extendedMetadata.collection) {
                try {
                    const collection = extendedMetadata.collection;

                    // Añadir película a la colección
                    await updateCollectionWithMovie(collection, {
                        ...extendedMetadata,
                        filename: finalFilename,
                        poster_path: extendedMetadata.poster_path
                    });

                    collectionUpdated = true;
                    console.log(`📚 Película añadida a saga: ${collection.name}`);
                } catch (collError) {
                    console.error(`⚠️ Error actualizando saga: ${collError.message}`);
                }
            }

            console.log(`✅ Carátula actualizada para: ${finalFilename}`);
            res.json({
                success: true,
                message: renamed ? 'Carátula actualizada y archivo renombrado' : 'Carátula actualizada',
                metadata: normalizeCacheToAPI(extendedMetadata),
                newFilename: finalFilename,
                renamed: renamed,
                collectionUpdated: collectionUpdated
            });

        } catch (error) {
            console.error('Error actualizando carátula:', error.message);
            res.status(500).json({ error: 'Error al actualizar carátula' });
        }
    });

    // POST /api/files/delete - Eliminar archivo del servidor (LOCAL o FTP)
    filesRouter.post('/delete', async (req, res) => {
        try {
            const { filename } = req.body;

            if (!filename) {
                return res.status(400).json({ error: 'Se requiere el nombre del archivo' });
            }

            console.log(`🗑️ Solicitud de eliminación: ${filename} [${storageConfig.mode.toUpperCase()}]`);

            // ========== MODO LOCAL ==========
            if (storageConfig.mode === 'local') {
                const localPath = path.join(storageConfig.localPath, filename);

                if (!fsSync.existsSync(localPath)) {
                    return res.status(404).json({ error: 'El archivo no existe en el servidor' });
                }

                // Eliminar archivo
                fsSync.unlinkSync(localPath);
                console.log(`📂 Archivo local eliminado: ${localPath}`);

            // ========== MODO FTP ==========
            } else {
                const client = new ftp.Client();
                client.ftp.verbose = false;

                try {
                    await client.access({
                        host: FTP_CONFIG.host,
                        user: FTP_CONFIG.user,
                        password: FTP_CONFIG.password,
                        port: FTP_CONFIG.port,
                        secure: false
                    });

                    client.ftp.socket.setTimeout(30000);

                    const filePath = `/volume-1/${filename}`;
                    console.log(`📂 Ruta FTP: ${filePath}`);
                    await client.remove(filePath);
                } catch (ftpError) {
                    if (ftpError.message.includes('550') || ftpError.message.includes('No such file')) {
                        return res.status(404).json({ error: 'El archivo no existe en el servidor' });
                    }
                    throw ftpError;
                } finally {
                    client.close();
                }
            }

            // Eliminar del caché local
            const cache = await readCache();
            if (cache[filename]) {
                delete cache[filename];
                await writeCache(cache);
                console.log(`📦 Eliminado del caché: ${filename}`);
            }

            // Eliminar de las colecciones
            await removeMovieFromCollections(filename);

            console.log(`✅ Archivo eliminado exitosamente: ${filename}`);
            res.json({ success: true, message: 'Archivo eliminado correctamente' });

        } catch (error) {
            console.error('❌ Error eliminando archivo:', error.message);
            res.status(500).json({ error: `Error al eliminar: ${error.message}` });
        }
    });

    return { movies: moviesRouter, files: filesRouter };
};
