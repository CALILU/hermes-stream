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
│   └── dlna.js            # DLNA/UPnP + LG webOS SSAP (Cast a TV)
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
│   ├── migrate-json-to-sqlite.js  # Migración JSON → SQLite
│   └── renew-webos-devmode.sh     # Cron renovar Developer Mode TV
├── IsiPrime-WebOS-Native/ # App nativa webOS TV v2.7.0 (compatible webOS 4.0+)
│   ├── appinfo.json       # Manifest webOS (com.isiprime.app, accessibleUrl)
│   ├── index.html         # Entry point (14 scripts sin modules)
│   ├── css/styles.css     # CSS completo (~1830 líneas)
│   ├── js/                # Vanilla JS, window.App namespace, Chromium ~53 compatible
│   │   ├── config.js      # Constantes, TMDB helpers (detecta URLs completas), keycodes
│   │   ├── api.js         # HTTP client con JWT auth + auto-refresh + filmografía
│   │   ├── login.js       # Login para usuarios remotos
│   │   ├── focus.js       # Motor navegación D-pad
│   │   ├── carousel.js    # Carrusel virtual horizontal (poster fallback)
│   │   ├── images.js      # Carga directa con límite concurrencia (max 10)
│   │   ├── router.js      # State machine (HOME→DETAIL→PLAYER→ACTOR...)
│   │   ├── home.js        # Carruseles por género
│   │   ├── detail.js      # Detalle película/serie + cast navegable
│   │   ├── player.js      # Reproductor iframe + resume dialog + key forwarding
│   │   ├── series.js      # Temporadas + episodios
│   │   ├── search.js      # Teclado en pantalla + búsqueda (columnas dinámicas)
│   │   ├── actor.js       # Filmografía de actor (solo películas locales)
│   │   └── app.js         # Bootstrap (cargado último)
│   └── assets/            # placeholder.svg, logo.svg, icon-hd.png (1024x1024)
├── scripts/
│   ├── migrate-json-to-sqlite.js  # Migración JSON → SQLite
│   ├── renew-webos-devmode.sh     # Cron renovar Developer Mode TV
│   ├── start-tv.sh               # Arranque servidor + TV (WSL/Windows)
│   ├── start-tv-nas.sh           # Arranque servidor + TV (NAS, sin rclone)
│   ├── transfer-to-nas.sh        # Transferir código/datos al NAS via rsync
│   └── migrate-to-nas.sh         # Validar instalación en el NAS
├── ecosystem.config.js    # PM2 config (fork mode, 1 instancia)
├── .env.nas               # Template .env para LincStation N2
├── my-ui/                 # Frontend React 19
│   ├── src/
│   │   ├── App.js         # Hub central, role-based UI
│   │   ├── hooks/         # useAuth, useVideos, useSeries, useUsers, etc.
│   │   ├── utils/api.js   # authFetch con JWT auto-refresh
│   │   └── components/    # VideoPlayer, UserManagementModal, CastButton, RandomPickerModal, etc.
│   └── build/             # Build compilado (CRÍTICO)
├── backups/               # Backups del build
├── .env                   # Variables de entorno
├── .env.nas               # Template para NAS (no comitear)
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

### TV Player (webOS) — compatible Chromium ~53+
- `GET /tv-player` - Página HTML inline para reproducción en iframe (controles, barra de progreso, seek). Usa getParam() regex (no URLSearchParams), XHR (no fetch) para duración. Streaming: MSE+fetch → MSE+XHR → directo v.src
- `GET /video-duration/:filename` - Duración real del video via FFprobe (necesario porque MSE reporta Infinity)

### TVs configuradas (ares-cli)
| Device | Modelo | webOS | Chromium | IP | Ubicación |
|--------|--------|-------|----------|-----|-----------|
| `miLGTV` | LG 43UP80006LR | 6.0 | ~87 | 192.168.1.94 (wired) | Comedor |
| `nuevaTV` | LG 32LK6100PLB | 4.0 | ~53 | 192.168.1.108 (WiFi) | Hijo |

## Migración a LincStation N2 NAS (preparada)

- **Hardware**: LincStation N2 (Intel N100, 16GB LPDDR5, 128GB eMMC, 6 bahías)
- **SO target**: Ubuntu 24.04 Server (en eMMC)
- **Disco películas**: WD_Black SN7100 4TB NVMe (NTFS, montado via ntfs-3g)
- **Gestor procesos**: PM2 fork mode (SQLite no soporta cluster)
- **Scripts de migración**: `scripts/transfer-to-nas.sh`, `scripts/migrate-to-nas.sh`, `scripts/start-tv-nas.sh`
- **Config PM2**: `ecosystem.config.js`
- **Template env**: `.env.nas`
- **Solo cambian 3 archivos**: `.env`, `storage-settings.json`, `IsiPrime-WebOS-Native/js/config.js`
- **Estado**: Pendiente — esperando que llegue el NAS

## Desarrollador

- Usuario: ISIDRO
- GitHub: CALILU
- Última actualización: 28/02/2026
