# Autenticacion y Sistema Multi-Usuario

## Migracion del sistema de autenticacion de IsiPrime para acceso remoto multi-usuario

> **Objetivo**: Pasar de un sistema de sesion en RAM con un solo usuario local a un sistema JWT multi-usuario con persistencia en SQLite, preparado para 5-10 usuarios remotos accediendo desde sus hogares.

---

## 1. Analisis del Sistema Actual (Problemas)

### Estado actual del codigo

```javascript
// server.js - Linea 37
const sessions = new Map(); // Almacen de sesiones en memoria

// Linea 51 - Hash de contrasena con SHA256 sin salt
password: crypto.createHash('sha256').update('admin123').digest('hex')

// Linea 107 - Token de sesion aleatorio
return crypto.randomBytes(32).toString('hex');

// Linea 115-118 - Auto-auth para IPs locales
if (isLocalIP(clientIP)) {
    req.user = { username: 'local', role: 'admin', isLocal: true };
    return next();
}
```

### Problemas identificados

| Problema | Impacto | Severidad |
|----------|---------|-----------|
| **SHA256 sin salt** para contrasenas | Vulnerable a rainbow tables y ataques de diccionario. SHA256 es una funcion de hash rapida, NO disenada para contrasenas. Un atacante puede probar miles de millones de hashes por segundo. | CRITICO |
| **Sesiones en `Map()` en RAM** | Se pierden todas las sesiones cada vez que el servidor se reinicia. Los usuarios deben re-autenticarse constantemente. | ALTO |
| **`Map()` no escala con PM2 cluster** | Cada worker de PM2 tiene su propio `Map()`. Un usuario que inicia sesion en el worker 1 no esta autenticado en el worker 2. Sesiones rotas aleatoriamente. | ALTO |
| **Sin datos por usuario** | Todos los usuarios comparten los mismos favoritos, progreso de reproduccion y colecciones. No hay experiencia personalizada. | ALTO |
| **Auto-auth por IP** expuesto a internet | Cualquier IP local tiene acceso admin sin contrasena. Si el servidor se expone via reverse proxy mal configurado, `X-Forwarded-For` puede ser falsificado. | CRITICO |
| **Sin proteccion contra fuerza bruta** | No hay limite de intentos de login. Un atacante puede probar contrasenas indefinidamente. | ALTO |
| **Sin mecanismo de recuperacion** | No hay forma de resetear contrasena. Si se pierde, hay que editar `users.json` manualmente. | MEDIO |
| **Un solo usuario** (`admin/admin123`) | No hay registro, no hay invitaciones. Todos comparten la misma cuenta. | MEDIO |
| **users.json en texto plano** | Archivo JSON sin cifrado en disco. Aunque las contrasenas estan hasheadas, el hash SHA256 sin salt es trivial de revertir. | ALTO |

### Archivos afectados actualmente

```
server.js           → Toda la logica de auth (lineas 32-280)
users.json          → Almacen de usuarios (1 usuario)
my-ui/src/hooks/useAuth.js    → Hook de autenticacion frontend
my-ui/src/utils/api.js        → authFetch() con X-Session-Token
```

---

## 2. Nueva Arquitectura de Autenticacion: JWT

### Por que JWT en lugar de sesiones en Map()

Con el sistema actual basado en `Map()`, al usar PM2 en modo cluster (necesario para aprovechar multiples nucleos del NAS), cada worker tiene su propia instancia de `Map()`. Esto significa:

```
Worker 1: Map { "token-abc" → usuario }
Worker 2: Map { }  ← No conoce "token-abc"
Worker 3: Map { }  ← No conoce "token-abc"
```

El usuario que inicio sesion en el Worker 1 recibe un 401 si su siguiente peticion va al Worker 2.

**JWT resuelve esto** porque es **stateless**: cada token contiene toda la informacion necesaria (userId, role) firmada criptograficamente. Cualquier worker puede verificarlo independientemente sin consultar ningun almacen compartido.

### Estructura de tokens

**Access Token** (corta duracion):
- Duracion: **15 minutos**
- Contenido: `{ userId, username, role }`
- Enviado en: Header `Authorization: Bearer <token>`
- Almacenamiento frontend: variable en memoria (NO localStorage)
- Firmado con: secreto HMAC-SHA256 (variable de entorno `JWT_SECRET`)

**Refresh Token** (larga duracion):
- Duracion: **30 dias**
- Almacenado en: tabla `sessions` en SQLite
- Enviado en: body del POST /api/auth/refresh
- Se rota en cada uso (el token viejo se invalida)
- Permite revocar sesiones individualmente

### Flujo de autenticacion (diagrama)

