@echo off
chcp 65001 >nul
title IsiPrime Batch Converter

echo.
echo  ╔═══════════════════════════════════════════════════════════════╗
echo  ║           IsiPrime Batch Converter v2.0                       ║
echo  ║        Interfaz web para conversion masiva                    ║
echo  ╚═══════════════════════════════════════════════════════════════╝
echo.

cd /d "%~dp0"

echo  Iniciando servidor...
echo.
echo  Abriendo navegador en: http://localhost:4000
echo.

:: Abrir navegador después de 2 segundos
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:4000"

:: Iniciar servidor
node converter-server.js

pause
