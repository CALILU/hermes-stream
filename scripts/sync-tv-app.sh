#!/bin/bash
# Sync IsiPrime-WebOS-Native → tv-app/ → NAS
# Copia los módulos JS y CSS al directorio tv-app/ y sube al NAS

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "Copiando CSS..."
cp IsiPrime-WebOS-Native/css/styles.css tv-app/css/

echo "Copiando JS modules..."
for f in api login images focus nav-bar sidebar-grid-view keyboard carousel router home genre years sagas detail player series search requests actor app; do
    cp IsiPrime-WebOS-Native/js/$f.js tv-app/js/
done

echo "Copiando assets..."
mkdir -p tv-app/assets
cp IsiPrime-WebOS-Native/assets/icon-hd.png tv-app/assets/
cp IsiPrime-WebOS-Native/assets/logo.svg tv-app/assets/
cp IsiPrime-WebOS-Native/assets/placeholder.svg tv-app/assets/
cp IsiPrime-WebOS-Native/icon.png tv-app/assets/

echo "Archivos copiados a tv-app/"

# Subir al NAS
echo "Subiendo al NAS..."
scp -r tv-app/ isidro@192.168.1.45:~/isiprime/

echo "Sync completado"
