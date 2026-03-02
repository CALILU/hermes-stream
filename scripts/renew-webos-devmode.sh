#!/bin/bash
# Renueva la sesión Developer Mode de todas las TVs LG registradas
# Ejecutar como cron cada 24h en el LincStation N2
#
# Crontab: 0 3 * * * ~/isiprime/scripts/renew-webos-devmode.sh >> ~/isiprime/logs/webos-renew.log 2>&1
#
# MÉTODO 1 (LAN): ares-extend-dev via SSH — requiere TV en la misma red
# MÉTODO 2 (REMOTO): API REST de LG con token — funciona desde cualquier sitio
#
# SETUP para añadir TVs:
#   1. Activar Developer Mode en la TV (cada TV necesita cuenta LG diferente)
#   2. Extraer token: ssh -p 9922 prisoner@<IP_TV> "cat /var/luna/preferences/devmode_enabled"
#   3. Añadir línea en TOKENS abajo: "nombre|token"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOKENS_FILE="$SCRIPT_DIR/webos-tokens.conf"
LOG_DATE="[$(date '+%Y-%m-%d %H:%M:%S')]"

echo ""
echo "============================================"
echo "$LOG_DATE Renovando Developer Mode..."
echo "============================================"

# -----------------------------------------------
# MÉTODO 2: API REST (TVs remotas — no necesita red local)
# -----------------------------------------------
if [ -f "$TOKENS_FILE" ]; then
    echo "$LOG_DATE Renovando via API REST (tokens)..."
    while IFS='|' read -r TV_NAME TV_TOKEN; do
        # Saltar líneas vacías y comentarios
        [[ -z "$TV_NAME" || "$TV_NAME" == \#* ]] && continue

        RESPONSE=$(curl -s -m 10 "https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken=${TV_TOKEN}")

        if echo "$RESPONSE" | grep -q '"result":"success"'; then
            echo "$LOG_DATE   ✅ $TV_NAME — renovado OK"
        else
            echo "$LOG_DATE   ❌ $TV_NAME — error: $RESPONSE"
        fi
    done < "$TOKENS_FILE"
else
    echo "$LOG_DATE No se encontró $TOKENS_FILE — omitiendo API REST"
fi

# -----------------------------------------------
# MÉTODO 1: ares-extend-dev (TVs locales — fallback)
# -----------------------------------------------
if command -v ares-extend-dev &> /dev/null; then
    # Renovar TVs locales configuradas en ares-cli
    for DEVICE in miLGTV nuevaTV; do
        echo "$LOG_DATE Intentando ares-extend-dev --device $DEVICE..."
        OUTPUT=$(ares-extend-dev --device "$DEVICE" 2>&1)
        RC=$?
        if [ $RC -eq 0 ]; then
            echo "$LOG_DATE   ✅ $DEVICE — renovado via SSH"
        else
            echo "$LOG_DATE   ⚠️  $DEVICE — SSH falló (TV apagada o no accesible): $OUTPUT"
        fi
    done
else
    echo "$LOG_DATE ares-extend-dev no disponible — solo API REST"
fi

echo "$LOG_DATE Renovación completada."
