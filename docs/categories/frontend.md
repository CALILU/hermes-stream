# Frontend - Historial de Cambios

---

## Sesion: 2026-03-06 (noche)

### Cambios Realizados — Newsletter: Recipient Selection + History View + Resend

**Hook (`useNewsletter.js`):**
- Estado `recipients`, `selectedRecipientIds` — cargados desde `/api/auth/users` (filtrados por email)
- `toggleRecipient(userId)`, `toggleAllRecipients(selectAll)` — con persistencia localStorage (clave `newsletter_excluded_recipients`, logica invertida: guarda excluidos)
- `sendNewsletter()` envia `recipientIds` en el body
- `loadNewsletterDetail(id)` — `GET /api/newsletter/:id`, guarda en `selectedHistoryEntry`
- `resendNewsletter(id)` — `POST /api/newsletter/:id/resend` con `selectedRecipientIds`
- `closeHistoryDetail()` — limpia `selectedHistoryEntry` y `resendResult`
- `_buildMoviePayload()` helper extraido para evitar duplicacion

**Modal (`NewsletterModal.js`):**
- Search X clear button con `searchInputRef.current?.focus()` para refocus
- Tab Preview: seccion destinatarios con checkboxes (CheckSquare/Square icons), "Seleccionar/Deseleccionar todos", boton "Enviar a X usuarios" (disabled si 0 seleccionados)
- Tab Historial: tarjetas clickeables → vista detalle con:
  - Back arrow + titulo + fecha/stats + badge status (incluye "Reenviado" en purple)
  - Recipient checkboxes para reenvio (reusan misma persistencia localStorage)
  - Boton "Reenviar a X usuarios" (RotateCcw icon)
  - Preview iframe con `srcDoc={html_content}` + sandbox
  - Si no hay `html_content`: mensaje "Preview no disponible"
  - Loading spinner mientras carga detalle
- Delete button usa `e.stopPropagation()` para no abrir detalle
- Nuevos imports: `ArrowLeft`, `RotateCcw`

### Archivos Afectados
- `my-ui/src/hooks/useNewsletter.js`: recipients state, localStorage persistence, detail/resend functions
- `my-ui/src/components/NewsletterModal.js`: recipient checkboxes, history detail view, search X button
- `my-ui/src/App.js`: destructure + pass new props (selectedHistoryEntry, loadingHistoryDetail, resending, resendResult, onLoadHistoryDetail, onResendNewsletter, onCloseHistoryDetail)

---

## Sesion: 2026-03-06 (tarde)

### Cambios Realizados — TV App: Per-user Identity
- **`api.js`**: deteccion automatica de serial/modelo TV via 3 estrategias:
  1. `PalmSystem.deviceInfo` (sincrono, todos webOS) — extrae `serialNumber` + `modelName`
  2. `webOS.deviceInfo()` callback (webOSTV.js) — solo webOS 5+
  3. Luna Service `com.webos.service.tv.systemproperty` — fallback
- Serial/modelo cacheados en `localStorage` (`isiprime_tv_serial`, `isiprime_tv_model`)
- Headers `X-TV-Serial` y `X-TV-Model` enviados en TODAS las peticiones (`_fetch` + `init`)
- `_username` y `_userRole` guardados desde respuesta de `/api/auth/status`
- **`requests.js`**: `requestedBy` usa `App.API._username` en vez de "TV" generico
- **`requests.js`**: admin detection cambiada de `App.API._isLocal` a `App.API._userRole === 'admin'`

### Archivos Afectados
- `IsiPrime-WebOS-Native/js/api.js`: `_detectTVSerial()`, `_lunaGetSerial()`, `_serialHeader()`, `_tvSerial`, `_tvModel`, `_username`, `_userRole`
- `IsiPrime-WebOS-Native/js/requests.js`: requestedBy + isAdmin
- `tv-app/js/api.js`, `tv-app/js/requests.js`: copias sincronizadas