```
┌──────────┐                          ┌──────────────┐                    ┌──────────┐
│ Frontend │                          │   Backend    │                    │  SQLite  │
│ (React)  │                          │  (Express)   │                    │   (BD)   │
└────┬─────┘                          └──────┬───────┘                    └────┬─────┘
     │                                       │                                 │
     │  1. POST /api/auth/login              │                                 │
     │  { username, password }               │                                 │
     │ ─────────────────────────────────────► │                                 │
     │                                       │  Verificar bcrypt               │
     │                                       │ ───────────────────────────────► │
     │                                       │  ◄─────────── usuario valido ── │
     │                                       │                                 │
     │                                       │  Guardar refresh_token          │
     │                                       │ ───────────────────────────────► │
     │                                       │                                 │
     │  ◄─── { accessToken, refreshToken } ─ │                                 │
     │                                       │                                 │
     │  2. GET /api/videos                   │                                 │
     │  Authorization: Bearer <accessToken>  │                                 │
     │ ─────────────────────────────────────► │                                 │
     │                                       │  jwt.verify(accessToken)        │
     │                                       │  (NO consulta BD)               │
     │  ◄──────────── { videos: [...] } ──── │                                 │
     │                                       │                                 │
     │  ~~~ 15 minutos despues ~~~           │                                 │
     │                                       │                                 │
     │  3. GET /api/videos                   │                                 │
     │  Authorization: Bearer <accessToken>  │                                 │
     │ ─────────────────────────────────────► │                                 │
     │  ◄──────────── 401 Token Expirado ─── │                                 │
     │                                       │                                 │
     │  4. POST /api/auth/refresh            │                                 │
     │  { refreshToken }                     │                                 │
     │ ─────────────────────────────────────► │                                 │
     │                                       │  Verificar refresh_token        │
     │                                       │ ───────────────────────────────► │
     │                                       │  ◄──── token valido, no revocado│
     │                                       │                                 │
     │                                       │  Rotar: revocar viejo,          │
     │                                       │  crear nuevo refresh_token      │
     │                                       │ ───────────────────────────────► │
     │                                       │                                 │
     │  ◄── { accessToken, refreshToken } ── │                                 │
     │       (nuevo par de tokens)           │                                 │
     │                                       │                                 │
     │  5. DELETE /api/auth/logout           │                                 │
     │  { refreshToken }                     │                                 │
     │ ─────────────────────────────────────► │                                 │
     │                                       │  Revocar refresh_token          │
     │                                       │ ───────────────────────────────► │
     │  ◄──────────── { success: true } ──── │                                 │
     │                                       │                                 │
```

### Endpoints de autenticacion

| Metodo | Ruta | Auth requerida | Descripcion |
|--------|------|----------------|-------------|
| POST | `/api/auth/login` | No | Login con username + password |
| POST | `/api/auth/refresh` | No | Renovar accessToken con refreshToken |
| DELETE | `/api/auth/logout` | No | Revocar refreshToken |
| GET | `/api/auth/status` | Si | Estado de autenticacion actual |
| GET | `/api/auth/sessions` | Si (admin) | Listar sesiones activas del usuario |
| DELETE | `/api/auth/sessions/:id` | Si | Revocar una sesion especifica |

### Implementacion del middleware

```javascript
const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    // Opcion: mantener auto-auth LAN como configuracion opcional
    if (config.allowLanAutoAuth && isLocalIP(getClientIP(req))) {
        req.user = { id: 1, username: 'admin', role: 'admin', isLocal: true };
        return next();
    }

    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token requerido' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = {
            id: decoded.userId,
            username: decoded.username,
            role: decoded.role
        };
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Token expirado', code: 'TOKEN_EXPIRED' });
        }
        return res.status(401).json({ error: 'Token invalido' });
    }
}
```

---

## 3. Seguridad de Contrasenas

### Problema actual: SHA256

```javascript
// ACTUAL - INSEGURO
crypto.createHash('sha256').update(password).digest('hex');
```

SHA256 es una funcion de hash de proposito general. Es **rapida por diseno** (~10 millones de hashes/segundo en una GPU moderna). Esto es exactamente lo contrario de lo que se necesita para contrasenas:

- Sin salt: dos usuarios con la misma contrasena tienen el mismo hash
- Sin coste computacional adaptable: siempre tarda lo mismo
- Vulnerable a rainbow tables (tablas precomputadas)
- La contrasena `admin123` tiene el hash `240be518...` que aparece en bases de datos publicas

### Solucion: bcrypt

