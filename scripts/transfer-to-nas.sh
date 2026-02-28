#!/bin/bash
# =============================================================
# IsiPrime - Transferir código y datos al NAS
# Ejecutar DESDE Windows/WSL apuntando al NAS
# =============================================================

set -e

# ===== CONFIGURAR AQUÍ =====
NAS_USER="${1:-usuario}"
NAS_IP="${2:-192.168.1.X}"
NAS_DIR="${3:-~/isiprime}"
# ============================

if [ "$NAS_IP" = "192.168.1.X" ]; then
    echo "Uso: $0 <usuario> <ip_nas> [directorio_destino]"
    echo "Ejemplo: $0 isidr 192.168.1.100 ~/isiprime"
    exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${NAS_USER}@${NAS_IP}:${NAS_DIR}"

echo "============================================"
echo "  IsiPrime - Transferencia al NAS"
echo "============================================"
echo "Origen:  $PROJECT_DIR"
echo "Destino: $DEST"
echo ""

# 1. Crear directorio en el NAS
echo "--- Creando directorio en el NAS ---"
ssh "${NAS_USER}@${NAS_IP}" "mkdir -p ${NAS_DIR}"

# 2. Transferir código (sin node_modules, sin .env, sin DBs grandes)
echo "--- Transfiriendo código ---"
rsync -avh --progress \
    --exclude 'node_modules/' \
    --exclude '.env' \
    --exclude '*.db' \
    --exclude '*.db-shm' \
    --exclude '*.db-wal' \
    --exclude 'my-ui/node_modules/' \
    --exclude 'temp_conversions/' \
    --exclude 'backups/' \
    --exclude 'salvamento/' \
    --exclude 'IsiPrime-Install/' \
    --exclude 'IsiPrime-Installer.zip' \
    --exclude 'IsiPrime-WebOS/' \
    --exclude 'claude-workflow-documenta/' \
    --exclude '.claude/' \
    --exclude '*.ipk' \
    --exclude '*.py' \
    --exclude '*.txt' \
    --exclude 'prueba.*' \
    "$PROJECT_DIR/" "$DEST/"

# 3. Transferir React build (CRÍTICO)
echo ""
echo "--- Transfiriendo React build ---"
rsync -avh --progress "$PROJECT_DIR/my-ui/build/" "$DEST/my-ui/build/"

# 4. Transferir bases de datos SQLite
echo ""
echo "--- Transfiriendo bases de datos ---"
scp "$PROJECT_DIR/isiprime.db" "$DEST/isiprime.db"
scp "$PROJECT_DIR/requests.db" "$DEST/requests.db"

# 5. Transferir .env.nas como .env
echo ""
echo "--- Transfiriendo .env ---"
scp "$PROJECT_DIR/.env.nas" "${NAS_USER}@${NAS_IP}:${NAS_DIR}/.env"

echo ""
echo "============================================"
echo "  Transferencia completada"
echo "============================================"
echo ""
echo "Siguiente paso en el NAS:"
echo "  ssh ${NAS_USER}@${NAS_IP}"
echo "  cd ${NAS_DIR}"
echo "  npm install                    # Instalar dependencias"
echo "  nano .env                      # Ajustar LOCAL_VIDEOS_PATH"
echo "  bash scripts/migrate-to-nas.sh # Validar instalación"
echo "  node server.js                 # Test rápido"
echo "============================================"
