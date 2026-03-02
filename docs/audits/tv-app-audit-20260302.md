# Auditoria App TV webOS — IsiPrime-WebOS-Native v2.11.2

**Fecha**: 2026-03-02
**Archivos auditados**: 17 modulos JS + CSS + HTML (~7500 lineas JS, ~2533 lineas CSS)
**Modificaciones**: Ninguna (solo informe)

---

## Resumen Ejecutivo

| Severidad | Hallazgos | Descripcion |
|-----------|-----------|-------------|
| **CRITICO** | 6 | Bugs funcionales, incompatibilidades webOS 4.0, seguridad |
| **MEDIO** | 30+ | Codigo duplicado masivo, inconsistencias, rendimiento |
| **BAJO** | 25+ | Codigo muerto, estilo, mejoras menores |

### Top 5 problemas mas graves

1. **27 usos de `gap` en flexbox CSS** — NO funciona en Chromium ~53 (webOS 4.0). Afecta toda la UI.
2. **Bug en requests.js:395** — llama a `_closeStatusMenu()` que no existe (es `_hideStatusMenu()`). Bloquea la interfaz.
3. **~1200 lineas duplicadas** entre genre.js, years.js y sagas.js (>95% identicas).
4. **~500 lineas duplicadas** del teclado en pantalla entre search.js y requests.js.
5. **postMessage sin verificar origin** en player.js — riesgo de seguridad.

---

## 1. BUGS FUNCIONALES (Criticos)

### requests.js:395 — Metodo inexistente `_closeStatusMenu()`
```
self._closeStatusMenu()  // NO EXISTE — el metodo real es _hideStatusMenu()
```
**Impacto**: Cuando el usuario pulsa BACK con el menu de estado abierto, lanza `TypeError`. El menu no se cierra y la interfaz queda atrapada.

### player.js:275-332 — postMessage sin verificar origin
El handler de mensajes del iframe no comprueba `e.origin` antes de procesar. Cualquier iframe inyectado podria enviar mensajes fraudulentos (`type: 'back'`, `type: 'ended'`).
**Fix**: Anadir `if (e.origin !== App.Config.SERVER_URL) return;` al inicio del handler.

### detail.js:387 — keydown sin capture phase
Detail registra su keydown handler SIN `true` (capture), mientras que genre.js, years.js y sagas.js lo registran CON capture. Esto puede causar que BACK se ejecute dos veces al volver desde Detail abierto encima de Genre/Years/Sagas.

### search.js:514 / requests.js:758,1441 / actor.js:286 — scrollIntoView con objeto
```javascript
el.scrollIntoView({ block: 'nearest' })  // NO soportado en Chromium ~53
```
En webOS 4.0, `scrollIntoView` solo acepta booleano. El objeto es ignorado, causando saltos bruscos de scroll.
**Afecta**: search.js, requests.js (2 sitios), actor.js.

### requests.js:977 — ID de TMDB inconsistente
`_toggleSelection` usa `movie.id` como key, pero la API puede devolver `tmdbId` en vez de `id`. Si solo viene `tmdbId`, la seleccion se rompe (key = undefined).

### router.js:143 — Dependencia de App._hideHoverTooltip
Llamado incondicionalmente pero definido en app.js (ultimo en cargar). Si el router navega antes de que app.js cargue, lanza TypeError.

---

## 2. COMPATIBILIDAD webOS 4.0 / Chromium ~53 (Critico)

### CSS: 27 usos de `gap` en flexbox
`gap` en flexbox NO esta soportado en Chromium 53 (solo funciona en Grid). Afecta:
- Nav bar (`.nav-logo`, `.nav-items`)
- Featured grid
- Detail view (meta, genres, buttons, cast)
- Search results grid
- Series (season tabs, episode items)
- Actor header y grid
- Genre/Sagas grid
- Requests (multiple secciones)
- Resume dialog

**Fix**: Reemplazar `gap: Xpx` por `margin` en los hijos: `.parent > * + * { margin-left: Xpx; }`

