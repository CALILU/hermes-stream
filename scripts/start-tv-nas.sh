#!/bin/bash
# =============================================================
# IsiPrime - Arranque servidor + TV (versión NAS)
# Sin rclone/FTP - películas en disco local del NAS
# =============================================================

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd "$(dirname "$0")/.." || exit 1

echo "========================================="
echo "  IsiPrime - Servidor NAS + TV"
echo "========================================="
echo "  Node: $(node --version)"

# 1. Verificar que el directorio de películas está accesible
VIDEOS_PATH=$(node -e "
  try {
    const s = require('./storage-settings.json');
    console.log(s.localPath);
  } catch(e) {
    console.log(process.env.LOCAL_VIDEOS_PATH || '/mnt/disk1/peliculas');
  }
" 2>/dev/null)

if [ -d "$VIDEOS_PATH" ]; then
    COUNT=$(find "$VIDEOS_PATH" -maxdepth 1 -type f \( -name "*.mp4" -o -name "*.mkv" \) 2>/dev/null | wc -l)
    echo "[1/3] Películas accesibles: $COUNT archivos en $VIDEOS_PATH"
else
    echo "ERROR: Directorio de películas no accesible: $VIDEOS_PATH"
    exit 1
fi

# 2. Arrancar/reiniciar servidor con PM2
if command -v pm2 &> /dev/null; then
    echo "[2/3] Arrancando servidor con PM2..."
    pm2 restart isiprime 2>/dev/null || pm2 start ecosystem.config.js
else
    # Fallback: arrancar directamente
    OLD_PID=$(lsof -ti:8080 2>/dev/null)
    if [ -n "$OLD_PID" ]; then
        echo "[2/3] Deteniendo servidor anterior..."
        kill "$OLD_PID" 2>/dev/null
        sleep 2
    fi
    echo "[2/3] Arrancando servidor..."
    node server.js &
    SERVER_PID=$!
fi

# Esperar a que el servidor esté listo
echo "     Esperando servidor..."
for i in $(seq 1 15); do
    if curl -s http://localhost:8080/api/auth/status > /dev/null 2>&1; then
        echo "     Servidor listo en puerto 8080"
        break
    fi
    sleep 1
done

if ! curl -s http://localhost:8080/api/auth/status > /dev/null 2>&1; then
    echo "ERROR: El servidor no arrancó correctamente"
    exit 1
fi

# 3. Lanzar app en TV
echo "[3/3] Lanzando IsiPrime en la TV..."
if command -v ares-launch &> /dev/null; then
    ares-launch --device miLGTV com.isiprime.app 2>&1
    NAS_IP=$(hostname -I | awk '{print $1}')
    echo ""
    echo "========================================="
    echo "  Todo listo!"
    echo "  Servidor: http://${NAS_IP}:8080"
    echo "  TV: App lanzada"
    echo "========================================="
else
    NAS_IP=$(hostname -I | awk '{print $1}')
    echo "  ares-launch no disponible (webOS CLI no instalado)"
    echo "  Abrir la app manualmente en la TV"
    echo ""
    echo "========================================="
    echo "  Servidor: http://${NAS_IP}:8080"
    echo "========================================="
fi

# Si PM2, no hacemos wait
if [ -n "$SERVER_PID" ]; then
    echo ""
    echo "Pulsa Ctrl+C para detener el servidor"
    wait $SERVER_PID
fi
