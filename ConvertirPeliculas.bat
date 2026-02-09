@echo off
chcp 65001 >nul
title IsiPrime Batch Converter

echo.
echo ╔═══════════════════════════════════════════════════════════════╗
echo ║           IsiPrime Batch Converter v1.0                       ║
echo ║      Convierte AVI/MKV a MP4 con aceleración GPU              ║
echo ╚═══════════════════════════════════════════════════════════════╝
echo.

:: Verificar si se pasó un directorio como argumento
if "%~1"=="" (
    echo Uso: Arrastra una carpeta sobre este archivo BAT
    echo      o ejecuta: ConvertirPeliculas.bat "C:\ruta\a\peliculas"
    echo.
    echo Opciones disponibles:
    echo   --delete       Eliminar originales después de convertir
    echo   --gpu=nvidia   Forzar GPU NVIDIA
    echo   --gpu=intel    Forzar GPU Intel
    echo   --gpu=amd      Forzar GPU AMD
    echo   --gpu=none     Usar solo CPU
    echo   --dry-run      Solo mostrar qué se convertiría
    echo.
    set /p "FOLDER=Introduce la ruta de la carpeta (o pulsa Enter para usar el directorio actual): "
    if "%FOLDER%"=="" set "FOLDER=."
) else (
    set "FOLDER=%~1"
)

echo.
echo Carpeta seleccionada: %FOLDER%
echo.

:: Cambiar al directorio del script
cd /d "%~dp0"

:: Ejecutar el conversor
node batch-converter.js "%FOLDER%" %2 %3 %4 %5

echo.
pause
