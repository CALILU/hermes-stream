@echo off
chcp 65001 >nul
title IsiPrime Batch Converter

echo =========================================
echo   AVI / MKV → MP4  (ELIMINA ORIGINALES)
echo =========================================
echo.

if "%~1"=="" (
    set /p FOLDER=Introduce la carpeta a convertir: 
) else (
    set "FOLDER=%~1"
)

if not exist "%FOLDER%" (
    echo ERROR: La carpeta no existe.
    pause
    exit /b 1
)

echo.
set /p CONFIRM=¿Seguro que deseas continuar y eliminar los originales? (S/N): 
if /I not "%CONFIRM%"=="S" (
    echo Operación cancelada.
    pause
    exit /b
)

cd /d "%~dp0"

node batch-converter.js "%FOLDER%" --delete %2 %3 %4
if errorlevel 1 (
    echo.
    echo ERROR durante la conversión.
)

pause