### Notas
- Timeout 2s en `_detectTVSerial()` para no bloquear init si Luna/webOS API falla
- En browser (`/tv`), `PalmSystem` y `webOS` no existen → skip deteccion (Promise.resolve)
- Verificado en TV real: Pablo (LG 32LK6100PLB) identificado por modelo, favoritos independientes de Isidro

---

## Sesion: 2026-03-06 (manana)

### Cambios Realizados — TV App: Scroll/Foco Restore
- **Restauracion de scroll vertical**: al volver del detalle (BACK), la vista Home restaura `scrollTop` exacto
- **Restauracion de foco horizontal**: el carrusel enfoca la pelicula exacta (por `filename`, no por indice)
- **Cache de orden shuffled**: `_cachedGenreGroups`/`_cachedGenreOrder` evitan reshuffle al volver
- **Sin flash visual**: `visibility: hidden` durante rebuild + init sincrono de lazy rows + reveal en 20ms
- **Fix competencia de foco**: `_buildMoviesView` no hace `setActiveGroup` en restore, y restore usa `_currentGroup` directo (evita callback `onFocus` que reseteaba a indice 0)

### Cambios Realizados — Backdrop Quality
- **Fix `ensureFullPosterURL()`**: paths `/api/img/` ahora reemplazan size cuando se pasa parametro (antes se devolvian tal cual con w342)
- **Fix TMDB legacy URLs**: usa size solicitado en vez del size extraido de la URL
- **Backdrop size**: `w780` (~100KB) — balance entre calidad y rendimiento TV (original ~600KB demasiado lento)
- **Prewarm backdrops**: 837 descargadas en 11s, 0 fallos

### Cambios Realizados — TV App: Detail View Layout Fix
- **Info fija + cast scrollable**: `.detail-content` split en flexbox column
  - `.detail-info-fixed` (`flex-shrink: 0`): titulo, meta, generos, sinopsis, botones — no scrollea
  - `.detail-cast-wrapper` (`flex: 1; min-height: 0; overflow-y: auto`): galeria actores — scrollea independiente
- **`_setCastFocus()`**: scroll within `_castWrapperEl` en vez del contenedor completo

### Cambios Realizados — TV App: Actor Grid Navigation Fix
- **Deteccion dinamica de columnas**: `Math.floor(gridEl.clientWidth / 224)` en vez de hardcoded 5
- **`GRID_COLS_DEFAULT = 7`**: fallback para cuando el grid no esta montado aun

### Archivos Afectados
- `IsiPrime-WebOS-Native/js/home.js`: scroll/foco restore completo (visibility, cache genreGroups, focusAt por movieId)
- `IsiPrime-WebOS-Native/js/router.js`: pasa `isBack` a `App.Home.show()`
- `IsiPrime-WebOS-Native/js/detail.js`: layout split (info fija + cast scrollable), `_castWrapperEl`
- `IsiPrime-WebOS-Native/js/actor.js`: deteccion dinamica columnas grid (`GRID_COLS_DEFAULT`, clientWidth)
- `IsiPrime-WebOS-Native/css/styles.css`: `.detail-info-fixed`, `.detail-cast-wrapper`
- `lib/utils.js`: fix `ensureFullPosterURL()` — size replacement en `/api/img/` paths y TMDB URLs
- `lib/normalizers.js`: backdrop size `w780`
- `lib/poster-cache.js`: prewarm backdrop size `w780`
- `tv-app/`: copias sincronizadas (home, router, detail, actor, styles.css)

### Mecanismo de Restore (home.js)
```
hide():
  1. Guardar scrollTop, seccion activa
  2. Encontrar carousel activo por App.Focus._currentGroup
  3. Guardar groupId (ej: 'genre-28'), focusIndex, y filename de la pelicula

show(data, isBack):
  1. Si isBack + misma seccion + savedRowIndex >= 0 → restoreScroll=true
  2. visibility: hidden (evita flash)
  3. Construir DOM con _buildMoviesView(restoreScroll=true)
     → Reusar _cachedGenreGroups (sin reshuffle)
     → No hacer setActiveGroup al primer carousel
  4. Init sincrono de TODAS las lazy rows
  5. scrollTop = savedScrollTop
  6. Buscar carousel por savedGroupId
  7. Buscar pelicula por filename en carousel._items
  8. carousel.focusAt(movieIndex)
  9. App.Focus._currentGroup = groupId (directo, sin callback)
  10. setTimeout 20ms → visibility: '' (reveal)
```

