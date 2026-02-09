# Plan de Implementación: Soporte para Series en IsiPrime

## Resumen Ejecutivo

Añadir soporte completo para series de TV manteniendo una **separación clara** entre películas y series, sin mezclar contenido y conservando el estilo visual actual.

---

## 1. DISEÑO DE INTERFAZ - SEPARACIÓN PELÍCULAS/SERIES

### 1.1 Navegación Principal (Header)

**Propuesta**: Añadir tabs de nivel superior para cambiar entre Películas y Series.

```
┌─────────────────────────────────────────────────────────────────┐
│  [LOGO]   [🎬 Películas] [📺 Series]   [Búsqueda...]   [⚙️]    │
└─────────────────────────────────────────────────────────────────┘
```

**Comportamiento**:
- El tab activo se resalta con gradiente (igual que botones actuales)
- Al cambiar de tab, se carga la vista correspondiente
- Los filtros (géneros, años, etc.) se mantienen independientes para cada vista

### 1.2 Vista de Películas (Sin cambios)

Se mantiene exactamente igual:
- Panel izquierdo: Géneros / Sagas / Años
- Panel derecho: Índice alfabético
- Galería: Grid de posters con hover info

### 1.3 Vista de Series (Nueva)

**Layout similar pero con diferencias semánticas**:

```
┌─────────────────────────────────────────────────────────────────┐
│  Panel Izquierdo          │    Galería de Series       │ A-Z   │
│  ┌───────────────────┐    │                            │       │
│  │ [Géneros] [Estado]│    │  ┌───┐ ┌───┐ ┌───┐ ┌───┐  │  A    │
│  └───────────────────┘    │  │   │ │   │ │   │ │   │  │  B    │
│                           │  │ 📺│ │ 📺│ │ 📺│ │ 📺│  │  C    │
│  Géneros:                 │  │   │ │   │ │   │ │   │  │  ...  │
│  - Drama                  │  └───┘ └───┘ └───┘ └───┘  │       │
│  - Comedia                │                            │       │
│  - Ciencia Ficción        │  Breaking Bad   The Office │       │
│  - ...                    │  5 temporadas   9 temporadas│       │
│                           │                            │       │
│  Estado:                  │                            │       │
│  - 🔴 Finalizada          │                            │       │
│  - 🟢 En emisión          │                            │       │
│  - 🟡 Cancelada           │                            │       │
└─────────────────────────────────────────────────────────────────┘
```

### 1.4 Detalle de Serie (Modal nuevo)

Al hacer clic en una serie, se abre un modal con:

```
┌─────────────────────────────────────────────────────────────────┐
│  [X]                                                            │
│  ┌──────────┐  Breaking Bad                                     │
│  │          │  ⭐ 9.5 | 2008-2013 | 5 temporadas | 62 episodios │
│  │  POSTER  │                                                   │
│  │          │  Sinopsis: Un profesor de química con cáncer...   │
│  │          │                                                   │
│  └──────────┘  Reparto: Bryan Cranston, Aaron Paul, Anna Gunn   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [T1] [T2] [T3] [T4] [T5]                        Temporadas ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  Temporada 1 (7 episodios)                                      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 1. Pilot              ✅ 58min   [▶ REPRODUCIR]             ││
│  │ 2. Cat's in the Bag   ✅ 48min   [▶ REPRODUCIR]             ││
│  │ 3. ...And the Bag's   ⬜ 48min   [▶ REPRODUCIR]             ││
│  │ 4. Cancer Man         ⬜ 48min   [Archivo no disponible]    ││
│  │ ...                                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  [▶ CONTINUAR VIENDO: T3E05 "More Badger"]                     │
└─────────────────────────────────────────────────────────────────┘
```

**Elementos clave**:
- Tabs para cambiar de temporada
- Lista de episodios con estado (visto/no visto)
- Indicador de disponibilidad del archivo
- Botón "Continuar viendo" con último episodio

---

## 2. ESTRUCTURA DE DATOS

### 2.1 Nuevos Archivos

```
/mnt/f/plex/
├── cache.json              # Películas (existente)
├── collections.json        # Sagas de películas (existente)
├── cache-series.json       # NUEVO: Series
└── series-episodes.json    # NUEVO: Episodios por temporada
```

### 2.2 Estructura de Serie (cache-series.json)

```json
{
  "Breaking Bad": {
    "tmdb_id": 1396,
    "title": "Breaking Bad",
    "overview": "Un profesor de química...",
    "poster": "https://image.tmdb.org/t/p/w342/...",
    "backdrop": "https://image.tmdb.org/t/p/w342/...",
    "first_air_date": "2008-01-20",
    "last_air_date": "2013-09-29",
    "vote_average": 9.5,
    "genre_ids": [18, 80],
    "status": "Ended",
    "number_of_seasons": 5,
    "number_of_episodes": 62,
    "episode_runtime": 47,
    "networks": [{"id": 174, "name": "AMC"}],
    "cast": [...],
    "videos": [...],
    "folder_path": "Breaking Bad",
    "last_watched": {
      "season": 3,
      "episode": 5,
      "timestamp": 1705000000000
    },
    "cached_at": 1705000000000
  }
}
```