```javascript
const bcrypt = require('bcrypt');
const BCRYPT_ROUNDS = 12; // ~250ms por hash, suficiente para frenar ataques

// Crear hash
const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
// Resultado: $2b$12$LJ3m4ys3Lk0sBX9gIwzHGeKF8g7ZkVn0Q5.UYf6Hs...

// Verificar
const match = await bcrypt.compare(password, hash);
```

**Por que bcrypt y no argon2:**
- bcrypt esta ampliamente probado y auditado (20+ anos)
- `bcrypt` (npm) tiene 5M+ descargas semanales
- argon2 requiere compilacion nativa que puede fallar en ARM (NAS)
- bcrypt con factor 12 es mas que suficiente para 5-10 usuarios

### Requisitos de contrasena

- Longitud minima: **8 caracteres**
- Sin requisitos de complejidad artificiosos (mayusculas, simbolos) — la longitud es mas importante
- Validacion tanto en frontend como en backend

### Estrategia de migracion de hashes

Al migrar, las contrasenas existentes estan en SHA256. No podemos convertirlas directamente porque no conocemos la contrasena original. La solucion es **re-hashear en el primer login**:

```javascript
async function loginUser(username, password) {
    const user = await db.get('SELECT * FROM users WHERE username = ?', username);
    if (!user) return null;

    // Detectar si el hash es SHA256 (64 caracteres hex) o bcrypt ($2b$...)
    if (user.password_hash.startsWith('$2b$')) {
        // Hash bcrypt moderno - verificar normalmente
        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return null;
    } else {
        // Hash SHA256 legacy - verificar y migrar
        const sha256Hash = crypto.createHash('sha256').update(password).digest('hex');
        if (sha256Hash !== user.password_hash) return null;

        // Re-hashear con bcrypt
        const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await db.run('UPDATE users SET password_hash = ? WHERE id = ?', newHash, user.id);
        console.log(`Contrasena de ${username} migrada a bcrypt`);
    }

    return user;
}
```

### Rate limiting en login

**5 intentos por IP cada 15 minutos.** Implementado a dos niveles:

1. **Nginx** (primera linea de defensa):
```nginx
limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

location /api/auth/login {
    limit_req zone=login burst=5 nodelay;
    limit_req_status 429;
    proxy_pass http://localhost:8080;
}
```

2. **Middleware Express** (si no hay nginx delante):
```javascript
const loginAttempts = new Map(); // IP → { count, firstAttempt }

function loginRateLimit(req, res, next) {
    const ip = getClientIP(req);
    const now = Date.now();
    const window = 15 * 60 * 1000; // 15 minutos

    const attempts = loginAttempts.get(ip);
    if (attempts) {
        if (now - attempts.firstAttempt > window) {
            loginAttempts.delete(ip);
        } else if (attempts.count >= 5) {
            const retryAfter = Math.ceil((window - (now - attempts.firstAttempt)) / 1000);
            return res.status(429).json({
                error: 'Demasiados intentos. Intenta de nuevo mas tarde.',
                retryAfter
            });
        }
    }

    // Registrar intento (solo en login fallido, ver implementacion en endpoint)
    next();
}
```

---

## 4. Sistema de Registro: Invitaciones

### Principio: servidor privado, sin registro publico

IsiPrime es un servidor privado para familia y amigos. No tiene sentido un registro publico. En su lugar, el admin genera **codigos de invitacion** que comparte individualmente.

### Flujo de invitacion

```
Admin                               Usuario nuevo
  │                                      │
  │  1. POST /api/auth/invitations       │
  │     (genera codigo)                  │
  │                                      │
  │  2. Comparte enlace:                 │
  │     https://dominio/invite/ABC123    │
  │  ─────────────────────────────────►  │
  │                                      │
  │                                      │  3. Abre enlace en navegador
  │                                      │     Ve formulario: username + password
  │                                      │
  │                                      │  4. POST /api/auth/register
  │                                      │     { code, username, password }
  │  ◄───────────────────────────────────│
  │                                      │
  │  5. Cuenta creada con rol 'viewer'   │
  │     Invitacion marcada como usada    │
  │                                      │
```

### Reglas de invitaciones

- **Un solo uso**: cada codigo solo puede usarse una vez
- **Expiracion**: 7 dias desde la creacion
- **Solo admin**: unicamente usuarios con rol `admin` pueden generar invitaciones
- **Trazabilidad**: se registra quien creo la invitacion y quien la uso
- **Rol por defecto**: los usuarios registrados por invitacion son `viewer`

### Endpoints de invitaciones

