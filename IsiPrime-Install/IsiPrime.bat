@echo off
:: ============================================
:: IsiPrime - Launcher
:: Doble clic para iniciar la aplicacion
:: ============================================

:: Auto-ocultar ventana CMD
if not "%~1"=="hidden" (
    echo CreateObject^("WScript.Shell"^).Run "cmd /c ""%~f0"" hidden", 0, False > "%TEMP%\isiprime_launch.vbs"
    cscript //nologo "%TEMP%\isiprime_launch.vbs"
    del "%TEMP%\isiprime_launch.vbs" 2>nul
    exit /b
)

cd /d "%~dp0"

:: Verificar que Node.js esta instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    msg * "ERROR: Node.js no esta instalado. Ejecuta INSTALAR.bat primero."
    exit /b 1
)

:: Verificar que node_modules existe
if not exist "node_modules" (
    msg * "ERROR: Dependencias no instaladas. Ejecuta INSTALAR.bat primero."
    exit /b 1
)

:: Verificar si el servidor ya esta corriendo
curl -s -o nul -w "%%{http_code}" http://localhost:8080/api/auth/status >"%TEMP%\isiprime_check.txt" 2>nul
set /p STATUS=<"%TEMP%\isiprime_check.txt"
del "%TEMP%\isiprime_check.txt" 2>nul

if "%STATUS%"=="200" (
    :: Servidor ya corriendo, solo abrir navegador
    start "" http://localhost:8080
    exit /b 0
)

:: Iniciar servidor en segundo plano
start /min "" node server.js

:: Esperar a que el servidor arranque
timeout /t 4 /nobreak >nul

:: Abrir navegador
start "" http://localhost:8080