### 2.3 Estructura de Episodios (series-episodes.json)

```json
{
  "1396": {
    "series_title": "Breaking Bad",
    "seasons": {
      "1": {
        "name": "Temporada 1",
        "poster": "https://...",
        "air_date": "2008-01-20",
        "episodes": [
          {
            "number": 1,
            "name": "Pilot",
            "overview": "...",
            "air_date": "2008-01-20",
            "runtime": 58,
            "still": "https://...",
            "rating": 9.0,
            "filename": "Breaking Bad S01E01 - Pilot.mkv",
            "available": true,
            "watched": true,
            "progress": 0
          }
        ]
      }
    }
  }
}
```

---

## 3. ALMACENAMIENTO DE SERIES

### 3.1 Estructura de Carpetas (FTP/Local)

**Propuesta A - Carpeta separada**:
```
/Peliculas/
  └── (archivos de películas actuales)
/Series/
  └── Breaking Bad/
      ├── Breaking Bad S01E01 - Pilot.mkv
      ├── Breaking Bad S01E02 - Cat's in the Bag.mkv
      └── ...
  └── The Office/
      └── ...
```

**Propuesta B - Todo junto con detección automática**:
```
/Videos/
  ├── Película (2020).mkv           # Detectado como película
  └── Breaking Bad S01E01.mkv       # Detectado como serie (patrón SxxExx)
```

**Recomendación**: Propuesta A (carpetas separadas) es más limpia y fácil de mantener.

### 3.2 Detección de Series

Patrón regex para detectar episodios:
```javascript
const SERIES_PATTERN = /[.\s_-]S(\d{1,2})E(\d{1,2})[.\s_-]/i;
// Ejemplos que detecta:
// - "Breaking Bad S01E01 - Pilot.mkv"
// - "The.Office.S02E03.mkv"
// - "Game_of_Thrones_S04E06.mkv"
```

---

## 4. NUEVOS ENDPOINTS API

### 4.1 Lista de series
```
GET /api/series
```

### 4.2 Detalles de serie con temporadas
```
GET /api/series/:tmdb_id
```

### 4.3 Episodios de una temporada
```
GET /api/series/:tmdb_id/season/:season_number
```

### 4.4 Enriquecer series desde TMDB
```
POST /api/series/enrich
Body: { "folders": ["Breaking Bad", "The Office"] }
```

### 4.5 Marcar episodio como visto
```
PUT /api/series/:tmdb_id/episode/:season/:episode/watched
Body: { "watched": true, "progress": 1234 }
```

### 4.6 Géneros de series (diferentes a películas)
```
GET /api/series/genres
```

---

## 5. CAMBIOS EN FRONTEND (React)

### 5.1 Nuevo Estado Global

```javascript
// Modo de visualización
const [viewMode, setViewMode] = useState('movies'); // 'movies' | 'series'

// Datos de series
const [series, setSeries] = useState([]);
const [selectedSeries, setSelectedSeries] = useState(null);
const [selectedSeason, setSelectedSeason] = useState(1);
const [seriesGenres, setSeriesGenres] = useState([]);
const [selectedSeriesGenre, setSelectedSeriesGenre] = useState(null);

// Filtros específicos de series
const [seriesStatusFilter, setSeriesStatusFilter] = useState(null); // 'Ended' | 'Returning Series'
```

### 5.2 Nuevos Componentes

```
my-ui/src/
├── App.js                    # Añadir viewMode y tabs
├── components/
│   ├── MovieGallery.js       # Extraer galería de películas (existente)
│   ├── SeriesGallery.js      # NUEVO: Galería de series
│   ├── SeriesCard.js         # NUEVO: Card de serie
│   ├── SeriesDetailModal.js  # NUEVO: Modal con temporadas/episodios
│   ├── SeasonSelector.js     # NUEVO: Tabs de temporadas
│   └── EpisodeList.js        # NUEVO: Lista de episodios
```

### 5.3 Estilos (Tailwind - Mantener coherencia)

**Colores para series** (distinguir de películas):
- Películas: `indigo-500` (actual)
- Series: `emerald-500` o `teal-500`

**Card de serie**:
```jsx
<div className="aspect-[2/3] rounded-[2.5rem] bg-slate-800 border border-slate-700">
  {/* Igual que MovieCard pero con indicadores de temporadas */}
  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black p-3">
    <span className="text-xs text-slate-400">{series.number_of_seasons} temporadas</span>
  </div>
</div>
```

