@echo off
title IsiPrime - Iniciador Debug
color 0B
echo ========================================
echo    IsiPrime - Modo Debug Completo
echo ========================================
echo.

cd /d "%~dp0"

echo [1/2] Iniciando Backend (ventana separada)...
start "IsiPrime Backend" cmd /k "color 0A && node server.js"

echo [2/2] Esperando backend...
timeout /t 3 /nobreak > nul

echo [3/3] Iniciando Frontend (ventana separada)...
start "IsiPrime Frontend" cmd /k "color 0E && cd my-ui && npm start"

echo.
echo ========================================
echo Servidores iniciados en ventanas separadas
echo - Verde: Backend (puerto 4000)
echo - Amarillo: Frontend (puerto 3000)
echo ========================================
echo.
echo Abriendo navegador en 8 segundos...
timeout /t 8 /nobreak > nul
start http://localhost:3000

echo.
echo Puedes cerrar esta ventana.
pause
