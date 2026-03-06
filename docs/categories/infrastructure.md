# Infrastructure - Historial de Cambios

---

## Sesion: 2026-03-05

### Cambios Realizados
- Deploy de streaming mejorado (ABR + dynamic buffer + probe on-demand) al NAS
- Deploy de viewport `/tv` adaptativo para PC
- Lanzamiento de conversión batch series + re-encode películas pesadas en NAS
- Scripts subidos: `convert-series-batch.js`, `reencode-heavy-movies.js`, `run-all-conversions.sh`
- Cadena automática: series (PID 15909) → email → re-encode 27 películas → email
- Proceso lanzado con `setsid nohup` para sobrevivir desconexión SSH

### Deploy
```bash
# Scripts de conversión
scp scripts/run-all-conversions.sh scripts/reencode-heavy-movies.js isidro@calilu.mooo.com:~/isiprime/scripts/

# Lanzar cadena automática
ssh isidro@calilu.mooo.com "cd ~/isiprime && setsid nohup bash scripts/run-all-conversions.sh > logs/run-all-conversions.log 2>&1 < /dev/null &"

# Monitorizar
ssh isidro@calilu.mooo.com "tail -20 ~/isiprime/logs/convert-series.log"
ssh isidro@calilu.mooo.com "tail -20 ~/isiprime/logs/reencode-movies.log"
```

### Notas
- CRLF fix necesario: `sed -i 's/\r$//' script.sh` (archivos creados en Windows)
- `nohup` simple via SSH no persiste. `setsid nohup ... < /dev/null &` sí lo hace
- Emails de notificación a isidromislata@gmail.com via SMTP del servidor (.env)
- N100 soporta bien la carga continua (TDP 6W, throttle solo a 3.4GHz bajo stress)

---

## Sesion: 2026-03-02 18:18

### Cambios Realizados
- Deploy al NAS via SSH por `calilu.mooo.com` (workaround subredes diferentes WSL/NAS)
- Limpieza de build files antiguos antes de scp (evita archivos JS/CSS huerfanos)
- Monitoreo de normalizacion de audio: 169/576 (~29%), 0 errores, PID 49126

### Deploy via Dominio Publico
```bash
# WSL en 192.168.0.x, NAS en 192.168.1.45 — SSH directo no funciona
# Workaround: usar dominio publico DDNS
ssh isidro@calilu.mooo.com "rm -f ~/isiprime/my-ui/build/static/js/main.*.js ~/isiprime/my-ui/build/static/css/main.*.css"
scp -r my-ui/build/ isidro@calilu.mooo.com:~/isiprime/my-ui/
ssh isidro@calilu.mooo.com "cd ~/isiprime && pm2 restart isiprime"
```

### Normalizacion de Audio (en progreso)
- Script: `scripts/normalize-audio.js` corriendo en NAS (PID 49126)
- Progreso: 169/576 (~29%), 0 errores
- Velocidad: ~2.5 min/archivo
- Estimado restante: ~17 horas
- Monitoreo: `ssh isidro@calilu.mooo.com "tail -20 ~/isiprime/logs/normalize-audio.log"`

### Notas
- Build files desplegados: `main.fcefc682.js`, `main.762507e7.css`
- PM2 restart exitoso (PID 59741, uptime 0s, status online)
- La red WSL cambia de subred segun configuracion — siempre verificar con `ip route` antes de intentar SSH directo

---

## Sesion: 2026-02-22 19:00

### Cambios Realizados
- Revision y correccion de 11 inconsistencias en documentacion de arquitectura para migracion a NAS
- Generacion previa (sesion anterior) de 6 documentos en `docs/nas-migration/` (~6200 lineas)
- Unificacion de specs hardware: LPDDR5, 10GbE+2.5GbE, 2x SATA (no 6)
- Correccion de nginx config en migration-plan: archivos estaticos servidos directamente por nginx
- PM2 ajustado a 4 instancias (cluster mode) para aprovechar 4 cores N100
- DDNS corregido de NoIP a FreeDNS (afraid.org) para dominio calilu.mooo.com

### Archivos Afectados
- `docs/nas-migration/architecture.md`: SATA bays, roles, diagrama hardware
- `docs/nas-migration/migration-plan.md`: DDR5, 10GbE, refresh token, nginx, PM2, bug cols
- `docs/nas-migration/streaming.md`: Rutas /volume1/ → /media/
- `docs/nas-migration/networking.md`: FreeDNS en vez de NoIP

### Codigo Relevante

