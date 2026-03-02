# Frontend - Historial de Cambios

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
