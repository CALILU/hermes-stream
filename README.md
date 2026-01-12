# HermesStream 🎬

Reproductor de video web con streaming desde servidor FTP y transcodificación en tiempo real.

## Características

- 📡 Conexión a servidor FTP remoto
- 🎥 Transcodificación de video al vuelo con FFmpeg (H.264/AAC)
- 🎨 Interfaz moderna con diseño glassmorphism
- 📱 Diseño responsivo con Tailwind CSS
- 🎞️ Soporte para MP4, MKV, AVI, MOV
- ⚡ Streaming progresivo optimizado

## Requisitos

- Node.js >= 18.0.0
- FFmpeg instalado en el sistema
- Cuenta en servidor FTP (configurado en variables de entorno)

### Instalación de FFmpeg

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Windows
# Descargar de https://ffmpeg.org/download.html
```

## Instalación

### Desarrollo local

```bash
# 1. Clonar el repositorio
git clone https://github.com/CALILU/hermes-stream.git
cd hermes-stream

# 2. Instalar dependencias backend
npm install

# 3. Instalar dependencias frontend
cd my-ui
npm install
cd ..

# 4. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus credenciales FTP

# 5. Configurar variables de entorno del frontend
cp my-ui/.env.example my-ui/.env
# (Opcional) Editar si necesitas cambiar la URL de la API

# 6. Iniciar backend (Terminal 1)
npm run dev

# 7. Iniciar frontend (Terminal 2)
cd my-ui
npm start
```

Accede a http://localhost:3000

### Producción (Railway)

#### Paso 1: Preparar el código

El proyecto ya está configurado para Railway. Asegúrate de que todos los archivos estén commiteados en Git.

#### Paso 2: Crear repositorio en GitHub

```bash
# Si no has inicializado git:
git init
git add -A
git commit -m "feat: configuración inicial de HermesStream"

# Crear repositorio en GitHub
gh repo create hermes-stream --public --source=. --remote=origin --push
```

#### Paso 3: Desplegar en Railway

1. Ir a https://railway.app/dashboard
2. Click en "New Project"
3. Seleccionar "Deploy from GitHub repo"
4. Seleccionar `CALILU/hermes-stream`
5. Railway detectará automáticamente Node.js

#### Paso 4: Configurar variables de entorno en Railway

En el dashboard de Railway, ir a Variables y añadir:

| Variable | Valor | Descripción |
|----------|-------|-------------|
| `FTP_HOST` | `calilu.mooo.com` | Host del servidor FTP |
| `FTP_USER` | `CALILU5` | Usuario FTP |
| `FTP_PASSWORD` | `[tu_password]` | Contraseña FTP |
| `FTP_PORT` | `21` | Puerto FTP |
| `NODE_ENV` | `production` | Entorno de ejecución |

**Nota:** `PORT` no es necesario, Railway lo asigna automáticamente.

#### Paso 5: Verificar despliegue

Railway ejecutará automáticamente:
1. `npm install` - Instalar dependencias del backend
2. `npm run build` - Compilar el frontend React
3. `npm start` - Iniciar el servidor Express

Una vez desplegado, accede a la URL proporcionada por Railway (ej: `hermes-stream.up.railway.app`).

## Variables de entorno

### Backend (`.env`)

```env
# Configuración del servidor FTP
FTP_HOST=calilu.mooo.com
FTP_USER=CALILU5
FTP_PASSWORD=tu_password_aqui
FTP_PORT=21

# Puerto del servidor (Railway lo asigna automáticamente)
PORT=3001

# Entorno (development | production)
NODE_ENV=development
```

### Frontend (`my-ui/.env`)

```env
# URL de la API
# En desarrollo: http://localhost:3001
# En producción: dejar vacío (usa el mismo dominio)
REACT_APP_API_URL=http://localhost:3001
```

## Arquitectura

```
┌─────────────────┐
│  Navegador Web  │
│  React + Tail.  │
└────────┬────────┘
         │
         │ HTTP GET /api/videos
         │ HTTP GET /stream/:filename
         ↓