### CSS: position:sticky sin prefijo webkit
`.season-tabs` (L1181) usa `position: sticky` sin `-webkit-sticky`. Las pestanas de temporada no se "pegan" en webOS 4.0.

### JS: Compatibilidad CONFIRMADA
No se encontraron usos de: `?.`, `??`, `replaceAll()`, `async/await`, `Array.at()`, `globalThis`, `Promise.allSettled`, `structuredClone`. El JS es correctamente ES5/ES6 compatible.

---

## 3. CODIGO DUPLICADO (Medio-Alto)

### genre.js y years.js: ~95% identico (~400 lineas)
`years.js` linea 6 admite: "Cloned from genre.js". Funciones byte-por-byte identicas:
- `_buildUI`, `_buildMovieGrid`, `_getGridCols`, `_updateGridFocus`, `_clearGridFocus`
- `_clearAllFocus`, `_switchToNav`, `_handleNavNav`, `_updateNavFocus`, `_clearNavFocus`
- `_setupKeyHandler`, `_handleGridNav`, `_onMovieSelect`, `_ensureVisible`

### genre.js + years.js + sagas.js: estructura sidebar+grid triplicada (~1200 lineas)
Los 3 modulos comparten la misma estructura:
| Funcion | genre.js | years.js | sagas.js |
|---------|----------|----------|----------|
| `_getGridCols` | 409-420 | 407-417 | 539-548 |
| `_updateGridFocus` | 446-458 | 443-456 | 579-592 |
| `_clearGridFocus` | 461-465 | 458-462 | 594-598 |
| `_handleNavNav` | 493-526 | 489-521 | 625-657 |
| `_handleGridNav` | 660-718 | 652-707 | 783-838 |
| `_ensureVisible` | 732-750 | 721-737 | 844-860 |
| `_buildMovieGrid` | 349-403 | 349-401 | 345-421 |

**Recomendacion**: Extraer un modulo base `SidebarGridView` compartido.

### search.js + requests.js: teclado en pantalla duplicado (~500 lineas)
Comparten identicamente:
- Layout de teclado (KEYBOARD_COLS, KEYS_LAYOUT)
- Construccion DOM del teclado
- Handlers click/hover Magic Remote
- `_handleKeyboardNav`, `_updateKeyboardFocus`, `_clearKeyboardFocus`
- `_getResultsCols`, `_handleResultsNav`, `_updateResultsFocus`
- `_switchToResults`, `_switchToKeyboard`, `_onKeyPress`, `_updateDisplay`
- Nav bar management (`_switchToNav`, `_handleNavNav`, `_updateNavFocus`, `_clearNavFocus`)

**Recomendacion**: Extraer modulo `keyboard.js` compartido.

### Nav bar management repetida 5 veces (~350 lineas)
genre.js, years.js, sagas.js, search.js, requests.js reimplementan identicamente:
`_switchToNav()`, `_handleNavNav()`, `_updateNavFocus()`, `_clearNavFocus()`

### Otras duplicaciones
| Elemento | Modulos | Lineas aprox |
|----------|---------|-------------|
| Runtime formatting (`h + 'h ' + m + 'min'`) | home.js:238, detail.js:107 | 6 |
| Continue-watching lookup | home.js:586, detail.js:526 | 20 |
| Toast (`_showToast`) | requests.js:1590, sagas.js:514 | 40 |
| Poster path access (`item.poster \|\| item.poster_path`) | carousel.js (x3), home.js, search.js, requests.js | 10 |
| `.then(function(r) { return r.json(); })` | api.js (x15) | 15 |

**Total codigo duplicado estimado: ~2100+ lineas** (de ~7500 totales = 28%)

---

## 4. CODIGO MUERTO

