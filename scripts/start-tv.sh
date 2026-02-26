#!/bin/bash

# Forzar Node v20 via nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export PATH="$HOME/.nvm/versions/node/v20.19.6/bin:$PATH"

cd "$(dirname "$0")/.." || exit 1

echo "========================================="
echo "  IsiPrime - Servidor + TV"
echo "========================================="
echo "  Node: $(node --version)"

# Montar disco FTP del Livebox (si no esta montado)
if ! mountpoint -q /home/isidr/ftp-mount 2>/dev/null; then
    echo "[1/4] Montando disco del Livebox..."
    rclone mount router-ftp:/volume-1/ /home/isidr/ftp-mount --read-only --vfs-cache-mode minimal --dir-cache-time 5m --daemon 2>/dev/null
    sleep 2
    if mountpoint -q /home/isidr/ftp-mount 2>/dev/null; then
        echo "     Disco montado OK"
    else
        echo "ERROR: No se pudo montar el disco del Livebox"
        exit 1
    fi
else
    echo "[1/4] Disco del Livebox ya montado"
fi

OLD_PID=$(lsof -ti:8080 2>/dev/null)
if [ -n "$OLD_PID" ]; then
    echo "[2/4] Deteniendo servidor anterior..."
    kill "$OLD_PID" 2>/dev/null
    sleep 2
fi

echo "[3/4] Arrancando servidor IsiPrime..."
node server.js &
SERVER_PID=$!

echo "     Esperando a que el servidor este listo..."
for i in $(seq 1 15); do
    if curl -s http://localhost:8080/api/auth/status > /dev/null 2>&1; then
        echo "     Servidor listo en puerto 8080"
        break
    fi
    sleep 1
done

if ! curl -s http://localhost:8080/api/auth/status > /dev/null 2>&1; then
    echo "ERROR: El servidor no arranco correctamente"
    exit 1
fi

echo "[4/4] Lanzando IsiPrime en la TV..."
ares-launch --device miLGTV com.isiprime.app 2>&1

if [ $? -eq 0 ]; then
    echo ""
    echo "========================================="
    echo "  Todo listo!"
    echo "  Servidor: http://192.168.1.18:8080"
    echo "  TV: App lanzada"
    echo "========================================="
else
    echo "AVISO: No se pudo lanzar la app en la TV"
fi

echo ""
echo "Pulsa Ctrl+C para detener el servidor"
wait $SERVER_PID
