# Bugs - Historial de Cambios

---

## Sesion: 2026-03-02 18:18

### Bugs Resueltos

#### 1. Reorganizacion masiva del header rompio la pagina
- **Sintoma**: Intento de eliminar Sorprendeme + mover botones a SettingsModal de golpe desconfiguro toda la UI
- **Causa raiz**: Demasiados cambios simultaneos en App.js (estructura JSX, imports, estados)
- **Solucion**: `git checkout` para revertir, luego cambios incrementales paso a paso

#### 2. Build viejo no se reemplazaba en NAS
- **Sintoma**: Tras scp del nuevo build, la app seguia mostrando codigo viejo
- **Causa raiz**: El archivo JS antiguo (`main.33a32d55.js`) no se borraba; el nuevo tenia hash diferente
- **Solucion**: `rm -f main.*.js main.*.css` antes de scp, luego verificar con ls

#### 3. Badge "Pedida" no desaparecia al borrar desde modal Peticiones
- **Sintoma**: Al eliminar peticion desde RequestsAdminModal, el badge ambar persistia en la galeria de sagas
- **Causa raiz**: `deleteRequest` llamaba `loadAllRequests()` que sobreescribia `existingRequests` con datos potencialmente desactualizados. Ademas, la primera version de `toggleSagaRequest` usaba `data.requests` pero la API devuelve `data.added`
- **Archivos**: `my-ui/src/hooks/useRequests.js`
- **Solucion**: Reemplazar `loadAllRequests()` por actualizaciones directas: `setExistingRequests(prev => prev.filter(...))` + `setAllRequests(prev => prev.filter(...))`

#### 4. 401 en busqueda TMDB para usuarios remotos
- **Sintoma**: Usuarios remotos no podian buscar peliculas. Consola mostraba 401 en `/api/tmdb/search` y `/api/tmdb/actor`
- **Causa raiz**: 3 endpoints usaban `fetch()` plano en vez de `authFetch()`. Sin JWT, el middleware rechazaba la peticion
- **Archivos**: `useRequests.js` (lineas 84, 115), `useVideos.js` (linea 363)
- **Solucion**: Cambiar `fetch(...)` → `authFetch(...)` en los 3 sitios

#### 5. SSH desde WSL no llega al NAS
- **Sintoma**: `ssh isidro@192.168.1.45` timeout (Connection timed out)
- **Causa raiz**: WSL esta en subred 192.168.0.x, NAS en 192.168.1.45 (subredes diferentes)
- **Solucion**: Usar `calilu.mooo.com` (dominio publico DDNS) como host SSH

---

## Sesion: 2026-02-22 19:00

### Bugs Resueltos

#### 1. Variable `cols` fuera de scope en script de migracion (documentacion)
- **Archivo**: `docs/nas-migration/migration-plan.md` (linea ~1047)
- **Sintoma**: En el script de migracion de collections.json a SQLite, `cols` se usaba fuera de su scope
- **Causa raiz**: `cols` se define dentro de `db.transaction()`, pero el `console.log` que la referencia esta fuera
- **Solucion**: Cambiar `console.log(cols?.length)` por `console.log(count)` (variable en scope correcto)

#### 2. 10 inconsistencias de datos entre documentos de arquitectura
- **Archivos**: `docs/nas-migration/*.md` (6 documentos)
- **Sintomas**: Specs hardware incorrectos (DDR4 vs DDR5, 6 SATA vs 2), roles inconsistentes, tokens con duraciones distintas, rutas Synology obsoletas, proveedor DDNS incorrecto
- **Solucion**: Revision cruzada sistematica y correccion de cada inconsistencia (ver session-20260222-1900.md)

---

## Sesion: 2026-02-21 14:05

### Bugs Resueltos

#### 1. Extension Chrome no actualizaba estado de peticion a "downloading"
- **Sintoma**: Al descargar desde OK.ru con la extension, la peticion se quedaba en "pending".
- **Causa raiz (multiple):**
  - Titulo en ingles vs peticion en espanol (no comparaba `originalTitle`)
  - Chequeo de duplicados (409) bloqueaba el matching
  - Extension extraia titulo de canal/playlist, no de la pelicula
  - Multiples servidores Node.js en puerto 8080 (peticiones iban al viejo)
- **Archivos**: `routes/downloads.js`, `lib/download-helpers.js`, `my-ui/src/components/RequestsAdminModal.js`
- **Solucion**: Sistema pendingRequestId + matching originalTitle + re-crear duplicados + matar procesos viejos

