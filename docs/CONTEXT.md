# Contexto del Proyecto - Ultima Actualizacion: 2026-03-06

## En que estabamos trabajando?
**Newsletter: historial con preview y reenvio** — Las entradas del historial son clickeables, muestran el HTML guardado y permiten reenviar a destinatarios seleccionados.

## Estado Actual
- Completado: Newsletter recipient selection con checkboxes + localStorage persistence
- Completado: Newsletter poster fix (proxy URLs → TMDB URLs para email clients)
- Completado: Newsletter history detail view (preview HTML guardado + reenviar)
- Completado: Newsletter search X clear button con refocus
- Completado: Usuario javi creado (Jamarvi8@gmail.com)
- Completado: Per-user TV identification (serial/modelo)
- En progreso: Re-encode peliculas pesadas (>12Mbps) en NAS
- Pendiente: HEVC Beauty 5 episodios
- Pendiente: Verificar estabilidad OOM en TV (v2.12.0)

## Archivos Clave Modificados (sesion actual)
- `routes/newsletter.js`: `moviesForEmail()` (proxy→TMDB URLs), `GET /:id`, `POST /:id/resend`, recipientIds filtering
- `db/users-db.js`: columna `html_content` en newsletter_logs, `logNewsletter()` guarda HTML, `getNewsletterById()`
- `my-ui/src/hooks/useNewsletter.js`: recipient state + localStorage, `loadNewsletterDetail()`, `resendNewsletter()`, `closeHistoryDetail()`
- `my-ui/src/components/NewsletterModal.js`: recipient checkboxes, history detail view (preview iframe + resend), search X button

## Archivos Clave (referencia general)
- `routes/conversion.js`: API de conversion video (6 endpoints)
- `lib/probe.js`: FFprobe wrapper (codec info)
- `db/media-db.js`: SQLite — getMovie, upsertMovie, deleteMovie, cleanupMovies
- `lib/cache.js`: cleanupCache() — compara cache vs archivos reales en disco

## Comandos Rapidos para Empezar
```bash
# Iniciar servidor local
cd /mnt/f/plex && node server.js

# Compilar frontend
cd /mnt/f/plex/my-ui && npm run build

# Deploy al NAS (solo codigo, NUNCA .db)
scp server.js isidro@calilu.mooo.com:~/isiprime/
scp routes/auth.js isidro@calilu.mooo.com:~/isiprime/routes/
scp db/users-db.js isidro@calilu.mooo.com:~/isiprime/db/
ssh isidro@calilu.mooo.com "cd ~/isiprime && pm2 restart isiprime"

# Sync TV app al NAS
bash scripts/sync-tv-app.sh

# Deploy rapido de un modulo TV
cp IsiPrime-WebOS-Native/js/MODULE.js tv-app/js/ && scp tv-app/js/MODULE.js isidro@calilu.mooo.com:~/isiprime/tv-app/js/
```

## Procesos en NAS (monitorizar por SSH)
```bash
tail -20 ~/isiprime/logs/convert-series.log      # progreso series
tail -20 ~/isiprime/logs/run-all-conversions.log  # estado cadena
tail -20 ~/isiprime/logs/reencode-movies.log      # peliculas
```

## Problemas Conocidos
- **WSL en subred diferente**: WSL usa 192.168.0.x, NAS esta en 192.168.1.45. SSH solo via `calilu.mooo.com`
- **RandomPickerModal.js**: Archivo aun existe en disco pero ya no se importa (limpieza pendiente)

## Documentacion Detallada
- [API Conversion para APK Movil](./api-conversion-mobile.md)
- [Frontend](./categories/frontend.md)
- [Backend](./categories/backend.md)
- [Bugs](./categories/bugs.md)
- [Infrastructure](./categories/infrastructure.md)