**nginx config corregida (migration-plan.md) - static files desde nginx:**
```nginx
# Archivos estaticos del frontend - servidos directamente por nginx
location /static/ {
    alias /opt/isiprime/my-ui/build/static/;
    expires 7d;
    add_header Cache-Control "public, immutable";
}

location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|json|manifest)$ {
    root /opt/isiprime/my-ui/build;
    expires 7d;
    add_header Cache-Control "public, immutable";
    try_files $uri @backend;
}

location @backend {
    proxy_pass http://127.0.0.1:8080;
}
```

**PM2 ecosystem corregido (migration-plan.md):**
```javascript
instances: 4,       // Aprovechar los 4 cores del N100 (cluster mode)
```

### Notas
- La documentacion cubre 7 fases de migracion: Debian install, stack, contenido, backend, usuarios, red, testing
- Stack planificado: Debian 12 + Node.js 20 LTS + nginx + SQLite + FFmpeg VAAPI + PM2
- Proximo paso: usar Agent Teams para desarrollo paralelo del codigo de migracion

---

## Sesion: 2026-02-22 11:57

### Cambios Realizados
- Diagnostico de red: servidor WSL en 192.168.0.13/192.168.0.1, router Livebox en 192.168.1.1
- Intentos de conexion a Synology DSM API en puertos 5000/5001 (no accesibles)
- PASV FTP devuelve IP publica 37.14.56.55 (NAS configurado con IP externa)
- Escaneo de red en subnets 192.168.0.x y 192.168.1.x sin encontrar DSM

### Archivos Afectados
- `storage-settings.json`: Campo `nasTotalSize` para capacidad total del disco (4 TB)

### Diagnostico de Red

| Prueba | Resultado |
|--------|-----------|
| `hostname -I` | 192.168.0.13 |
| Gateway | 192.168.0.1 (via eth0) |
| DNS | 8.8.8.8 |
| FTP PASV IP | 37.14.56.55 (publica) |
| Router Livebox 6 | 192.168.1.1 (diferente subnet) |
| Scan 192.168.0.x:5000 | NAS no encontrado |
| Scan 192.168.1.x:5000 | NAS no encontrado |
| DSM 37.14.56.55:5000 | No accesible (puerto cerrado en router) |
| DSM 37.14.56.55:5001 | No accesible (puerto cerrado en router) |
| FTP calilu.mooo.com:21 | OK (funciona) |

### Notas
- El router Livebox 6 de Jazztel solo tiene abierto el puerto 21 (FTP) hacia el NAS
- Subnets diferentes sugieren doble router o VLAN (192.168.0.x para PC, 192.168.1.x para NAS)
- Para acceder a DSM seria necesario abrir puertos 5000/5001 en el router o conocer la IP local del NAS
- Solucion implementada no requiere DSM: listado FTP recursivo + capacidad manual

---

## Sesion: 2026-02-21 14:05

### Cambios Realizados
- Diagnostico y eliminacion de procesos Node.js obsoletos en puerto 8080
- Modificacion del descargador Python (prueba2.py) para separar fragmentos temporales de yt-dlp
- Fix causa raiz: `-o` con ruta absoluta anulaba `--paths temp:` en yt-dlp