---

## 6. FASES DE IMPLEMENTACIÓN

### Fase 1: Infraestructura Backend (2-3 días)
- [ ] Crear archivos `cache-series.json` y `series-episodes.json`
- [ ] Implementar función `searchTVShowTMDB()`
- [ ] Crear endpoints básicos: GET /api/series, GET /api/series/:id
- [ ] Implementar detección de carpetas de series

### Fase 2: Frontend Básico (2-3 días)
- [ ] Añadir tabs Películas/Series en header
- [ ] Crear componente SeriesGallery
- [ ] Implementar carga de series
- [ ] Añadir filtros básicos (género, estado)

### Fase 3: Detalle de Serie (2-3 días)
- [ ] Crear modal SeriesDetailModal
- [ ] Implementar navegación por temporadas
- [ ] Mostrar lista de episodios
- [ ] Indicadores de disponibilidad de archivos

### Fase 4: Reproducción y Progreso (2-3 días)
- [ ] Integrar reproductor de video para episodios
- [ ] Implementar tracking de progreso por episodio
- [ ] Crear botón "Continuar viendo"
- [ ] Guardar estado de episodios vistos

### Fase 5: Refinamiento (1-2 días)
- [ ] Sincronización de estados
- [ ] Optimización de caché
- [ ] Testing y debugging
- [ ] Documentación

---

## 7. MOCKUPS DE INTERFAZ

### 7.1 Header con Tabs

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [LOGO]                                                                   │
│                                                                          │
│ ╔═══════════════╗ ┌───────────────┐                                      │
│ ║ 🎬 Películas  ║ │ 📺 Series     │    [🔍 Buscar...]   [🆕] [🎬] [⚙️]  │
│ ╚═══════════════╝ └───────────────┘                                      │
│ (activo=gradiente) (inactivo=borde)                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

### 7.2 Card de Serie

```
┌─────────────────────┐
│                     │
│      [POSTER]       │
│                     │
│   ┌───────────────┐ │
│   │ 5 temporadas  │ │  ← Badge inferior
│   └───────────────┘ │
├─────────────────────┤
│ Breaking Bad        │
│ ⭐ 9.5 | AMC        │
│ ███████░░░ 70%      │  ← Barra de progreso
└─────────────────────┘
```

### 7.3 Panel de Filtros (Series)

```
┌─────────────────────┐
│   GÉNEROS           │
│   ─────────         │
│   • Drama       (12)│
│   • Comedia     (8) │
│   • Crimen      (5) │
│   • Ciencia fic (4) │
│                     │
│   ESTADO            │
│   ─────────         │
│   🔴 Finalizada (15)│
│   🟢 En emisión  (3)│
│   🟡 Cancelada   (2)│
│                     │
│   RED/PLATAFORMA    │
│   ─────────         │
│   📺 HBO        (5) │
│   📺 Netflix    (8) │
│   📺 AMC        (3) │
└─────────────────────┘
```

---

## 8. CONSIDERACIONES TÉCNICAS

### 8.1 Rate Limiting TMDB
- Series requieren más llamadas (serie + N temporadas)
- Implementar cola con delay de 350ms entre peticiones
- Cachear agresivamente (series cambian poco)

### 8.2 Tamaño de Caché
- Películas: ~5-10MB para 1000 películas
- Series: ~2-5MB para 50 series (metadata general)
- Episodios: ~10-20MB para 50 series con todos los episodios

### 8.3 Performance Frontend
- Lazy load de episodios (solo al abrir temporada)
- Virtual scrolling para listas largas de episodios
- Optimización de imágenes (w342 suficiente)

---

## 9. CHECKLIST FINAL ANTES DE IMPLEMENTAR

- [x] Backup creado en `/mnt/f/plex/salvamento/backup-pre-series-20260131`
- [x] Estructura de datos diseñada
- [x] Endpoints API definidos
- [x] Mockups de interfaz creados
- [ ] **Aprobación del usuario para proceder**

---

## 10. PREGUNTAS PARA EL USUARIO

Antes de implementar, necesito confirmar:

1. **Almacenamiento de series**: ¿Prefieres una carpeta separada `/Series/` o detección automática por patrón SxxExx?

2. **Organización de archivos**: ¿Tus series están organizadas en subcarpetas por serie (`/Series/Breaking Bad/`) o sueltas?

3. **Prioridad de features**: ¿Qué es más importante primero?
   - A) Ver catálogo de series y reproducir
   - B) Tracking de progreso (continuar viendo)
   - C) Ambos desde el inicio

4. **Color distintivo para series**: ¿Te parece bien usar verde esmeralda (`emerald`) para distinguir series de películas (que usan índigo)?

---

*Documento generado el 31/01/2026*
*Backup disponible en: `/mnt/f/plex/salvamento/backup-pre-series-20260131`*
