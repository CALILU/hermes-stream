# Contexto del Proyecto IsiPrime (PLEX)

Servidor autónomo de streaming de películas y series para 5-10 usuarios remotos. Backend Node.js y frontend React.

## Información general

- **Directorio**: F:\plex
- **Nombre**: IsiPrime / HermesStream
- **Backend**: Node.js + Express 5 (server.js) - Puerto 8080 (env PORT)
- **Frontend**: React 19 (my-ui/) - Compilado en my-ui/build/
- **Almacenamiento**: Local (disco directo, sin FTP)
- **Base de datos**: SQLite via better-sqlite3 (WAL mode)
  - `isiprime.db` — media cache, series, colecciones, descargas, usuarios
  - `requests.db` — peticiones de películas
- **Autenticación**: JWT (access token 15min + refresh token 30d) + bcrypt
- **APIs externas**: TMDB (metadatos de películas)
- **Usuario GitHub**: CALILU
- **Target**: LincStation N2 (Debian 12)

## Estructura del proyecto

```
F:\plex\
├── server.js              # Backend principal (Express 5)
├── db/                    # Módulos SQLite
│   ├── media-db.js        # Películas, series, colecciones, descargas
│   ├── users-db.js        # Usuarios, sesiones, progreso, favoritos
│   └── requests-db.js     # Peticiones de películas
├── lib/                   # Lógica de negocio
│   ├── auth.js            # JWT, bcrypt, middleware de autenticación
│   ├── cache.js           # Cache de metadatos (SQLite)
│   ├── series.js          # Gestión de series (SQLite)
│   ├── collections.js     # Colecciones (SQLite)
│   ├── download-helpers.js # Cola de descargas (SQLite)
│   ├── tmdb.js            # Cliente TMDB rate-limited
│   ├── normalizers.js     # Normalización cache → API
│   ├── utils.js           # Utilidades compartidas
│   ├── requests-helpers.js # Helpers de peticiones
│   └── dlna.js            # Servicio DLNA/UPnP (opcional)
├── routes/                # Rutas Express
│   ├── auth.js            # Login, refresh, registro, invitaciones
│   ├── user-data.js       # Progreso, favoritos per-user
│   ├── videos.js          # Catálogo de películas
│   ├── streaming.js       # Streaming con FFmpeg
│   ├── series.js          # Series y episodios
│   ├── requests.js        # Peticiones CRUD + SSE
│   ├── collections.js     # Colecciones de películas
│   ├── downloads.js       # Cola de descargas
│   ├── conversion.js      # Conversión de video + SSE
│   ├── storage.js         # Configuración de almacenamiento
│   ├── movies.js          # Gestión de archivos de películas
│   ├── dlna.js            # DLNA/Cast a TV
│   ├── tmdb.js            # Búsqueda TMDB
│   └── misc.js            # Endpoints utilitarios
├── scripts/
│   └── migrate-json-to-sqlite.js  # Migración JSON → SQLite
├── my-ui/                 # Frontend React 19
│   ├── src/
│   │   ├── App.js         # Hub central, role-based UI
│   │   ├── hooks/         # useAuth, useVideos, useSeries, useUsers, etc.
│   │   ├── utils/api.js   # authFetch con JWT auto-refresh
│   │   └── components/    # Modales y reproductor (UserManagementModal, etc.)
│   └── build/             # Build compilado (CRÍTICO)
├── backups/               # Backups del build
├── .env                   # Variables de entorno
└── package.json           # Dependencias (jsonwebtoken, bcrypt, better-sqlite3...)
```

## Troubleshooting

### Pantalla negra / App no carga

**Causa**: El directorio `my-ui/build/` no existe o está corrupto.

**Solución**:
```bash
# Opción 1: Restaurar desde backup
cp -r backups/build-backup-20260128/* my-ui/build/

# Opción 2: Recompilar
cd my-ui && npm run build
```

### SQLite "invalid ELF header"

**Causa**: Módulo nativo compilado para otra arquitectura (ej: Windows vs Linux).

**Solución**: `npm rebuild better-sqlite3` en la máquina target.

### Auth no funciona tras reinicio

**Causa**: JWT_SECRET se auto-genera si no está en `.env`, invalidando tokens existentes.

**Solución**: Fijar `JWT_SECRET=<valor-fijo>` en `.env`.

## Iniciar la aplicación

```bash
# Desde el directorio del proyecto
node server.js

# O con nodemon para desarrollo
npm run dev
```

## APIs y Endpoints importantes

### Auth
- `POST /api/auth/login` - Login (devuelve accessToken + refreshToken)
- `POST /api/auth/refresh` - Renovar access token
- `POST /api/auth/logout` - Cerrar sesión
- `POST /api/auth/register` - Registro con código de invitación (público)
- `GET /api/auth/status` - Estado de autenticación (LAN auto-auth)
- `GET /api/auth/users` - Listar usuarios (admin)
- `POST /api/auth/users` - Crear usuario (admin)
- `DELETE /api/auth/users/:id` - Eliminar usuario (admin)
- `POST /api/auth/invitations` - Crear invitación (admin)
- `GET /api/auth/invitations` - Listar invitaciones (admin)
- `DELETE /api/auth/invitations/:id` - Eliminar invitación (admin)
- `GET /api/auth/sessions` - Sesiones del usuario
- `DELETE /api/auth/sessions/:id` - Revocar sesión

### Datos per-user
- `PUT /api/progress` - Guardar progreso de video
- `GET /api/continue-watching` - Videos para continuar viendo
- `POST/DELETE/GET /api/favorites` - Favoritos del usuario

### Media
- `GET /api/videos` - Lista de películas
- `GET /api/series` - Lista de series
- `GET /stream/:filename` - Streaming de película (token via query string)
- `GET /stream-series/:folder/:file` - Streaming de episodio
- `GET /api/requests` - Peticiones de usuarios
- `GET /api/collections` - Colecciones de películas

## Desarrollador

- Usuario: ISIDRO
- GitHub: CALILU
- Última actualización: 23/02/2026