### Funciones nunca llamadas
| Modulo | Funcion/Variable | Lineas |
|--------|-----------------|--------|
| api.js | `isAuthenticated()` | 38 |
| router.js | `VIEW_MAP` (refactorizacion incompleta) | 33-44 |
| router.js | `getCurrentData()` | 120 |
| carousel.js | `getItems()`, `getFocusIndex()`, `updateItems()` | 376-399 |
| player.js | Resume dialog completo (jamas se llama) | 62-138, 380-401 (~80 lineas) |
| requests.js | `RESULTS_COLS = 4` | 16 |
| images.js | IntersectionObserver completo (se crea pero nunca observa elementos) | 26-42, 49-61, 67-74, 155 |

### CSS no usado (~350 lineas, 14% del archivo)
| Seccion | Clases | Lineas aprox |
|---------|--------|-------------|
| Player controls | 15 clases (`.player-video`, `.player-controls`, etc.) | 875-1035 |
| Home hero | 7 clases (`.home-hero`, `.home-hero-backdrop`, etc.) | 315-369 |
| Settings overlay | 11 clases | 1706-1787 |
| Error/empty states | 6 clases | 1659-1700 |
| Resume dialog variantes | 4 clases | 1054-1095 |
| Utilidades muertas | `.hidden`, `.fade-in`, `.slide-up`, `.text-truncate`, `.visually-hidden` | 1817-1865 |
| Otros | `.poster-placeholder`, `.poster-favorite`, `.continue-watching-*`, `.search-hint`, `.keyboard-key-wide/extra-wide` | dispersos |

**Total CSS muerto: ~55 clases, ~350 lineas**

---

## 5. INCONGRUENCIAS ENTRE MODULOS

| Aspecto | Patron A | Patron B | Modulos |
|---------|----------|----------|---------|
| keydown listener capture | `true` (capture phase) | Sin capture | genre/years/sagas vs detail |
| BACK key handling | `return` (propaga al Router) | `preventDefault` + manual `_goBack()` | genre/years/sagas vs detail/actor/search/requests |
| Image loading | `data-src` + `App.Images.observe()` (lazy) | `img.src` directo | todos vs detail.js (cast photos) |
| Loop style focus | `for (var i=0; ...)` | `forEach` | mayoria vs detail.js (buttons) |
| Timer cleanup en hide() | Limpia timers | NO limpia scroll handlers | genre/years/sagas vs home.js |
| Toast timer cleanup | NO limpia en hide() | N/A | sagas.js |
| Grid col detection | `> firstTop + 5` (5px tolerancia) | `!== firstTop` (exacto) | genre/years/sagas vs detail.js |
| API privadas | `App.API.getX()` (publico) | `App.API._fetch()` (privado) | mayoria vs series.js:269 |
| CSS border-radius poster | 10px | 8px / 12px | base vs genre/requests/actor |
| CSS background poster | #1a1a1a | #1a1a2e | base vs genre/requests |
| CSS poster-title font | 16px | 14px / 15px | base vs actor/genre |
| Focus ring width | 3px | 2px | mayoria vs season-tab/cast-photo |
| Focus scale | 1.08 | 1.04 / 1.05 | carousel vs featured/genre/nav |

---

## 6. MEMORY LEAKS POTENCIALES

| Modulo | Problema | Lineas |
|--------|----------|--------|
| home.js | Scroll event listeners acumulados en cada `show()` (funciones anonimas, no removibles) | 37-39, 733 |
| home.js | `hide()` no llama a `_destroyCarousels()` ni limpia scroll handlers | 794-798 |
| carousel.js | `mousemove` global listener nunca se elimina aunque todos los carousels se destruyan | 100 |
| images.js | `_prefetched` dict crece indefinidamente sin limpieza | 135-143 |
| sagas.js | `_toastTimer` no se cancela en `hide()` | 34, 515, 527 |
| player.js | Posible acumulacion de `setInterval` si `_launchIframe` se llama sin `stop()` previo | 341-345 |

---

## 7. SEGURIDAD

| Modulo | Problema | Severidad |
|--------|----------|-----------|
| player.js | `postMessage(msg, '*')` sin verificar `e.origin` en receptor | **Medio** |
| player.js | JWT token en URL del iframe (query string) | **Bajo** (documentado/necesario) |
| actor.js:258 | `innerHTML` con `data.name` de TMDB sin sanitizar | **Bajo** |
| home.js:251 | `innerHTML` con datos de API (genres, year, duration) | **Bajo** |
| carousel.js:285 | `data-src` attribute con posterUrl sin escapar comillas | **Bajo** |

