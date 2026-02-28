#!/bin/bash
# =============================================================
# IsiPrime - Script de migración a LincStation N2
# Ejecutar DENTRO del NAS después de copiar el código
# =============================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; }

echo "============================================"
echo "  IsiPrime - Validación de Migración NAS"
echo "============================================"
echo ""

ERRORS=0

# --- 1. Sistema operativo ---
echo "--- Sistema ---"
if [ -f /etc/debian_version ]; then
    ok "Debian $(cat /etc/debian_version)"
else
    warn "No es Debian ($(uname -s))"
fi

ARCH=$(uname -m)
ok "Arquitectura: $ARCH"

CORES=$(nproc)
RAM=$(free -h | awk '/^Mem:/{print $2}')
ok "CPU: $CORES cores, RAM: $RAM"
echo ""

# --- 2. Node.js ---
echo "--- Node.js ---"
if command -v node &> /dev/null; then
    NODE_VER=$(node --version)
    ok "Node.js $NODE_VER"
    # Check version >= 18
    MAJOR=$(echo $NODE_VER | sed 's/v//' | cut -d. -f1)
    if [ "$MAJOR" -lt 18 ]; then
        fail "Se requiere Node.js >= 18 (tienes $NODE_VER)"
        ERRORS=$((ERRORS+1))
    fi
else
    fail "Node.js no instalado"
    echo "  Instalar con: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
    echo "  Luego: nvm install 20"
    ERRORS=$((ERRORS+1))
fi

if command -v npm &> /dev/null; then
    ok "npm $(npm --version)"
else
    fail "npm no instalado"
    ERRORS=$((ERRORS+1))
fi
echo ""

# --- 3. FFmpeg ---
echo "--- FFmpeg ---"
if command -v ffmpeg &> /dev/null; then
    FFMPEG_VER=$(ffmpeg -version 2>&1 | head -1)
    ok "$FFMPEG_VER"
else
    fail "FFmpeg no instalado"
    echo "  Instalar con: sudo apt install -y ffmpeg"
    ERRORS=$((ERRORS+1))
fi

if command -v ffprobe &> /dev/null; then
    ok "ffprobe disponible"
else
    fail "ffprobe no disponible"
    ERRORS=$((ERRORS+1))
fi
echo ""

# --- 4. Build tools (para better-sqlite3) ---
echo "--- Build tools ---"
if command -v gcc &> /dev/null; then
    ok "gcc $(gcc --version | head -1)"
else
    fail "gcc no instalado (necesario para better-sqlite3)"
    echo "  Instalar con: sudo apt install -y build-essential"
    ERRORS=$((ERRORS+1))
fi

if command -v python3 &> /dev/null; then
    ok "python3 $(python3 --version)"
else
    fail "python3 no instalado"
    echo "  Instalar con: sudo apt install -y python3"
    ERRORS=$((ERRORS+1))
fi
echo ""

# --- 5. PM2 ---
echo "--- PM2 ---"
if command -v pm2 &> /dev/null; then
    ok "PM2 $(pm2 --version)"
else
    warn "PM2 no instalado"
    echo "  Instalar con: npm install -g pm2"
fi
echo ""

# --- 6. Archivos del proyecto ---
echo "--- Archivos del proyecto ---"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

if [ -f "server.js" ]; then
    ok "server.js encontrado"
else
    fail "server.js no encontrado (¿estás en el directorio correcto?)"
    ERRORS=$((ERRORS+1))
fi

if [ -f "package.json" ]; then
    ok "package.json encontrado"
else
    fail "package.json no encontrado"
    ERRORS=$((ERRORS+1))
fi

if [ -f ".env" ]; then
    ok ".env existe"
    # Verificar variables críticas
    if grep -q "JWT_SECRET=" .env; then
        ok "JWT_SECRET configurado"
    else
        fail "JWT_SECRET no está en .env"
        ERRORS=$((ERRORS+1))
    fi
    if grep -q "TMDB_API_KEY=" .env; then
        ok "TMDB_API_KEY configurado"
    else
        warn "TMDB_API_KEY no está en .env"
    fi