| Metodo | Ruta | Auth | Descripcion |
|--------|------|------|-------------|
| POST | `/api/auth/invitations` | Admin | Crear nueva invitacion |
| GET | `/api/auth/invitations` | Admin | Listar invitaciones (activas/usadas) |
| DELETE | `/api/auth/invitations/:id` | Admin | Revocar invitacion no usada |
| POST | `/api/auth/register` | No | Registrar usuario con codigo de invitacion |
| GET | `/api/auth/invite/:code` | No | Verificar si codigo es valido (para el frontend) |

### Implementacion

```javascript
const crypto = require('crypto');

// Generar invitacion
router.post('/api/auth/invitations', authMiddleware, requireRole('admin'), (req, res) => {
    const code = crypto.randomBytes(16).toString('hex'); // 32 caracteres
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 dias

    db.run(
        'INSERT INTO invitations (code, created_by, expires_at) VALUES (?, ?, ?)',
        [code, req.user.id, expiresAt.toISOString()]
    );

    res.json({
        success: true,
        code,
        link: `${req.protocol}://${req.get('host')}/invite/${code}`,
        expiresAt
    });
});

// Registrar usuario con invitacion
router.post('/api/auth/register', async (req, res) => {
    const { code, username, password } = req.body;

    // Validar invitacion
    const invitation = db.get(
        'SELECT * FROM invitations WHERE code = ? AND used_by IS NULL AND expires_at > ?',
        [code, new Date().toISOString()]
    );

    if (!invitation) {
        return res.status(400).json({ error: 'Codigo de invitacion invalido o expirado' });
    }

    // Validar contrasena
    if (!password || password.length < 8) {
        return res.status(400).json({ error: 'La contrasena debe tener al menos 8 caracteres' });
    }

    // Verificar username unico
    const existing = db.get('SELECT id FROM users WHERE username = ?', username);
    if (existing) {
        return res.status(400).json({ error: 'El nombre de usuario ya esta en uso' });
    }

    // Crear usuario
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = db.run(
        'INSERT INTO users (username, password_hash, role, invited_by) VALUES (?, ?, ?, ?)',
        [username, passwordHash, 'viewer', invitation.created_by]
    );

    // Marcar invitacion como usada
    db.run(
        'UPDATE invitations SET used_by = ?, used_at = ? WHERE id = ?',
        [result.lastInsertRowid, new Date().toISOString(), invitation.id]
    );

    res.status(201).json({ success: true, message: 'Cuenta creada. Ya puedes iniciar sesion.' });
});
```

---

## 5. Esquema de Base de Datos (SQLite)

### Tabla `users`

Reemplaza `users.json`. Almacena credenciales y perfil de cada usuario.

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,  -- bcrypt ($2b$12$...)
    display_name TEXT,            -- nombre visible en la UI
    role TEXT DEFAULT 'viewer' CHECK(role IN ('admin', 'viewer')),
    invited_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    active INTEGER DEFAULT 1      -- 0 = cuenta desactivada
);

-- Indices
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_active ON users(active) WHERE active = 1;
```

### Tabla `sessions`

Reemplaza `const sessions = new Map()`. Almacena refresh tokens con persistencia.

```sql
CREATE TABLE sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    refresh_token TEXT UNIQUE NOT NULL,
    device_info TEXT,       -- navigator.userAgent o nombre del dispositivo
    ip_address TEXT,        -- IP desde la que se creo la sesion
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    revoked INTEGER DEFAULT 0  -- 1 = sesion cerrada/revocada
);

-- Indices
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_token ON sessions(refresh_token);
CREATE INDEX idx_sessions_active ON sessions(revoked, expires_at);
```

### Tabla `user_progress`

Progreso de reproduccion **por usuario**. Actualmente el progreso es global.

```sql
CREATE TABLE user_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_path TEXT NOT NULL,       -- ruta del video (ej: "Peliculas/Inception.mp4")
    position_seconds REAL DEFAULT 0,  -- posicion actual en segundos
    duration_seconds REAL,          -- duracion total del video
    completed INTEGER DEFAULT 0,    -- 1 = visto completamente (>90%)
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, video_path)
);

-- Indices
CREATE INDEX idx_progress_user ON user_progress(user_id);
CREATE INDEX idx_progress_lookup ON user_progress(user_id, video_path);
CREATE INDEX idx_progress_recent ON user_progress(user_id, updated_at DESC);
```

### Tabla `user_favorites`

Favoritos **por usuario**. Actualmente la lista es compartida.

```sql
CREATE TABLE user_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_path TEXT NOT NULL,       -- ruta del video
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, video_path)
);

-- Indices
CREATE INDEX idx_favorites_user ON user_favorites(user_id);
```

### Tabla `invitations`

Codigos de invitacion para registro de nuevos usuarios.