---

## 8. CSS: PROPIEDADES REDUNDANTES (~120 lineas)

Las propiedades de `.poster-img` y `.poster-wrapper` se repiten identicamente en:
- `.genre-movie-item .poster-wrapper .poster-img` (L1981-1993)
- `.requests-tmdb-item .poster-wrapper .poster-img` (L2215-2227)
- `.requests-list-item .poster-wrapper .poster-img` (L2366-2378)
- `.requests-list-item .poster-wrapper` (L2357-2364)

Estas repiten las propiedades base de `.poster-img` (L538-549) y `.poster-wrapper` (L528-534) sin aportar nada nuevo.

---

## 9. RENDIMIENTO

| Modulo | Problema | Impacto |
|--------|----------|---------|
| focus.js:431 | `getComputedStyle` en bucle while (fuerza reflow) | Medio |
| focus.js:380-385 | `querySelectorAll('.focused')` en cada movimiento de foco | Bajo |
| carousel.js:456-458 | `document.createElement('div')` en `_escapeHtml` por cada item | Bajo |
| genre/years/sagas | Nav items reconstruidos en cada `show()` | Bajo |
| router.js:329-351 | `querySelectorAll('.nav-item')` y objeto `viewMap` recreados en cada navegacion | Bajo |
| detail.js:228 | Cast photos cargadas todas a la vez (sin lazy loading) | Medio |
| api.js | 15 repeticiones de `.then(function(r) { return r.json(); })` | Estilo |

---

## 10. ESTADISTICAS GLOBALES

| Metrica | Valor |
|---------|-------|
| Total lineas JS | ~7,500 |
| Total lineas CSS | 2,533 |
| Codigo duplicado JS estimado | ~2,100 lineas (28%) |
| CSS no usado | ~350 lineas (14%) |
| CSS redundante | ~120 lineas (5%) |
| Funciones muertas JS | 12+ |
| Clases CSS muertas | ~55 |
| Bugs funcionales | 2 (requests.js, scrollIntoView) |
| Incompatibilidades webOS 4.0 | 29 (27 gap CSS + sticky + scrollIntoView) |
| Memory leaks potenciales | 6 |
| Problemas de seguridad | 2 (bajo-medio) |

---

## PLAN DE ACCION RECOMENDADO

### Prioridad 1 — Critico (afecta funcionamiento en webOS 4.0)
1. Reemplazar 27 `gap` en flexbox CSS por `margin` en hijos
2. Anadir `-webkit-sticky` fallback para `.season-tabs`
3. Corregir `scrollIntoView({ block: 'nearest' })` → `scrollIntoView(false)` en 4 modulos
4. Fix bug `_closeStatusMenu` → `_hideStatusMenu` en requests.js:395

### Prioridad 2 — Medio (calidad de codigo)
5. Extraer modulo `SidebarGridView` base (elimina ~1200 lineas duplicadas)
6. Extraer modulo `keyboard.js` compartido (elimina ~500 lineas duplicadas)
7. Extraer nav bar management a funcion compartida (elimina ~350 lineas)
8. Anadir verificacion de `e.origin` en player.js postMessage handler
9. Unificar keydown handler pattern (capture phase + BACK propagation)
10. Anadir lazy loading a cast photos en detail.js

### Prioridad 3 — Bajo (limpieza)
11. Eliminar CSS muerto (~350 lineas: player controls, hero, settings, error states)
12. Eliminar JS muerto (resume dialog, VIEW_MAP, IntersectionObserver, API publica no usada)
13. Consolidar propiedades CSS repetidas de poster-img/poster-wrapper
14. Unificar border-radius/background/font-size de posters
15. Limpiar memory leaks (scroll listeners en home.js, toast timer en sagas.js)
