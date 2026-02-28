@echo off
chcp 65001 >nul 2>nul
title IsiPrime - Instalacion
color 0A

echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║         IsiPrime - Instalacion            ║
echo  ╚═══════════════════════════════════════════╝
echo.

cd /d "%~dp0"

:: ==========================================
:: PASO 1: Verificar Node.js
:: ==========================================
echo [1/3] Verificando Node.js...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo  Node.js NO esta instalado.
    echo  Descargando instalador de Node.js...
    echo.

    :: Descargar Node.js LTS
    curl -L -o "%TEMP%\node-installer.msi" "https://nodejs.org/dist/v22.15.0/node-v22.15.0-x64.msi" 2>nul
    if exist "%TEMP%\node-installer.msi" (
        echo  Ejecutando instalador de Node.js...
        echo  SIGUE LAS INSTRUCCIONES DEL INSTALADOR.
        echo.
        start /wait msiexec /i "%TEMP%\node-installer.msi"
        del "%TEMP%\node-installer.msi" 2>nul

        :: Refrescar PATH
        set "PATH=%PATH%;C:\Program Files\nodejs"

        where node >nul 2>nul
        if %errorlevel% neq 0 (
            echo.
            echo  ERROR: Node.js no se instalo correctamente.
            echo  Instala Node.js manualmente desde: https://nodejs.org
            echo  Despues ejecuta este script de nuevo.
            echo.
            pause
            exit /b 1
        )
    ) else (
        echo.
        echo  ERROR: No se pudo descargar Node.js.
        echo  Instala Node.js manualmente desde: https://nodejs.org
        echo  Despues ejecuta este script de nuevo.
        echo.
        pause
        exit /b 1
    )
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo  Node.js %NODE_VER% detectado. OK
echo.

:: ==========================================
:: PASO 2: Instalar dependencias
:: ==========================================
echo [2/3] Instalando dependencias...
echo  Esto puede tardar unos minutos...
echo.

call npm install --production 2>nul
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Fallo al instalar dependencias.
    echo  Verifica tu conexion a internet e intentalo de nuevo.
    echo.
    pause
    exit /b 1
)

echo  Dependencias instaladas correctamente. OK
echo.

:: ==========================================
:: PASO 3: Verificacion final
:: ==========================================
echo [3/3] Verificando instalacion...

if not exist "node_modules" (
    echo  ERROR: node_modules no existe
    pause
    exit /b 1
)

if not exist "server.js" (
    echo  ERROR: server.js no encontrado
    pause
    exit /b 1
)

if not exist "my-ui\build\index.html" (
    echo  ERROR: Frontend no encontrado
    pause
    exit /b 1
)

if not exist ".env" (
    echo  ERROR: .env no encontrado
    pause
    exit /b 1
)

echo  Todo correcto. OK
echo.
echo  ╔═══════════════════════════════════════════╗
echo  ║      INSTALACION COMPLETADA               ║
echo  ║                                           ║
echo  ║  Para iniciar: doble clic en IsiPrime.bat ║
echo  ║                                           ║
echo  ║  Crea un acceso directo a IsiPrime.bat    ║
echo  ║  en tu escritorio para facil acceso.      ║
echo  ╚═══════════════════════════════════════════╝
echo.

:: Preguntar si crear acceso directo
set /p CREAR_ACCESO="Crear acceso directo en el escritorio? (S/N): "
if /i "%CREAR_ACCESO%"=="S" (
    echo Set oWS = WScript.CreateObject^("WScript.Shell"^) > "%TEMP%\create_shortcut.vbs"
    echo sLinkFile = oWS.SpecialFolders^("Desktop"^) ^& "\IsiPrime.lnk" >> "%TEMP%\create_shortcut.vbs"
    echo Set oLink = oWS.CreateShortcut^(sLinkFile^) >> "%TEMP%\create_shortcut.vbs"
    echo oLink.TargetPath = "%~dp0IsiPrime.bat" >> "%TEMP%\create_shortcut.vbs"
    echo oLink.WorkingDirectory = "%~dp0" >> "%TEMP%\create_shortcut.vbs"
    echo oLink.Description = "IsiPrime - Streaming" >> "%TEMP%\create_shortcut.vbs"
    echo oLink.Save >> "%TEMP%\create_shortcut.vbs"
    cscript //nologo "%TEMP%\create_shortcut.vbs"
    del "%TEMP%\create_shortcut.vbs" 2>nul
    echo.
    echo  Acceso directo creado en el escritorio.
)

echo.
pause