#### 2. Fragmentos de yt-dlp no iban a carpeta temporal
- **Sintoma**: `--paths temp:C:\Users\isidr\Videos\Transcripciones` no tenia efecto. Fragmentos seguian en carpeta de video.
- **Causa raiz**: `-o` tenia ruta absoluta (`f"{output}/%(title)s.%(ext)s"`). Segun documentacion yt-dlp: "si `-o` es absoluta, `--paths` se ignora completamente".
- **Archivo**: `prueba2.py` (externo: `F:\Utiles de python para videos\descarga_youtube\`)
- **Solucion**: Cambiar a `-P home:{output}` + `-P temp:{temp_dir}` + `-o %(title)s.%(ext)s` (relativa)

#### 3. Multiples servidores Node.js en puerto 8080
- **Sintoma**: La extension Chrome enviaba POST pero no habia logs en el servidor con el codigo nuevo.
- **Causa raiz**: 3 procesos Node.js escuchaban en 8080 (PIDs 29592, 4644, 21128). Las peticiones iban a servidores viejos sin las correcciones.
- **Solucion**: `taskkill.exe /PID X /F` para cada proceso obsoleto.

### Bugs Conocidos (no resueltos)
- Los de sesion 2026-02-20 siguen pendientes (WFP Kaspersky, firewall, TV LG DLNA)

---

## Sesion: 2026-02-20 18:00

### Bugs Resueltos

#### 1. PiP pierde audio y desaparece al cerrar reproductor
- **Sintoma**: Al activar PiP y cerrar la barra compacta, la ventana PiP se quedaba sin sonido. Al intentar maximizar (salir de PiP), la ventana desaparecia.
- **Causa raiz**: El boton X de la barra PiP llamaba `onClose()` que ponia `selectedVideo = null`, desmontando el componente VideoPlayer. Esto destruia el elemento `<video>` del DOM y el `AudioContext` (Web Audio API / GainNode del volume boost).
- **Archivo**: `my-ui/src/components/VideoPlayer.js`
- **Solucion**: Cierre diferido con `pendingCloseRef` y `pipBarHidden`. El boton X solo oculta la barra y marca pendingClose. El PiP nativo sigue vivo. Cuando el usuario cierra la ventana PiP nativa (evento `leavepictureinpicture`), entonces se llama onClose().

#### 2. Texto "Todos los generos" invisible en panel de sagas
- **Sintoma**: El texto del select no se veia (color oscuro sobre fondo oscuro).
- **Causa raiz**: Faltaba clase `text-white` en el className del `<select>`.
- **Archivo**: `my-ui/src/App.js` (linea ~1567)
- **Solucion**: Anadido `text-white` al className.

### Bugs Conocidos (no resueltos)

#### 3. Puerto 8080 inaccesible desde IP LAN
- **Sintoma**: `http://192.168.1.18:8080` (o `192.168.0.27:8080`) no responde desde ningun dispositivo de la red (movil, TV, ni el propio PC por IP LAN). Localhost funciona.
- **Diagnostico completo**:
  - Servidor escucha en `0.0.0.0:8080` (confirmado netstat)
  - Firewall Windows desactivado completamente: sigue fallando
  - Python HTTP server en puerto 9090: mismo problema (descarta Node.js)
  - Kaspersky detectado como AV instalado (productState 266240) pero sin procesos/drivers activos
  - No hay filtros de red de terceros en el adaptador Wi-Fi
  - Afecta a TODO el sistema, no solo al puerto 8080
- **Causa probable**: Filtros WFP (Windows Filtering Platform) residuales de Kaspersky
- **Solucion pendiente**: `netsh winsock reset` + `netsh int ip reset` + reiniciar PC
- **CRITICO**: El firewall de Windows quedo DESACTIVADO durante el diagnostico. Reactivar con `Set-NetFirewallProfile -All -Enabled True`.

#### 4. TV LG DLNA no acepta conexiones
- **Sintoma**: SSDP descubre la TV (192.168.1.94), el comando UPnP llega (pantalla se oscurece), pero la TV no puede descargar el stream (error 716 "Resource not found").
- **Modelo**: LG 43UP80006LR, webOS 6.5.3-47 (kisscurl-koli)
- **Diagnostico**: Incluso el antiguo PC Windows 10 que antes funcionaba ya no puede conectarse a la TV. El problema es del televisor, no del PC.
- **Causa probable**: Actualizacion de firmware webOS 6.5.3 que deshabilito DMR
- **Solucion pendiente**: Revisar ajustes DLNA/DMR en la TV, reinicio de red del TV, o factory reset

---
