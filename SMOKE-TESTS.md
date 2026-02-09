# Smoke Tests - Verificacion Post-Fase

Ejecutar despues de cada fase de refactoring.
Iniciar servidores: `node server.js` (puerto 8080) + `node converter-server.js` (puerto 4000)

## Backend (server.js)

- [ ] `GET http://localhost:8080/api/videos` - Devuelve lista completa de peliculas con poster, rating, releaseDate
- [ ] `GET http://localhost:8080/api/requests` - Devuelve lista de peticiones
- [ ] `GET http://localhost:8080/api/collections` - Devuelve sagas/colecciones
- [ ] `GET http://localhost:8080/api/genres` - Devuelve lista de generos
- [ ] `GET http://localhost:8080/api/series` - Devuelve lista de series
- [ ] `GET http://localhost:8080/api/tmdb/search?query=matrix` - Busqueda TMDB funciona
- [ ] `GET http://localhost:8080/stream/[archivo]` - Streaming de video funciona

## Frontend (React)

- [ ] `http://localhost:8080` - Pagina principal carga
- [ ] Galeria de peliculas muestra posters
- [ ] Filtro por genero funciona
- [ ] Busqueda por texto funciona
- [ ] Reproducir pelicula funciona
- [ ] Modal "Pedir Pelicula" abre y busca en TMDB
- [ ] Modal "Administrar Peticiones" abre y lista peticiones
- [ ] Cambio entre Peliculas/Series funciona

## Converter (converter-server.js)

- [ ] `http://localhost:4000` - UI del converter carga
- [ ] Escaneo de archivos funciona
- [ ] Busqueda TMDB para renombrar funciona

## Verificacion rapida con curl

```bash
# Videos
curl -s http://localhost:8080/api/videos | head -c 200

# Requests
curl -s http://localhost:8080/api/requests | head -c 200

# TMDB search
curl -s "http://localhost:8080/api/tmdb/search?query=matrix" | head -c 200

# Collections
curl -s http://localhost:8080/api/collections | head -c 200
```
