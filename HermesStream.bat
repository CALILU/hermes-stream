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

cd /d "%~dp0"

:: Verificar si Node.js esta instalado
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js no esta instalado
    pause
    exit /b 1
)

:: Verificar si el servidor ya esta corriendo en puerto 8080
curl -s -o nul -w "%%{http_code}" http://localhost:8080/api/auth/status >"%TEMP%\hermes_check.txt" 2>nul
set /p STATUS=<"%TEMP%\hermes_check.txt"
del "%TEMP%\hermes_check.txt" 2>nul

if "%STATUS%"=="200" (
    echo Servidor ya esta corriendo, abriendo navegador...
) else (
    echo Iniciando servidor HermesStream...
    start /min "" node server.js
    :: Esperar a que el servidor arranque
    timeout /t 4 /nobreak >nul
)

:: Abrir navegador
start "" http://localhost:8080