---

## Sesion: 2026-03-05

### Cambios Realizados
- **Modal Gestión Usuarios rediseñado**: tarjetas expandibles por usuario (click para abrir/cerrar)
  - Sección datos: email editable inline, notificaciones toggle, fecha creación
  - Sección TVs: lista con marca/modelo/año/IP/webOS, botón eliminar, formulario "Añadir TV"
  - Watching status: icono Play verde pulsante + nombre película si usuario está viendo
  - Auto-refresh cada 30s mientras modal abierto
- **Búsqueda de sagas**: input "Buscar saga..." en tab Sagas, filtrado accent-insensitive (NFD)
- **Botones redundantes eliminados** del panel Sagas (Pedir Película, Ver Peticiones, etc.)

### Archivos Afectados
- `my-ui/src/components/UserManagementModal.js`: rediseño completo con tarjetas expandibles, TVs, watching
- `my-ui/src/hooks/useUsers.js`: `updateUser()` genérico, `addUserTV()`, `deleteUserTV()`, auto-refresh 30s
- `my-ui/src/App.js`: estado `sagaSearch`, input búsqueda sagas, eliminación botones redundantes

### Notas
- `useUsers.js` usa `updateUser(userId, data)` genérico en vez del antiguo `updateUserEmail`
- Imports nuevos lucide-react: ChevronDown, ChevronRight, Monitor, Plus, User, Wifi

---

## Sesion: 2026-03-02 18:18

### Cambios Realizados
- Eliminacion completa del boton "Sorprendeme" (import Shuffle, import RandomPickerModal, estado showRandomModal, boton mobile, boton desktop, componente RandomPickerModal)
- Boton "Peticiones" (📋) cambiado de icono admin-only a boton texto visible para todos los usuarios
- Galeria de sagas: peliculas no-catalogo en B&N (grayscale + opacity 50%) con badge "No disponible"
- Toggle de peticiones desde galeria de sagas: click en pelicula no-catalogo crea/cancela peticion con badge ambar "Pedida"
- Sincronizacion de badges: borrar desde modal Peticiones actualiza badge en galeria de sagas instantaneamente
- Fix 401 en busqueda TMDB: 3 endpoints cambiados de `fetch` a `authFetch` (useRequests x2, useVideos x1)

### Archivos Afectados
- `my-ui/src/App.js`: Eliminar Sorprendeme, boton Peticiones para todos, rendering condicional B&N + badges
- `my-ui/src/hooks/useVideos.js`: Estado `collectionFullParts`, useEffect fetch full parts, merge no-catalogo en filteredVideos, fix authFetch
- `my-ui/src/hooks/useRequests.js`: Nueva funcion `toggleSagaRequest()`, fix authFetch en TMDB search/actor, fix deleteRequest sync

### Codigo Relevante

**useVideos.js - Merge peliculas catalogo + no-catalogo en saga:**
```javascript
if (collectionFullParts) {
  const localByTmdb = {};
  result.forEach(v => { if (v.tmdbId) localByTmdb[v.tmdbId] = v; });
  result = collectionFullParts.map(part => {
    if (part.inCatalog && localByTmdb[part.tmdbId]) return localByTmdb[part.tmdbId];
    return {
      filename: `_saga_${part.tmdbId}`, title: part.title,
      poster: part.poster, tmdbId: part.tmdbId, _notInCatalog: true,
    };
  });
}
```

