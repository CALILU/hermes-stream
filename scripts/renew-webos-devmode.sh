#!/bin/bash
# Renueva la sesión Developer Mode del LG TV
# Ejecutar como cron cada 24h en el LincStation N2
#
# Crontab: 0 3 * * * /ruta/scripts/renew-webos-devmode.sh >> /var/log/webos-renew.log 2>&1

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Renovando Developer Mode..."

if command -v ares-extend-dev &> /dev/null; then
    ares-extend-dev --device IsiPrimeTV
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Resultado: $?"
else
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERROR: ares-extend-dev no encontrado en PATH"
    exit 1
fi
