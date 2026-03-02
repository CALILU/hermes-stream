# Contexto del Proyecto IsiPrime (PLEX)

Servidor autónomo de streaming de películas y series para 5-10 usuarios remotos. Backend Node.js y frontend React.

## Información general

- **Directorio**: F:\plex
- **Nombre**: IsiPrime / HermesStream
- **Backend**: Node.js + Express 5 (server.js) - Puerto 8080 (env PORT)
- **Frontend**: React 19 (my-ui/) - Compilado en my-ui/build/
- **Almacenamiento**: Local (NVMe 4TB en NAS, sin FTP/rclone)
- **Base de datos**: SQLite via better-sqlite3 (WAL mode)
  - `isiprime.db` — media cache, series, colecciones, descargas, usuarios
  - `requests.db` — peticiones de películas
- **Autenticación**: JWT (access token 15min + refresh token 30d) + bcrypt
- **APIs externas**: TMDB (metadatos de películas)
- **Usuario GitHub**: CALILU
- **Producción**: LincStation N2 (Ubuntu 24.04 Server, IP 192.168.1.45)
- **Acceso remoto**: https://calilu.mooo.com (nginx + Let's Encrypt)
- **Gestor procesos**: PM2 fork mode (systemd auto-start)

## Estructura del proyecto