**useRequests.js - Toggle peticion desde saga:**
```javascript
const toggleSagaRequest = async (movie) => {
  const existing = existingRequests.find(r =>
    Number(r.tmdbId) === Number(movie.tmdbId) && r.status !== 'server'
  );
  if (existing) {
    await authFetch(`${API_BASE}/api/requests/${existing.id}`, { method: 'DELETE' });
    setExistingRequests(prev => prev.filter(r => r.id !== existing.id));
    setAllRequests(prev => prev.filter(r => r.id !== existing.id));
  } else {
    await authFetch(`${API_BASE}/api/requests`, { method: 'POST', ... });
    // Reload from server to get correct IDs
  }
};
```

**App.js - Rendering condicional B&N + badge:**
```jsx
<img className={`... ${video._notInCatalog ? 'grayscale opacity-50' : ''}`} />
{video._notInCatalog && (
  isMovieRequested(video.tmdbId)
    ? <div className="bg-amber-500/90 ...">Pedida</div>
    : <div className="bg-black/70 ...">No disponible</div>
)}
```

### Notas
- `RandomPickerModal.js` sigue en disco pero ya no se importa (limpieza pendiente)
- POST `/api/requests` devuelve `{success, created, duplicates, total, added}` — NO `data.requests`
- `deleteRequest` usa actualizaciones directas de estado en vez de `loadAllRequests()` para reactividad instantanea
- Build files: `main.fcefc682.js`, `main.762507e7.css`

---

## Sesion: 2026-02-22 11:57

### Cambios Realizados
- Nueva seccion "Almacenamiento NAS/Local" en SettingsModal entre modo almacenamiento y cache
- Barra de progreso visual con colores dinamicos: verde (<70%), amarillo (70-85%), rojo (>85%)
- Tarjetas de datos cuando solo hay listado FTP (espacio usado + cantidad archivos)
- Campo "IP local del NAS" con boton guardar (solo en modo FTP)
- Estados de carga (spinner), error y datos parciales
- Auto-fetch al abrir modal y al cambiar modo de almacenamiento
- Import de `useState`, `useEffect` y icono `Database` de lucide-react

### Archivos Afectados
- `my-ui/src/components/SettingsModal.js`: Seccion completa de espacio en disco (~100 lineas)
- `my-ui/build/`: Frontend recompilado

### Codigo Relevante

**Estados y fetch:**
```javascript
const [diskUsage, setDiskUsage] = useState(null);
const [diskLoading, setDiskLoading] = useState(false);
const [diskError, setDiskError] = useState(null);
const [nasIP, setNasIP] = useState('');

useEffect(() => {
    if (settingsModal) {
        fetchDiskUsage();
        fetch('/api/storage/config').then(r => r.json()).then(data => {
            if (data.nasLocalIP) setNasIP(data.nasLocalIP);
        });
    }
}, [settingsModal, storageMode]);
```

**Barra con colores dinamicos:**
```javascript
const getBarColor = (pct) => {
    if (pct > 85) return 'from-red-500 to-red-600';
    if (pct > 70) return 'from-yellow-500 to-orange-500';
    return 'from-emerald-500 to-green-500';
};
```

**Tarjetas de datos FTP listing (sin total):**
```jsx
{diskUsage && diskUsage.fromListing && diskUsage.percentage == null && (
    <div className="flex items-center gap-3">
        <div className="bg-teal-500/20 rounded-lg p-3 text-center flex-1">
            <p className="text-lg font-bold text-teal-400">{formatBytes(diskUsage.used)}</p>
            <p className="text-xs text-slate-400">Espacio usado</p>
        </div>
        <div className="bg-slate-700/50 rounded-lg p-3 text-center flex-1">
            <p className="text-lg font-bold text-slate-300">{diskUsage.fileCount}</p>
            <p className="text-xs text-slate-400">Archivos</p>
        </div>
    </div>
)}
```

### Notas
- Build gzip: 145.92 kB JS (+1 kB), 9.36 kB CSS
- El campo de IP del NAS guarda via POST /api/storage/nas-ip y refresca datos automaticamente
- 3 modos de visualizacion: barra completa (total+usado), tarjetas (solo usado), parcial (solo libre)

