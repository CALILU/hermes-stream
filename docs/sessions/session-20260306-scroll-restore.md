# Sesion 2026-03-06 — Scroll/Foco Restore + Detail Layout Fix + Backdrop Quality

## Resumen
Implementacion de restauracion completa de scroll y foco en la vista Home de la TV app al volver del detalle de una pelicula. Tambien fix de calidad de backdrop images (blurry → sharp) y conversion de series HEVC.

## Cambios Principales

### 1. Scroll/Foco Restore en Home (TV App)
**Problema**: Al entrar en el detalle de una pelicula y volver con BACK, la vista Home se reconstruia desde cero (scroll arriba, primer carrusel, primera pelicula). Experiencia de usuario mala.

**Solucion en 4 fases**:

1. **Save/restore basico** (parcial): guardar scrollTop + row index + carousel index en `hide()`, restaurar en `show()` con setTimeout. Problema: shuffle cambiaba el orden.

2. **Cache de shuffle** (fix orden): `_cachedGenreGroups`/`_cachedGenreOrder` persisten entre hide/show. Solo se hace Fisher-Yates en la primera carga, no al volver.

3. **Identificacion por filename** (fix foco horizontal): guardar `filename` de la pelicula enfocada, buscarla por identidad en el carrusel reconstruido (en vez de por indice numerico).

4. **Sin flash visual** (UX): `visibility: hidden` durante rebuild, init sincrono de todas las lazy rows, scroll + focusAt antes de hacer visible, reveal con setTimeout 20ms.

**Detalles tecnicos**:
- `App.Focus._currentGroup = groupId` directo en vez de `setActiveGroup()` — evita callback `onFocus` que dispara `focusAt(0)` reseteando la posicion
- `_buildMoviesView(restoreScroll)` recibe flag para no hacer `setActiveGroup` al primer carrusel
- Router pasa `isBack` a `App.Home.show()` via `_switchTo`

### 2. Backdrop Quality Fix
**Problema**: Backdrops borrosos en el detalle de peliculas en la TV.

**Causa raiz**: `ensureFullPosterURL()` en `lib/utils.js` tenia 2 bugs:
- Paths `/api/img/w342/xxx.jpg` se devolvian sin cambiar size (early return)
- TMDB legacy URLs usaban el size de la URL en vez del parametro solicitado

**Solucion**: Reescribir `ensureFullPosterURL()` para reemplazar size en ambos formatos.

**Iteraciones de size**:
- `w342` → borroso (original, bug)
- `w1280` → no existe en poster-cache VALID_SIZES, imagen no carga
- `original` → ~600KB, demasiado lento para render en TV
- `w780` → ~100KB, balance perfecto calidad/rendimiento (FINAL)

Prewarm ejecutado en NAS: 837 backdrops descargados en 11s, 0 fallos.

### 3. Detail View Layout Fix (TV App)
**Problema**: En la pantalla de detalle de pelicula, al navegar con D-pad a los actores del cast, toda la vista (titulo, meta, sinopsis, botones) scrolleaba hacia arriba y desaparecia.

**Solucion**: Split de `.detail-content` en dos zonas con flexbox column:
- `.detail-info-fixed` (`flex-shrink: 0`): titulo, meta, generos, sinopsis, botones Play/Favorito/Saga — fijos
- `.detail-cast-wrapper` (`flex: 1; min-height: 0; overflow-y: auto`): galeria de actores — scrollable independiente

**Cambios CSS**:
- `.detail-overlay`: `overflow: hidden`
- `.detail-content`: `height: 100%; display: flex; flex-direction: column; overflow: hidden`
- `.detail-info-fixed`: `flex-shrink: 0; padding: 120px 60px 0`
- `.detail-cast-wrapper`: `flex: 1; min-height: 0; overflow-y: auto; padding: 0 60px 60px`

**Cambios JS (detail.js)**:
- DOM restructurado: info elements → `infoFixed` div, cast section → `castWrapper` div
- `_setCastFocus()`: scroll within `_castWrapperEl` instead of entire content
- `hide()`: cleanup `_castWrapperEl = null`

### 4. Actor Grid Navigation Fix (TV App)
**Problema**: En la galeria de filmografia de un actor, cursor abajo movia a la derecha en vez de bajar a la siguiente fila.

**Solucion**: Deteccion dinamica de columnas basada en ancho del grid container:
- `GRID_COLS_DEFAULT = 7` (antes hardcoded 5)
- Calculo: `Math.floor(gridEl.clientWidth / 224)` (200px item + 24px gap)
- Usado en `_handleGridNav()` para UP/DOWN navigation

### 5. Fix probeFile() en reencode-heavy-movies.js
**Problema**: Todas las conversiones de peliculas pesadas fallaban con "Output probe failed" — FFmpeg terminaba OK pero el probe del output descartaba el archivo.

**Causa raiz**: `ffprobe` con `-select_streams v:0 ... -select_streams a:0 ...` — el segundo flag sobreescribia al primero, solo obtenia streams de audio, `video_codec` quedaba `null` y la validacion lo rechazaba.

**Solucion**: Eliminar `-select_streams`, pedir todas las streams con `-show_entries stream=codec_type,codec_name,width,height,channels,sample_rate` y filtrar por `codec_type` en JS.

**Impacto**: Los originales no se perdieron (el script solo reemplaza tras probe exitoso). Proceso relanzado con fix — 27 peliculas desde cero.

### 6. HEVC Beauty Series
**Problema**: 5 episodios de "The Beauty" en HEVC 4K no se reproducen en webOS (MSE/fMP4 no soporta HEVC).

**Solucion**: Script `reencode-beauty.sh` que convierte a H.264 1080p (libx264 preset faster crf 20). Queued tras re-encode de peliculas pesadas.

## Archivos Modificados
- `IsiPrime-WebOS-Native/js/home.js`: scroll/foco restore completo
- `IsiPrime-WebOS-Native/js/router.js`: pasa `isBack` a show()
- `IsiPrime-WebOS-Native/js/detail.js`: layout split (info fija + cast scrollable)
- `IsiPrime-WebOS-Native/js/actor.js`: deteccion dinamica de columnas grid
- `IsiPrime-WebOS-Native/css/styles.css`: clases `.detail-info-fixed`, `.detail-cast-wrapper`
- `tv-app/js/home.js`, `tv-app/js/router.js`, `tv-app/js/detail.js`, `tv-app/js/actor.js`, `tv-app/css/styles.css`: copias sincronizadas
- `lib/utils.js`: fix `ensureFullPosterURL()`
- `lib/normalizers.js`: backdrop `w780`
- `lib/poster-cache.js`: prewarm backdrop `w780`
- `scripts/reencode-heavy-movies.js`: fix probeFile() — `-select_streams` duplicado
- `scripts/reencode-beauty.sh`: conversion HEVC (NUEVO)

## Patron: Restore de Estado en Vistas TV
```
// En hide():
1. Guardar scrollTop del container
2. Encontrar carousel activo via App.Focus._currentGroup
3. Guardar groupId, focusIndex, filename de la pelicula

// En show(data, isBack):
1. Detectar restoreScroll = isBack && misma seccion && savedRowIndex >= 0
2. visibility: hidden (evita flash)
3. Construir DOM (reusar cache si restore)
4. Init sincrono de lazy rows
5. Restaurar scrollTop
6. Buscar carousel por groupId
7. Buscar pelicula por filename en _items
8. carousel.focusAt(movieIndex)
9. App.Focus._currentGroup = groupId (directo)
10. setTimeout 20ms → visibility: '' (reveal)
```
