@echo off
title IsiPrime - Servidor Backend (Debug)
color 0A
echo ========================================
echo    IsiPrime - Modo Debug
echo ========================================
echo.
echo Iniciando servidor backend...
echo Los logs apareceran aqui abajo:
echo ----------------------------------------
echo.
cd /d "%~dp0"
node server.js
pause