---

## Sesion: 2026-02-21 14:05

### Cambios Realizados
- Boton lupa (buscar en OK.ru) ahora guarda requestId en servidor antes de abrir OK.ru

### Archivos Afectados
- `my-ui/src/components/RequestsAdminModal.js`: onClick del boton lupa envia POST con requestId
- `my-ui/build/`: Frontend recompilado

### Codigo Relevante

**RequestsAdminModal.js - POST requestId al clic en lupa:**
```javascript
onClick={() => {
    fetch('/api/download-queue/pending-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: request.id })
    }).catch(() => {});
    window.open(`https://ok.ru/dk?st.cmd=searchResult&st.mode=Movie&st.query=${encodeURIComponent(request.title)}`, '_blank');
}}
```

### Notas
- El POST es fire-and-forget (`.catch(() => {})`) para no bloquear la apertura de OK.ru
- No se requiere actualizacion de la extension Chrome - el cambio es solo en el frontend web

---

## Sesion: 2026-02-20 18:00

### Cambios Realizados
- Secciones "Continuar Viendo" y "Recomendadas" convertidas en pestanas pill colapsables
- Fix bug PiP: audio se mantiene al cerrar barra, ventana PiP no desaparece al maximizar
- Boton de sinopsis en cada tarjeta de Administrar Peticiones
- Fix color texto "Todos los generos" en panel de sagas

### Archivos Afectados

**Modificados:**
- `my-ui/src/App.js`: Pestanas colapsables (activeQuickTab state, toggleQuickTab callback), imports de useCallback/Sparkles/ChevronDown, text-white en select generos
- `my-ui/src/components/VideoPlayer.js`: Fix PiP con pipBarHidden state, pendingCloseRef, cierre diferido en leavepictureinpicture
- `my-ui/src/components/RequestsAdminModal.js`: Boton Info + sinopsis expandible con expandedSynopsis Set, import useState/Info

### Codigo Relevante

**App.js - Pestanas colapsables:**
```javascript
const [activeQuickTab, setActiveQuickTab] = useState(null);
const toggleQuickTab = useCallback((tab) => setActiveQuickTab(prev => prev === tab ? null : tab), []);

// Botones pill con indicador visual
<button onClick={() => toggleQuickTab('continuar')}
  className={activeQuickTab === 'continuar'
    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-lg shadow-amber-500/10'
    : 'bg-slate-800/60 text-slate-400 border-slate-700/50'}>
  <Play size={14} /> Continuar viendo ({continueWatching.length})
  <ChevronDown className={activeQuickTab === 'continuar' ? 'rotate-180' : ''} />
</button>
```

**VideoPlayer.js - Fix PiP cierre diferido:**
```javascript
const [pipBarHidden, setPipBarHidden] = useState(false);
const pendingCloseRef = useRef(false);

const onLeavePiP = () => {
  setIsPiP(false);
  setPipBarHidden(false);
  if (pendingCloseRef.current) {
    pendingCloseRef.current = false;
    onClose(); // Solo ahora se desmonta el componente
  }
};

// Boton X de barra PiP: no destruye, solo oculta
onClick={() => { pendingCloseRef.current = true; setPipBarHidden(true); }}
```

**RequestsAdminModal.js - Sinopsis toggle:**
```javascript
const [expandedSynopsis, setExpandedSynopsis] = useState(new Set());
const toggleSynopsis = (id) => {
  setExpandedSynopsis(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
};

// Contenido expandible con AnimatePresence
{expandedSynopsis.has(request.id) && (
  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}>
    <p>{request.overview || 'Sinopsis no disponible'}</p>
  </motion.div>
)}
```

**App.js - Layout actualizado de vista principal:**
```
Vista de peliculas (sin filtros activos):
  1. [Continuar viendo (3)] [Recomendadas (15)]  ← pestanas colapsables
  2. Mi Biblioteca (grid completo)                ← filteredVideos/displayedVideos