else
    fail ".env no existe (copiar de .env.nas y configurar)"
    ERRORS=$((ERRORS+1))
fi

if [ -d "node_modules" ]; then
    ok "node_modules existe"
else
    warn "node_modules no existe (ejecutar: npm install)"
fi

if [ -d "my-ui/build" ]; then
    INDEX_SIZE=$(wc -c < "my-ui/build/index.html" 2>/dev/null || echo "0")
    if [ "$INDEX_SIZE" -gt 100 ]; then
        ok "my-ui/build/ existe (index.html: ${INDEX_SIZE} bytes)"
    else
        fail "my-ui/build/index.html parece vacío o corrupto"
        ERRORS=$((ERRORS+1))
    fi
else
    fail "my-ui/build/ no existe (copiar desde Windows o ejecutar: npm run build)"
    ERRORS=$((ERRORS+1))
fi

if [ -f "isiprime.db" ]; then
    DB_SIZE=$(du -h isiprime.db | cut -f1)
    ok "isiprime.db ($DB_SIZE)"
else
    warn "isiprime.db no existe (se creará automáticamente, pero sin datos previos)"
fi

if [ -f "requests.db" ]; then
    DB_SIZE=$(du -h requests.db | cut -f1)
    ok "requests.db ($DB_SIZE)"
else
    warn "requests.db no existe (se creará automáticamente)"
fi
echo ""

# --- 7. Directorio de películas ---
echo "--- Almacenamiento ---"
if [ -f "storage-settings.json" ]; then
    LOCAL_PATH=$(node -e "console.log(require('./storage-settings.json').localPath || 'NO CONFIGURADO')" 2>/dev/null)
    ok "storage-settings.json existe"
    echo "  localPath: $LOCAL_PATH"

    if [ -d "$LOCAL_PATH" ]; then
        FILE_COUNT=$(find "$LOCAL_PATH" -maxdepth 1 -type f \( -name "*.mp4" -o -name "*.mkv" -o -name "*.avi" \) 2>/dev/null | wc -l)
        SERIES_COUNT=$(find "$LOCAL_PATH/Series" -maxdepth 1 -type d 2>/dev/null | wc -l)
        SERIES_COUNT=$((SERIES_COUNT > 0 ? SERIES_COUNT - 1 : 0))
        DISK_FREE=$(df -h "$LOCAL_PATH" | awk 'NR==2{print $4}')
        ok "Directorio accesible: $FILE_COUNT películas, $SERIES_COUNT series"
        ok "Espacio libre: $DISK_FREE"
    else
        fail "Directorio '$LOCAL_PATH' no existe o no es accesible"
        ERRORS=$((ERRORS+1))
    fi
else
    fail "storage-settings.json no existe"
    ERRORS=$((ERRORS+1))
fi
echo ""

# --- 8. Red ---
echo "--- Red ---"
IP=$(hostname -I | awk '{print $1}')
ok "IP: $IP"
echo "  URL del servidor: http://$IP:8080"
echo ""

# --- 9. Logs directory ---
if [ ! -d "logs" ]; then
    mkdir -p logs
    ok "Directorio logs/ creado"
fi

# --- Resumen ---
echo "============================================"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}  ✓ Todo listo para arrancar IsiPrime${NC}"
    echo ""
    echo "  Siguiente paso:"
    echo "    node server.js              # Test rápido"
    echo "    pm2 start ecosystem.config.js  # Producción"
    echo "    pm2 save && pm2 startup     # Auto-inicio"
else
    echo -e "${RED}  ✗ $ERRORS errores encontrados${NC}"
    echo "  Corrige los errores y ejecuta este script de nuevo."
fi
echo "============================================"

exit $ERRORS
