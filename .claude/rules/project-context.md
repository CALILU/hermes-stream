# Contexto del Proyecto IsiPrime (PLEX)

Aplicación de streaming de películas con backend Node.js y frontend React.

## Información general

- **Directorio**: F:\plex
- **Nombre**: IsiPrime / HermesStream
- **Backend**: Node.js + Express (server.js) - Puerto 8080
- **Frontend**: React (my-ui/) - Compilado en my-ui/build/
- **Almacenamiento**: FTP (NAS Synology)
- **APIs externas**: TMDB (metadatos de películas)
- **Usuario GitHub**: CALILU

## Estructura del proyecto

```
F:\plex\
├── server.js              # Backend principal
├── my-ui/                 # Frontend React
│   ├── src/               # Código fuente
│   └── build/             # Build compilado (CRÍTICO)
├── backups/               # Backups del build
├── chrome-extension/      # Extensión para OK.ru
├── .env                   # Variables de entorno
├── HermesStream.vbs       # Launcher de la aplicación
└── restore-build.bat      # Script para restaurar build
```

## Troubleshooting

### Pantalla negra / App no carga

**Causa**: El directorio `my-ui/build/` no existe o está corrupto.

**Solución automática**:
```bash
# Opción 1: Restaurar desde backup
# En Windows: doble clic en restore-build.bat
# O desde terminal:
cp -r backups/build-backup-20260128/* my-ui/build/

# Opción 2: Recompilar
cd my-ui && npm run build
```

**Backup disponible**: `F:\plex\backups\build-backup-20260128`

### Errores de conexión (FTP/TMDB timeout)

**Causa**: Problema de DNS en WSL.

**Solución**: Ejecutar el servidor desde Windows PowerShell en lugar de WSL:
```powershell
cd F:\plex
node server.js
```

O reiniciar WSL:
```powershell
wsl --shutdown
```

### Tor Browser no se maximiza

El código usa `AppActivate` + `SendKeys('% x')` para traer al frente y maximizar después de 4 segundos.

## Iniciar la aplicación

**Método 1 - Acceso directo**: Doble clic en `HermesStream.vbs`

**Método 2 - Manual desde PowerShell**:
```powershell
cd F:\plex
node server.js
# Abrir http://localhost:8080
```

**Método 3 - Desde WSL** (si hay conexión):
```bash
cd /mnt/f/plex && node server.js
```

## APIs y Endpoints importantes

- `GET /api/videos` - Lista de películas
- `GET /api/requests` - Peticiones de usuarios
- `POST /api/search-torrents` - Buscar en TodoTorrents (abre Tor)
- `POST /api/download-queue` - Añadir URL a cola de descargas
- `GET /stream/:filename` - Streaming de película

## Integraciones

- **Chrome Extension**: Añade videos de OK.ru a la cola de descargas
- **Python Downloader**: `F:\Utiles de python para videos\descarga_youtube\YouTubeDownloader.exe`
- **Tor Browser**: `C:\Users\isidr\Desktop\Tor Browser\` para buscar en TodoTorrents

## Desarrollador

- Usuario: ISIDRO
- GitHub: CALILU
- Última actualización: 28/01/2026