### Archivos Afectados
- `prueba2.py` (externo: `F:\Utiles de python para videos\descarga_youtube\`): Funciones `_download_video_sync` y `download_video` modificadas

### Codigo Relevante

**Fix yt-dlp paths en prueba2.py:**
```python
# ANTES (no funcionaba):
cmd.extend(["--paths", f"temp:{temp_fragments_dir}"])
cmd.extend(["-o", f"{output}/%(title)s.%(ext)s"])  # ABSOLUTA -> anula --paths

# DESPUES (correcto):
cmd.extend(["-P", f"home:{output}"])               # Base dir para archivo final
cmd.extend(["-P", f"temp:{temp_fragments_dir}"])    # Dir para fragmentos
cmd.extend(["-o", "%(title)s.%(ext)s"])             # RELATIVA -> --paths funciona
```

### Notas
- El usuario ejecuta `YouTubeDownloader.exe` (PyInstaller). Necesita recompilar para que apliquen los cambios.
- Comando de recompilacion: `pyinstaller --onefile --windowed prueba2.py -n YouTubeDownloader`
- Fragmentos temporales van a: `C:\Users\isidr\Videos\Transcripciones`
- Diagnostico de puertos: `netstat.exe -ano | findstr 8080`

---

## Sesion: 2026-02-20 18:00

### Cambios Realizados
- Diagnostico exhaustivo de conectividad LAN (puerto 8080 bloqueado por WFP residual de Kaspersky)
- Frontend compilado 4 veces (pestanas, fix color, fix PiP, sinopsis)
- Error EACCES en servidor cuando proceso anterior no se cerro correctamente

### Diagnostico de Red Completo

| Prueba | Resultado |
|--------|-----------|
| `netstat -ano` (0.0.0.0:8080 LISTENING) | OK |
| `curl localhost:8080` | OK |
| `curl 192.168.1.18:8080` | FALLO (timeout) |
| `Test-NetConnection 192.168.1.18 -Port 8080` | TcpTestSucceeded: False |
| Firewall Windows desactivado | Sigue fallando |
| Python server puerto 9090 | Mismo problema |
| Kaspersky procesos/drivers | Ninguno activo |
| Ping al TV (192.168.1.94) | OK |
| Acceso desde movil | FALLO |
| Adaptadores red (Get-NetAdapterBinding) | Solo componentes Microsoft |

**Conclusion**: Filtros WFP residuales de Kaspersky. Solucion: `netsh winsock reset` + reinicio.

### Notas
- **CRITICO**: Firewall de Windows quedo DESACTIVADO. Reactivar inmediatamente.
- IP del PC cambio: fue 192.168.1.18, ahora 192.168.0.27 (cambio de red/router)
- Build final: 144.91 kB JS gzip, 9.3 kB CSS gzip
- Se creo regla de firewall "IsiPrime Server" (TCP 8080 Inbound Allow Any) que queda para cuando se reactive el firewall

---

## Sesion: 2026-02-16 15:00

### Cambios Realizados
- Nuevas dependencias npm: `node-ssdp@4.0.1`, `upnp-mediarenderer-client@1.4.0`
- Commit y push a GitHub: `275c515` con 30 archivos, +3758 lineas
- Frontend compilado 3 veces durante la sesion (DLNA, PiP, Aleatorio+Recomendaciones)

### Archivos Afectados
- `package.json`: 2 nuevas dependencias
- `package-lock.json`: Actualizado con arbol de dependencias

### Notas
- Build se ejecuta desde PowerShell (no WSL) por velocidad: `cd F:\plex\my-ui; npm run build`
- PowerShell usa `;` en vez de `&&` para encadenar comandos
- El `my-ui/build/` generado no se commitea a git (se sirve localmente)
- Tamano final del bundle: 144.92 kB gzip JS, 9.2 kB gzip CSS

---

## Sesion: 2026-02-16 12:00

### Cambios Realizados
- Actualizacion completa del paquete de instalacion `IsiPrime-Install/` con la version actual del codigo
- Creacion de `CLAUDE.md` para documentar arquitectura y comandos del proyecto
- Creacion de estructura `docs/` para documentacion de sesiones

### Archivos Afectados
- `IsiPrime-Install/server.js`: Copiado del principal (binding 0.0.0.0 para LAN)
- `IsiPrime-Install/routes/requests.js`: Fix auto-eliminacion con requestedAt
- `IsiPrime-Install/routes/streaming.js`: MKV servido nativamente
- `IsiPrime-Install/db/requests-db.js`: SQL usa requested_at
- `IsiPrime-Install/my-ui/build/`: Frontend completo reemplazado (44 archivos, 3.1 MB)
- `CLAUDE.md`: Nuevo archivo de documentacion del proyecto

### Codigo Relevante

Diferencias clave entre el proyecto principal y el Install:

**server.js** - Binding para acceso LAN:
```javascript
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Hermes activo en puerto ${PORT}`);
    console.log(`Escuchando en http://0.0.0.0:${PORT} (accesible desde la red local)`);
});
```

**routes/requests.js** - Fix auto-eliminacion (usa requestedAt en vez de updatedAt):
```javascript
// Eliminar peticiones completadas hace mas de 7 dias (basado en fecha de peticion)
if (request.status === 'downloaded' || request.status === 'server') {
    const dateStr = request.requestedAt || request.requested_at || request.updatedAt || request.updated_at;
    const requestDate = dateStr ? new Date(dateStr) : null;
    if (requestDate && !isNaN(requestDate.getTime()) && requestDate < sevenDaysAgo) {
        // Auto-eliminar
    }
}
```

**db/requests-db.js** - SQL corregido:
```javascript
const stmt = db.prepare(`
    DELETE FROM requests
    WHERE status IN ('downloaded', 'server')
    AND requested_at < ?
`);
```

### Notas
- El paquete Install preserva sus archivos especificos: `.env` (calilu.mooo.com), `storage-settings.json` (FTP mode), BATs de instalacion/launcher
- El acceso desde red local (192.168.1.18:8080) sigue sin funcionar a pesar del binding 0.0.0.0 y regla de firewall
- Se verifico con `diff` que la mayoria de archivos (routes/series.js, tmdb.js, lib/*.js) eran identicos entre principal e Install

---
