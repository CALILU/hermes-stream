# Contexto del Proyecto - Ultima Actualizacion: 2026-03-02

## En que estabamos trabajando?
**Mejoras de UI en React + correcciones de auth remoto + monitoreo de normalizacion de audio**. Se elimino el boton "Sorprendeme", se implemento galeria de sagas con peliculas no-catalogo en B&N (toggle peticiones), se corrigieron 401 en busqueda TMDB por uso de `fetch` sin auth, y se desplego al NAS via `calilu.mooo.com`.

## Estado Actual
- Completado: Boton "Sorprendeme" eliminado (import, estado, botones mobile/desktop, RandomPickerModal)
- Completado: Boton "Peticiones" visible para todos los usuarios junto a "Pedir Pelicula"
- Completado: Galeria de sagas muestra peliculas no-catalogo en B&N con badge "No disponible"
- Completado: Click en pelicula no-catalogo crea/cancela peticion (toggle) con badge "Pedida"
- Completado: Sincronizacion de badges al borrar desde modal de Peticiones
- Completado: Fix 401 en busqueda TMDB remota (3x `fetch` → `authFetch`)
- Completado: Deploy al NAS via SSH `calilu.mooo.com` (WSL en subred diferente al NAS)
- En progreso: Normalizacion de audio en NAS — 169/576 (~29%), 0 errores, PID 49126
- Pendiente: Monitorear normalizacion hasta completar (~17h restantes)

## Archivos Clave Modificados
- `my-ui/src/App.js`: Eliminar Sorprendeme, boton Peticiones para todos, galeria sagas B&N + toggle
- `my-ui/src/hooks/useVideos.js`: Estado `collectionFullParts`, fetch full parts, merge no-catalogo, fix `authFetch`
- `my-ui/src/hooks/useRequests.js`: `toggleSagaRequest()`, fix `authFetch` en TMDB search/actor, fix `deleteRequest` sync
- `my-ui/src/components/RandomPickerModal.js`: Ya no se importa (archivo conservado en disco)

## Comandos Rapidos para Empezar
```bash
# Iniciar servidor local
cd /mnt/f/plex && node server.js

# Compilar frontend
cd /mnt/f/plex/my-ui && npm run build

# Deploy al NAS (usar calilu.mooo.com, no IP directa desde WSL)
ssh isidro@calilu.mooo.com "rm -f ~/isiprime/my-ui/build/static/js/main.*.js ~/isiprime/my-ui/build/static/css/main.*.css"
scp -r my-ui/build/ isidro@calilu.mooo.com:~/isiprime/my-ui/
ssh isidro@calilu.mooo.com "cd ~/isiprime && pm2 restart isiprime"

# Monitorear normalizacion de audio
ssh isidro@calilu.mooo.com "tail -20 ~/isiprime/logs/normalize-audio.log"
ssh isidro@calilu.mooo.com "grep -c '✅' ~/isiprime/logs/normalize-audio.log"
```

## Problemas Conocidos
- **WSL en subred diferente**: WSL usa 192.168.0.x, NAS esta en 192.168.1.45. SSH solo funciona via `calilu.mooo.com`
- **Normalizacion audio**: 576 archivos, ~2.5 min/archivo, proceso corriendo (PID 49126)
- **RandomPickerModal.js**: Archivo aun existe en disco pero ya no se importa (limpieza pendiente)

## Documentacion Detallada
- [Ultima sesion](./sessions/session-20260302-1818.md)
- [Frontend](./categories/frontend.md)
- [Backend](./categories/backend.md)
- [Bugs](./categories/bugs.md)
- [Infrastructure](./categories/infrastructure.md)