```
F:\plex\
├── server.js              # Backend principal (Express 5)
├── db/                    # Módulos SQLite
│   ├── media-db.js        # Películas, series, colecciones, descargas
│   ├── users-db.js        # Usuarios, sesiones, progreso, favoritos, newsletter
│   └── requests-db.js     # Peticiones de películas
├── lib/                   # Lógica de negocio
│   ├── auth.js            # JWT, bcrypt, middleware de autenticación
│   ├── cache.js           # Cache de metadatos (SQLite)
│   ├── series.js          # Gestión de series (SQLite)
│   ├── collections.js     # Colecciones (SQLite)
│   ├── download-helpers.js # Cola de descargas (SQLite)
│   ├── tmdb.js            # Cliente TMDB rate-limited
│   ├── normalizers.js     # Normalización cache → API
│   ├── probe.js           # FFprobe wrapper (codec, channels, sample rate, dimensions)
│   ├── utils.js           # Utilidades compartidas
│   ├── requests-helpers.js # Helpers de peticiones
│   ├── dlna.js            # DLNA/UPnP + LG webOS SSAP (Cast a TV)
│   ├── email.js           # SMTP nodemailer (Gmail)
│   └── email-template.js  # Template newsletter dark Netflix-style
├── routes/                # Rutas Express
│   ├── auth.js            # Login, refresh, registro, invitaciones
│   ├── user-data.js       # Progreso, favoritos per-user
│   ├── videos.js          # Catálogo de películas
│   ├── streaming.js       # Streaming con FFmpeg
│   ├── series.js          # Series y episodios
│   ├── requests.js        # Peticiones CRUD + SSE
│   ├── collections.js     # Colecciones de películas
│   ├── downloads.js       # Cola de descargas
│   ├── conversion.js      # Conversión de video + SSE (protección duplicados)
│   ├── newsletter.js      # Newsletter email (preview, send, test, historial)
│   ├── storage.js         # Configuración de almacenamiento
│   ├── movies.js          # Gestión de archivos de películas
│   ├── dlna.js            # DLNA/Cast a TV
│   ├── tmdb.js            # Búsqueda TMDB
│   └── misc.js            # Endpoints utilitarios
├── tv-app/                # JS/CSS servidos remotamente a TVs (auto-update)
│   ├── js/                # 17 módulos (copia de IsiPrime-WebOS-Native/js/ sin config.js)
│   ├── css/styles.css     # Copia de IsiPrime-WebOS-Native/css/styles.css
│   └── version.json       # {"version": "2.11.2"}
├── scripts/
│   ├── migrate-json-to-sqlite.js  # Migración JSON → SQLite
│   ├── renew-webos-devmode.sh     # Cron renovar Developer Mode TV
│   ├── sync-tv-app.sh            # Copia JS/CSS a tv-app/ + scp al NAS
│   ├── check-audio.js            # Analizar audio de todos los MP4
│   └── normalize-audio.js        # Normalizar audio a AAC estéreo 48kHz
├── IsiPrime-WebOS-Native/ # App nativa webOS TV v2.11.2 (compatible webOS 4.0+)
│   ├── appinfo.json       # Manifest webOS (com.isiprime.app, accessibleUrl)
│   ├── index.html         # Entry point (dynamic loader, 17 scripts remotos + fallback local)
│   ├── css/styles.css     # CSS completo (~1920 líneas)
│   ├── js/                # Vanilla JS, window.App namespace, Chromium ~53 compatible
│   │   ├── config.js      # Constantes, TMDB helpers, keycodes, APP_VERSION (siempre local en IPK)
│   │   ├── api.js         # HTTP client con JWT auth + auto-refresh + filmografía
│   │   ├── login.js       # Login para usuarios remotos
│   │   ├── focus.js       # Motor navegación D-pad
│   │   ├── carousel.js    # Carrusel virtual horizontal (poster fallback)
│   │   ├── images.js      # Carga directa con límite concurrencia (max 20) + timeout 15s
│   │   ├── router.js      # State machine (HOME→DETAIL→PLAYER→SERIES→SEARCH→ACTOR→SAGAS)
│   │   ├── home.js        # Carruseles por género
│   │   ├── detail.js      # Detalle película/serie + cast navegable + botón saga
│   │   ├── player.js      # Reproductor iframe + loading overlay + auto-resume + key forwarding
│   │   ├── series.js      # Temporadas + episodios
│   │   ├── search.js      # Teclado en pantalla + búsqueda (columnas dinámicas)
│   │   ├── actor.js       # Filmografía de actor (solo películas locales)
│   │   ├── sagas.js       # Navegador de sagas/colecciones (sidebar + grid, B&W no disponibles, toggle peticiones)
│   │   └── app.js         # Bootstrap, versión en nav bar (cargado último)
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
│   │   ├── hooks/         # useAuth, useVideos, useSeries, useUsers, useNewsletter, etc.
│   │   ├── utils/api.js   # authFetch con JWT auto-refresh
│   │   └── components/    # VideoPlayer, UserManagementModal, NewsletterModal, CastButton, etc.
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
- `PUT /api/auth/users/:id` - Actualizar usuario/email (admin)
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

### Newsletter
- `POST /api/newsletter/preview` - Generar preview HTML del newsletter
- `POST /api/newsletter/send` - Enviar newsletter a usuarios con email
- `POST /api/newsletter/test` - Enviar email de prueba a un destinatario
- `GET /api/newsletter/history` - Historial de newsletters enviados
- `GET /api/newsletter/sent-movies` - Lista de películas ya enviadas
- `DELETE /api/newsletter/history/:id` - Eliminar entrada del historial

### TV Player (webOS) — compatible Chromium ~53+
- `GET /tv-player` - Página HTML inline para reproducción en iframe (controles, barra de progreso, seek, spinner de carga). Usa getParam() regex (no URLSearchParams), XHR (no fetch) para duración. Streaming: MSE+fetch → MSE+XHR (direct mode deshabilitado por enableVideoHole). Audio 5.1 auto-downmix a estéreo
- `GET /video-duration/:filename` - Duración real del video via FFprobe (necesario porque MSE reporta Infinity)
- `GET /api/collections/:id/full` - Detalle completo de colección/saga con datos TMDB (cache SQLite 14 días)

### TVs configuradas (ares-cli)
| Device | Modelo | webOS | Chromium | IP | Ubicación |
|--------|--------|-------|----------|-----|-----------|
| `miLGTV` | LG 43UP80006LR | 6.0 | ~87 | 192.168.1.94 (wired) | Comedor |
| `nuevaTV` | LG 32LK6100PLB | 4.0 | ~53 | 192.168.1.108 (WiFi) | Hijo |

## NAS LincStation N2 — OPERATIVO

- **Hardware**: LincStation N2 (Intel N100, 16GB LPDDR5, 128GB eMMC)
- **SO**: Ubuntu 24.04 Server, IP estática 192.168.1.45
- **Disco**: WD_Black SN7100 4TB NVMe (NTFS, ntfs-3g, `/mnt/peliculas`)
- **PM2**: fork mode, systemd auto-start (`pm2-isidro.service`)
- **Seguridad**: UFW + fail2ban + SSH hardened (no root, MaxAuthTries 4)
- **Acceso remoto**: nginx + Let's Encrypt (calilu.mooo.com), DMZ en Livebox 6
- **LEDs**: daemon `lincstation_leds` (I2C bus 2, systemd)
- **Developer Mode TV**: cron renewal diario 3AM (`~/scripts/renew-webos-devmode.sh`)
- **Scripts**: `transfer-to-nas.sh`, `migrate-to-nas.sh`, `start-tv-nas.sh`, `setup-nginx-https.sh`
- **Config**: `ecosystem.config.js`, `.env.nas`, `HermesStream.bat` (launcher simplificado)

## Desarrollador

- Usuario: ISIDRO
- GitHub: CALILU
- Última actualización: 03/03/2026
