@echo off
:: HermesStream - Launcher
:: Doble clic para abrir la aplicación

cd /d "%~dp0"

:: Verificar si Node.js está instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js no esta instalado
    pause
    exit /b 1
)

:: Lanzar usando el script VBS (oculta la ventana)
cscript //nologo HermesStream.vbs