```sql
CREATE TABLE invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,          -- codigo de 32 caracteres hex
    created_by INTEGER NOT NULL REFERENCES users(id),
    expires_at DATETIME NOT NULL,       -- 7 dias desde creacion
    used_by INTEGER REFERENCES users(id),
    used_at DATETIME                    -- NULL si no se ha usado
);

-- Indices
CREATE INDEX idx_invitations_code ON invitations(code);
CREATE INDEX idx_invitations_active ON invitations(used_by, expires_at);
```

### Script de inicializacion completo

```sql
-- migrations/001_auth_system.sql
-- Ejecutar una sola vez al migrar

PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Usuarios
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
CREATE INDEX IF NOT EXISTS idx_users_active ON users(active) WHERE active = 1;

-- Sesiones (refresh tokens)
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
CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(revoked, expires_at);

-- Progreso de reproduccion por usuario
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

-- Favoritos por usuario
CREATE TABLE IF NOT EXISTS user_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    video_path TEXT NOT NULL,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, video_path)
);

CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id);

-- Invitaciones
CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    expires_at DATETIME NOT NULL,
    used_by INTEGER REFERENCES users(id),
    used_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
CREATE INDEX IF NOT EXISTS idx_invitations_active ON invitations(used_by, expires_at);

-- Migrar usuario admin existente desde users.json
-- El hash SHA256 se migrara automaticamente a bcrypt en el primer login
INSERT OR IGNORE INTO users (id, username, password_hash, role, created_at)
VALUES (1, 'admin', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', 'admin', '2026-01-19T20:46:13.033Z');

-- Limpieza automatica de sesiones expiradas (ejecutar periodicamente)
-- DELETE FROM sessions WHERE expires_at < datetime('now') OR revoked = 1;
```

---

## 6. Roles y Permisos

### Matriz de permisos

| Accion | admin | viewer |
|--------|:-----:|:------:|
| Navegar y buscar peliculas | SI | SI |
| Reproducir videos (streaming) | SI | SI |
| Guardar progreso de reproduccion | SI | SI |
| Gestionar favoritos personales | SI | SI |
| Crear peticiones de peliculas | SI | SI |
| Ver "Continuar Viendo" personal | SI | SI |
| Gestionar usuarios (invitar/eliminar) | SI | NO |
| Gestionar colecciones | SI | NO |
| Eliminar/renombrar archivos | SI | NO |
| Cola de descargas | SI | NO |
| Configuracion de almacenamiento | SI | NO |
| Estadisticas del servidor | SI | NO |
| Cambiar modo FTP/Local | SI | NO |
| Buscar torrents | SI | NO |

### Middleware de autorizacion por rol

```javascript
function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'No autenticado' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'No tienes permiso para esta accion' });
        }
        next();
    };
}

// Uso en rutas
router.delete('/api/files/:filename', authMiddleware, requireRole('admin'), deleteFile);
router.get('/api/videos', authMiddleware, requireRole('admin', 'viewer'), listVideos);
```

### Visibilidad en frontend

El frontend debe ocultar elementos de UI segun el rol. El backend valida siempre independientemente.

```javascript
// En el frontend (App.js)
const isAdmin = authState.user?.role === 'admin';

// Ocultar boton de descarga si no es admin
{isAdmin && <DownloadButton />}

// Ocultar seccion de settings
{isAdmin && <SettingsModal />}
```

---

## 7. Datos por Usuario

### Que se convierte en per-user (actualmente global)

| Dato | Estado actual | Estado nuevo |
|------|--------------|--------------|
| **Progreso de reproduccion** | `localStorage` del navegador (se pierde al cambiar dispositivo) | Tabla `user_progress` en SQLite, sincronizado entre dispositivos |
| **Favoritos** | Array en memoria del servidor, compartido entre todos | Tabla `user_favorites` por usuario |
| **"Continuar Viendo"** | Basado en `localStorage` del navegador | Consulta a `user_progress WHERE completed = 0 AND position_seconds > 0 ORDER BY updated_at DESC` |
| **Peticiones de peliculas** | Tabla `requests` ya tiene campo `requester` | Vincular `requester` al `user_id` para filtrar por usuario |

### Que permanece global (compartido entre todos los usuarios)

| Dato | Razon |
|------|-------|
| **Catalogo de peliculas y metadatos** (`cache.json`) | Son los mismos archivos de video para todos |
| **Colecciones** (`collections.json`) | Curadas por el admin, visibles para todos |
| **Estructura de series** (`cache-series.json`, `series-episodes.json`) | Datos del filesystem, identicos para todos |
| **Cola de descargas** (`download-queue.json`) | Solo el admin la gestiona |
| **Configuracion de almacenamiento** (`storage-settings.json`) | Configuracion del servidor |