┌─────────────────────────┐
│   Backend Express       │
│   (Puerto Railway)      │
│                         │
│  Endpoints:             │
│  - GET /api/videos      │ → Conecta FTP
│  - GET /stream/:file    │ → Stream video
│                         │
│  ┌───────────────────┐  │
│  │ FFmpeg Transcoder │  │ ← Descarga del FTP
│  │ MP4/H.264/AAC     │  │
│  └───────────────────┘  │
└────────┬────────────────┘
         │
         │ FTP Connection
         ↓
┌──────────────────┐
│ Servidor FTP     │
│ calilu.mooo.com  │
│ /volume-2        │
└──────────────────┘
```

## Scripts disponibles

### Backend

| Script | Comando | Descripción |
|--------|---------|-------------|
| `npm start` | `node server.js` | Inicia el servidor en producción |
| `npm run dev` | `nodemon server.js` | Desarrollo con auto-reload |
| `npm run build` | Build del frontend | Compila React en `my-ui/build/` |

### Frontend (my-ui/)

| Script | Comando | Descripción |
|--------|---------|-------------|
| `npm start` | React dev server | Desarrollo en http://localhost:3000 |
| `npm run build` | Build de producción | Genera archivos estáticos |
| `npm test` | Ejecutar tests | Tests con Jest |

## Estructura del proyecto

```
hermes-stream/
├── server.js                 # Backend Express + Streaming
├── package.json              # Dependencias backend
├── .env.example              # Ejemplo de variables de entorno
├── .gitignore                # Archivos ignorados por Git
├── README.md                 # Este archivo
│
└── my-ui/                    # Frontend React
    ├── src/
    │   ├── App.js            # Componente principal
    │   ├── index.js          # Entry point
    │   └── index.css         # Tailwind imports
    ├── public/               # Archivos estáticos
    ├── package.json          # Dependencias frontend
    ├── tailwind.config.js    # Configuración Tailwind
    └── .env.example          # Variables de entorno frontend
```

## Tecnologías utilizadas

### Backend
- **Node.js 18+** - Runtime de JavaScript
- **Express 5** - Framework web
- **FFmpeg** - Transcodificación de video
- **basic-ftp** - Cliente FTP
- **fluent-ffmpeg** - Wrapper de FFmpeg para Node.js

### Frontend
- **React 19** - Biblioteca UI
- **Tailwind CSS 4** - Framework CSS utility-first
- **Framer Motion** - Animaciones
- **Lucide React** - Iconos SVG

## Solución de problemas

### Error: "FFmpeg no detectado"

Instala FFmpeg en tu sistema:
```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# Verificar instalación
ffmpeg -version
```

### Error: "No se pudo conectar al disco"

1. Verifica que las credenciales FTP en `.env` sean correctas
2. Verifica que el servidor FTP (`calilu.mooo.com`) esté accesible
3. Revisa el path `/volume-2` en el servidor FTP

### En Railway: Build falla

1. Verifica que `nixpacks.pkgs` incluya `ffmpeg` en `package.json`
2. Revisa los logs de Railway para identificar el error
3. Si FFmpeg no se instala automáticamente, considera usar un Dockerfile

### Frontend no conecta con backend en producción

1. Verifica que `NODE_ENV=production` esté configurado en Railway
2. Asegúrate de que `npm run build` se haya ejecutado correctamente
3. La variable `REACT_APP_API_URL` debe estar vacía o comentada en producción

## Despliegue automático

Una vez configurado en Railway, cada push a GitHub despliega automáticamente:

```bash
git add .
git commit -m "feat: nueva funcionalidad"
git push origin main
# Railway detecta el push y despliega automáticamente
```

## Licencia

MIT

## Autor

CALILU - https://github.com/CALILU

---

**Nota:** Este proyecto requiere un servidor FTP externo para funcionar. Asegúrate de que el servidor FTP esté configurado y accesible antes de desplegar.