```

### Notas
- Build gzip: 144.91 kB JS, 9.3 kB CSS
- El campo `request.overview` ya existia en los datos (viene de TMDB al crear la peticion), no se necesito endpoint adicional
- Las pestanas son mutuamente excluyentes (solo una abierta) pero las sinopsis permiten multiples abiertas

---

## Sesion: 2026-02-16 15:00

### Cambios Realizados
- 5 nuevas features integradas en el frontend React
- 5 nuevos componentes creados
- 3 nuevos hooks creados
- VideoPlayer.js extendido con PiP y Cast
- App.js ampliado con 5 integraciones

### Archivos Afectados

**Hooks nuevos:**
- `my-ui/src/hooks/useCast.js`: Estado DLNA Cast (devices, scanning, casting, status) + API calls
- `my-ui/src/hooks/useRecommendations.js`: Motor scoring IA (afinidad genero + TMDB + rating + diversidad)
- `my-ui/src/hooks/useVideoProgress.js`: Anadida `getAllVideoProgress()` para escanear localStorage

**Componentes nuevos:**
- `my-ui/src/components/CastButton.js`: Boton Airplay con pulse CSS
- `my-ui/src/components/CastDeviceModal.js`: Modal lista TVs + controles remotos
- `my-ui/src/components/RandomPickerModal.js`: Ruleta aleatoria ponderada
- `my-ui/src/components/RecommendationsSection.js`: Seccion horizontal con razones
- (ya existente pero nuevo en repo) `my-ui/src/components/RenameEpisodesModal.js`

**Modificados:**
- `my-ui/src/components/VideoPlayer.js`: PiP completo + CastButton integrado
- `my-ui/src/App.js`: Integracion de las 5 features

### Codigo Relevante

**useRecommendations.js** - Algoritmo de scoring:
```javascript
// A. Afinidad por genero (0-3)
for (const gid of v.genreIds) {
  aff += genreAffinity[gid] || 0;
}
score += Math.min(aff * 3, 3);

// B. Recomendada por TMDB desde peli consumida (0-2)
if (v.tmdbId && tmdbRecommended.has(v.tmdbId)) score += 2;

// C. Rating TMDB (0-1)
if (v.rating) score += v.rating / 10;

// D. No vista (0-1.5)
if (!prog) score += 1.5;
```

**VideoPlayer.js** - PiP toggle:
```javascript
const togglePiP = useCallback(async () => {
  const video = videoRef.current;
  if (!video || !pipSupported) return;
  try {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
    } else {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
      await video.requestPictureInPicture();
    }
  } catch (err) {
    console.error('PiP error:', err.message);
  }
}, [videoRef, pipSupported]);
```

**RandomPickerModal.js** - Seleccion ponderada:
```javascript
function weightedRandom(videos, favorites, allProgress, excludeFilename) {
  const weights = pool.map(v => {
    let w = 1.0;
    if ((v.rating || 0) >= 7) w += 0.5;
    if ((v.rating || 0) >= 8) w += 0.5;
    if (!allProgress[v.filename]) w += 1.0;
    if (!favorites.has(v.filename)) w += 0.3;
    return w;
  });
  // Weighted random selection...
}
```

**App.js** - Layout de la vista principal:
```
Vista de peliculas (sin filtros activos):
  1. Continuar Viendo (si hay)     ← useVideoProgress.getAllVideoProgress()
  2. Recomendadas para ti (si hay) ← useRecommendations()
  3. Mi Biblioteca (grid completo)  ← filteredVideos/displayedVideos
```

### Notas
- Build gzip: 144.92 kB JS (+1.24 kB vs anterior), 9.2 kB CSS
- Solo warnings preexistentes de ESLint (react-hooks/exhaustive-deps)
- Todas las features son client-side puras excepto DLNA Cast (requiere backend)
- El aleatorio funciona con filtros activos (pasa `filteredVideos` al modal)
- Las recomendaciones se recalculan automaticamente al cambiar videos/favoritos/progreso

---