### Endpoint de progreso per-user

```javascript
// Guardar progreso
router.put('/api/progress', authMiddleware, async (req, res) => {
    const { videoPath, position, duration } = req.body;
    const userId = req.user.id;
    const completed = duration > 0 && position / duration > 0.9 ? 1 : 0;

    db.run(`
        INSERT INTO user_progress (user_id, video_path, position_seconds, duration_seconds, completed, updated_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(user_id, video_path) DO UPDATE SET
            position_seconds = excluded.position_seconds,
            duration_seconds = excluded.duration_seconds,
            completed = excluded.completed,
            updated_at = datetime('now')
    `, [userId, videoPath, position, duration, completed]);

    res.json({ success: true });
});

// Obtener "Continuar Viendo"
router.get('/api/continue-watching', authMiddleware, (req, res) => {
    const videos = db.all(`
        SELECT video_path, position_seconds, duration_seconds, updated_at
        FROM user_progress
        WHERE user_id = ? AND completed = 0 AND position_seconds > 30
        ORDER BY updated_at DESC
        LIMIT 20
    `, [req.user.id]);

    res.json({ videos });
});

// Favoritos
router.post('/api/favorites', authMiddleware, (req, res) => {
    const { videoPath } = req.body;
    db.run(
        'INSERT OR IGNORE INTO user_favorites (user_id, video_path) VALUES (?, ?)',
        [req.user.id, videoPath]
    );
    res.json({ success: true });
});

router.delete('/api/favorites', authMiddleware, (req, res) => {
    const { videoPath } = req.body;
    db.run(
        'DELETE FROM user_favorites WHERE user_id = ? AND video_path = ?',
        [req.user.id, videoPath]
    );
    res.json({ success: true });
});

router.get('/api/favorites', authMiddleware, (req, res) => {
    const favorites = db.all(
        'SELECT video_path, added_at FROM user_favorites WHERE user_id = ? ORDER BY added_at DESC',
        [req.user.id]
    );
    res.json({ favorites });
});
```

---

## 8. Medidas de Seguridad para Acceso Remoto

### Lista completa de medidas

| Medida | Implementacion | Capa |
|--------|---------------|------|
| **HTTPS obligatorio** | Certificado Let's Encrypt via nginx. HTTP redirige a HTTPS. | Nginx |
| **bcrypt para contrasenas** | Factor de coste 12 (~250ms por hash). | Backend |
| **JWT con access token corto** | 15 minutos de vida. Minimiza ventana de ataque si se filtra. | Backend |
| **Rotacion de refresh token** | Al usar un refresh token, el viejo se invalida. Si un atacante roba el token y el usuario legitimo lo usa primero, el token robado queda invalido. | Backend + SQLite |
| **Rate limiting en login** | 5 intentos por IP cada 15 minutos. Configurado en nginx `limit_req`. | Nginx |
| **CORS restringido** | Solo permite peticiones desde el dominio configurado (ej: `https://stream.midominio.com`). | Backend |
| **Helmet.js** | Headers de seguridad: `X-Frame-Options: DENY`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, etc. | Backend |
| **Sanitizacion de inputs** | Escapar/validar todos los inputs de usuario para prevenir XSS e inyeccion SQL. | Backend |
| **Auto-auth por IP configurable** | Desactivado por defecto cuando `NODE_ENV=production`. Opcional para LAN en desarrollo. | Backend |
| **Revocacion de sesiones** | El admin puede ver y revocar sesiones activas de cualquier usuario. | Backend + UI |

### Configuracion de Helmet.js

```javascript
const helmet = require('helmet');

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Tailwind usa inline styles
            imgSrc: ["'self'", "https://image.tmdb.org"], // Posters de TMDB
            mediaSrc: ["'self'"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", "https://fonts.googleapis.com", "https://fonts.gstatic.com"],
            frameAncestors: ["'none'"]
        }
    },
    crossOriginEmbedderPolicy: false, // Necesario para cargar posters externos
    hsts: {
        maxAge: 31536000, // 1 ano
        includeSubDomains: true
    }
}));
```

### Configuracion nginx de seguridad

```nginx
server {
    listen 443 ssl http2;
    server_name stream.midominio.com;

    ssl_certificate /etc/letsencrypt/live/stream.midominio.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stream.midominio.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Rate limiting para login
    limit_req_zone $binary_remote_addr zone=login:10m rate=5r/m;

    # Headers de seguridad adicionales
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Bloquear acceso a archivos sensibles
    location ~ /\.(env|json|db|sqlite)$ {
        deny all;
        return 404;
    }

    location /api/auth/login {
        limit_req zone=login burst=5 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header Host $host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Para streaming de video - timeouts largos
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
        proxy_buffering off;
    }
}

# Redirigir HTTP a HTTPS
server {
    listen 80;
    server_name stream.midominio.com;
    return 301 https://$host$request_uri;
}
```

---

## 9. Ruta de Migracion (Actual → Nuevo)

### Plan paso a paso

Cada paso es independiente y puede probarse antes de avanzar al siguiente. No es necesario hacerlo todo de golpe.

---

**Paso 1: Crear tablas en SQLite**

Ejecutar el script de migracion `001_auth_system.sql` (seccion 5) en una nueva base de datos o en `requests.db` existente. Esto crea las tablas `users`, `sessions`, `user_progress`, `user_favorites` e `invitations`.

```bash
sqlite3 auth.db < migrations/001_auth_system.sql
```

Resultado: tablas creadas, usuario admin migrado con hash SHA256 legacy.

---

**Paso 2: Migrar usuario admin desde `users.json`**

El script SQL ya incluye el INSERT del admin con su hash SHA256 actual. En el primer login, el sistema detectara el hash legacy y lo migrara automaticamente a bcrypt (ver seccion 3).

```bash
# Verificar que el usuario existe
sqlite3 auth.db "SELECT id, username, role FROM users;"
# 1|admin|admin
```

---

**Paso 3: Implementar endpoints JWT**

Crear archivo `routes/auth.js` con los endpoints:
- `POST /api/auth/login` — verifica credenciales, genera accessToken + refreshToken
- `POST /api/auth/refresh` — renueva accessToken, rota refreshToken
- `DELETE /api/auth/logout` — revoca refreshToken
- `GET /api/auth/status` — estado de autenticacion

Instalar dependencias:
```bash
npm install jsonwebtoken bcrypt
```

> **Nota**: `jsonwebtoken` y `bcrypt` estan en la lista blanca de paquetes seguros. No requieren verificacion adicional.

Anadir variable de entorno:
```bash
# .env
JWT_SECRET=un-secreto-largo-y-aleatorio-de-al-menos-32-caracteres
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d
```

---

**Paso 4: Actualizar `authMiddleware`**

Reemplazar la verificacion de `sessions.has(sessionToken)` por `jwt.verify(token)`. Mantener la opcion de auto-auth por IP para LAN, controlada por una variable de entorno `ALLOW_LAN_AUTH=true|false`.

```javascript
// ANTES (server.js linea 111-140)
function authMiddleware(req, res, next) {
    if (isLocalIP(clientIP)) { ... }           // auto-auth
    const sessionToken = ...;
    if (sessions.has(sessionToken)) { ... }    // Map() en RAM
}

// DESPUES
function authMiddleware(req, res, next) {
    if (config.allowLanAuth && isLocalIP(clientIP)) { ... }  // configurable
    const token = req.headers['authorization']?.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);            // stateless
    req.user = decoded;
}
```

---

**Paso 5: Crear tablas `user_progress` y `user_favorites`**

Ya incluidas en el script de migracion. Crear los endpoints correspondientes (seccion 7) y modificar el hook `useVideoProgress` del frontend para enviar progreso al servidor en lugar de guardarlo solo en `localStorage`.

Compatibilidad: durante la transicion, leer primero de la BD y fallback a `localStorage` si no hay datos.

---

**Paso 6: Modificar frontend `useAuth` hook**

Cambios en `my-ui/src/hooks/useAuth.js`:

```javascript
// ANTES: envia X-Session-Token en cada peticion
// DESPUES: envia Authorization: Bearer <accessToken>

// Almacenar tokens en memoria (NO en localStorage para el accessToken)
let accessToken = null;
let refreshToken = localStorage.getItem('refreshToken'); // solo el refresh

// Interceptor para renovar token automaticamente
async function authFetch(url, options = {}) {
    options.headers = {
        ...options.headers,
        'Authorization': `Bearer ${accessToken}`
    };

    let response = await fetch(url, options);

    // Si el token expiro, intentar renovar
    if (response.status === 401) {
        const refreshResponse = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });

        if (refreshResponse.ok) {
            const data = await refreshResponse.json();
            accessToken = data.accessToken;
            refreshToken = data.refreshToken;
            localStorage.setItem('refreshToken', refreshToken);

            // Reintentar la peticion original
            options.headers['Authorization'] = `Bearer ${accessToken}`;
            response = await fetch(url, options);
        } else {
            // Refresh token invalido — forzar re-login
            accessToken = null;
            refreshToken = null;
            localStorage.removeItem('refreshToken');
            window.location.reload();
        }
    }

    return response;
}
```

---

**Paso 7: Anadir sistema de invitaciones**

Crear endpoints de invitaciones (seccion 4). Anadir en el frontend:
- Boton "Invitar usuario" en el panel de admin (SettingsModal)
- Pagina `/invite/:code` con formulario de registro
- Lista de invitaciones activas y usadas

---

**Paso 8: Eliminar dependencia de `users.json`**

Una vez que todos los usuarios estan en SQLite y el sistema JWT funciona:
- Eliminar `const USERS_FILE` de `server.js`
- Eliminar funciones `readUsers()`, `writeUsers()`, `initUsers()`
- Eliminar `const sessions = new Map()`
- Renombrar `users.json` a `users.json.backup` (conservar por seguridad)

---

**Paso 9: Configurar rate limiting en nginx**

Aplicar la configuracion de nginx de la seccion 8. Si se ejecuta sin nginx (desarrollo), el middleware de Express proporciona rate limiting basico.

---

### Resumen del orden de dependencias

```
Paso 1 ─── Crear tablas SQLite
  │
  ▼
Paso 2 ─── Migrar admin a SQLite
  │
  ▼
Paso 3 ─── Implementar JWT endpoints ──► npm install jsonwebtoken bcrypt
  │
  ▼
Paso 4 ─── Actualizar authMiddleware (backend listo)
  │
  ├───────────────────────────────┐
  ▼                               ▼
Paso 5                          Paso 6
Tablas progreso/favoritos       Frontend useAuth con JWT
  │                               │
  └───────────┬───────────────────┘
              ▼
Paso 7 ─── Sistema de invitaciones
  │
  ▼
Paso 8 ─── Eliminar users.json
  │
  ▼
Paso 9 ─── Rate limiting nginx (produccion)
```

---

### Dependencias npm necesarias

| Paquete | Version | Proposito |
|---------|---------|-----------|
| `jsonwebtoken` | ^9.x | Firmar y verificar JWT |
| `bcrypt` | ^5.x | Hash seguro de contrasenas |
| `helmet` | ^7.x | Headers de seguridad HTTP |

> Los tres paquetes estan en la lista blanca de seguridad o son ampliamente reconocidos (millones de descargas semanales).

### Variables de entorno nuevas

```bash
# .env (anadir a las existentes)
JWT_SECRET=cambiar-por-secreto-seguro-de-64-caracteres-minimo
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=30d
BCRYPT_ROUNDS=12
ALLOW_LAN_AUTH=true    # false en produccion con acceso remoto
```

---

## Compatibilidad Multi-Dispositivo del Sistema de Auth

El sistema JWT es compatible con todos los dispositivos objetivo:

| Dispositivo | Almacenamiento del token | Renovacion | Notas |
|-------------|--------------------------|------------|-------|
| PC (Chrome/Edge/Firefox) | `localStorage` | Auto-refresh via interceptor axios (401 → refresh) | Sin limitaciones |
| Smart TV (navegador 2021+) | `localStorage` | Mismo mecanismo que PC | Chromium 79+ soporta localStorage y fetch API |
| iPhone/iPad (Safari) | `localStorage` | Mismo mecanismo | Safari iOS 15+ sin restricciones para SPA |
| Android (Chrome mobile) | `localStorage` | Mismo mecanismo | Sin limitaciones |
| DLNA (TVs en LAN) | No aplica | No aplica | DLNA no pasa por auth — opera en red local via `/dlna/media/:token` (tokens de media temporales, no JWT) |

**Punto clave**: el frontend React maneja JWT de forma transparente para el usuario. El access token (15min) se renueva automaticamente con el refresh token (30d). El usuario solo ve la pantalla de login al expirar el refresh token o al acceder desde un dispositivo nuevo.

---

## Notas Finales

1. **No romper compatibilidad**: durante la migracion, el sistema antiguo (`X-Session-Token`) y el nuevo (JWT) pueden coexistir. El middleware puede aceptar ambos temporalmente.

2. **Backup antes de migrar**: hacer copia de `users.json`, `requests.db` y cualquier dato de usuario antes de ejecutar migraciones.

3. **Testing**: probar cada paso en local antes de desplegar. Verificar que el login funciona, que los tokens se renuevan correctamente y que el rate limiting no bloquea usuarios legitimos.

4. **Limpieza periodica**: programar un cron o intervalo que elimine sesiones expiradas de la tabla `sessions`:
   ```javascript
   setInterval(() => {
       db.run("DELETE FROM sessions WHERE expires_at < datetime('now') OR revoked = 1");
   }, 60 * 60 * 1000); // cada hora
   ```
