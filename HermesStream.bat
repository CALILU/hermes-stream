@echo off
:: HermesStream - Launcher
:: Doble clic para abrir la aplicacion

:: Auto-ocultar ventana: se relanza oculto si no tiene el parametro "hidden"
if not "%~1"=="hidden" (
    echo CreateObject^("WScript.Shell"^).Run "cmd /c ""%~f0"" hidden", 0, False > "%TEMP%\hermes_launch.vbs"
    cscript //nologo "%TEMP%\hermes_launch.vbs"
    del "%TEMP%\hermes_launch.vbs" 2>nul
    exit /b
)

:: Verificar si WSL esta disponible
where wsl >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: WSL no esta instalado
    pause
    exit /b 1
)

:: Verificar si el servidor ya esta corriendo en puerto 8080
curl -s -o nul -w "%%{http_code}" http://localhost:8080/api/auth/status >"%TEMP%\hermes_check.txt" 2>nul
set /p STATUS=<"%TEMP%\hermes_check.txt"
del "%TEMP%\hermes_check.txt" 2>nul

if "%STATUS%"=="200" (
    :: Servidor ya corriendo, solo abrir navegador
    start "" http://localhost:8080
    exit /b
)

:: Montar disco FTP via rclone (si no esta montado)
wsl -e bash -c "mountpoint -q /home/isidr/ftp-mount 2>/dev/null || rclone mount router-ftp:/volume-1/ /home/isidr/ftp-mount --read-only --vfs-cache-mode minimal --dir-cache-time 5m --daemon 2>/dev/null; sleep 2"

:: Iniciar servidor en WSL (usar nvm node v20 via PATH, start /b para no bloquear)
start "" /b wsl -e bash -c "export PATH=\"$HOME/.nvm/versions/node/v20.19.6/bin:$PATH\" && cd /mnt/f/plex && node server.js > /tmp/hermes.log 2>&1"

:: Esperar a que el servidor arranque (max 30 segundos)
set ATTEMPTS=0
:wait_loop
if %ATTEMPTS% geq 30 (
    echo ERROR: El servidor no arranco a tiempo
    exit /b 1
)
timeout /t 1 /nobreak >nul
curl -s -o nul -w "%%{http_code}" http://localhost:8080/api/auth/status >"%TEMP%\hermes_check.txt" 2>nul
set /p STATUS=<"%TEMP%\hermes_check.txt"
del "%TEMP%\hermes_check.txt" 2>nul
if "%STATUS%"=="200" goto :server_ready
set /a ATTEMPTS+=1
goto :wait_loop

:server_ready
:: Abrir navegador
start "" http://localhost:8080
