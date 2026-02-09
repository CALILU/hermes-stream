# Script para crear el ZIP del instalador completo

$src = "F:\plex"
$dest = "F:\plex\installer\IsiPrime"

Write-Host "`n=== Creando instalador IsiPrime ===" -ForegroundColor Cyan

# Limpiar y crear directorio
if (Test-Path "F:\plex\installer") { Remove-Item "F:\plex\installer" -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
New-Item -ItemType Directory -Force -Path "$dest\my-ui" | Out-Null

Write-Host "Copiando archivos..." -ForegroundColor Gray

# Copiar archivos principales
Copy-Item "$src\server.js" $dest
Copy-Item "$src\converter-server.js" $dest
Copy-Item "$src\package.json" $dest
Copy-Item "$src\package-lock.json" $dest -ErrorAction SilentlyContinue
Copy-Item "$src\.env" $dest
Copy-Item "$src\HermesStream.bat" $dest
Copy-Item "$src\HermesStream.vbs" $dest
Copy-Item "$src\ConvertirPeliculas-GUI.bat" $dest
Copy-Item "$src\StopServers.vbs" $dest
Copy-Item "$src\StopConverter.bat" $dest
Copy-Item "$src\isiprime.ico" $dest -ErrorAction SilentlyContinue

# Copiar frontends
Copy-Item "$src\my-ui\build" "$dest\my-ui" -Recurse -Force
Copy-Item "$src\converter-ui" $dest -Recurse -Force

Write-Host "Creando scripts de instalacion..." -ForegroundColor Gray

# Crear INSTALL.bat
@'
@echo off
title IsiPrime - Instalador
color 0B

echo.
echo   ============================================
echo           IsiPrime - Instalador
echo   ============================================
echo.
echo   Este instalador configurara automaticamente:
echo     - Node.js (si no esta instalado)
echo     - FFmpeg (si no esta instalado)
echo     - Dependencias del proyecto
echo     - Accesos directos en el escritorio
echo.
echo   Presiona cualquier tecla para continuar...
pause >nul

:: Ejecutar el script de PowerShell
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0install.ps1"
'@ | Out-File -FilePath "$dest\INSTALL.bat" -Encoding ASCII

# Crear install.ps1
@'
$installPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$hasErrors = $false

function Write-Title($text) { Write-Host "`n=== $text ===" -ForegroundColor Cyan }
function Write-Success($text) { Write-Host "[OK] $text" -ForegroundColor Green }
function Write-Warn($text) { Write-Host "[!] $text" -ForegroundColor Yellow }
function Write-Err($text) { Write-Host "[ERROR] $text" -ForegroundColor Red; $script:hasErrors = $true }

Clear-Host
Write-Host ""
Write-Host "  ========================================" -ForegroundColor Magenta
Write-Host "     IsiPrime - Instalador Automatico" -ForegroundColor Magenta
Write-Host "  ========================================" -ForegroundColor Magenta
Write-Host ""
Write-Host "  Directorio: $installPath" -ForegroundColor Gray
Write-Host ""

# 1. VERIFICAR NODE.JS
Write-Title "Verificando Node.js"
$nodeInstalled = $false
try {
    $nodeVersion = & node --version 2>$null
    if ($nodeVersion) {
        Write-Success "Node.js instalado: $nodeVersion"
        $nodeInstalled = $true
    }
} catch {
    Write-Host "    No se pudo verificar Node.js" -ForegroundColor Gray
}

if (-not $nodeInstalled) {
    Write-Warn "Node.js no encontrado. Descargando..."
    try {
        $nodeUrl = "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi"
        $nodeInstaller = "$env:TEMP\node-installer.msi"
        Write-Host "    Descargando de nodejs.org..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeInstaller -UseBasicParsing
        Write-Host "    Instalando (puede tardar)..." -ForegroundColor Gray
        Start-Process msiexec.exe -ArgumentList "/i `"$nodeInstaller`" /qn" -Wait -NoNewWindow
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        Write-Success "Node.js instalado"
    } catch {
        Write-Err "No se pudo instalar Node.js: $_"
        Write-Host "    Instala manualmente desde https://nodejs.org" -ForegroundColor Yellow
    }
}

# 2. VERIFICAR FFMPEG
Write-Title "Verificando FFmpeg"
$ffmpegInstalled = $false
try {
    $ffmpegTest = & ffmpeg -version 2>$null | Select-Object -First 1
    if ($ffmpegTest) {
        Write-Success "FFmpeg instalado"
        $ffmpegInstalled = $true
    }
} catch {
    Write-Host "    FFmpeg no encontrado en PATH" -ForegroundColor Gray
}

if (-not $ffmpegInstalled) {
    Write-Warn "FFmpeg no encontrado. Descargando..."
    try {
        $ffmpegDir = "$installPath\ffmpeg"
        $ffmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
        $ffmpegZip = "$env:TEMP\ffmpeg.zip"
        Write-Host "    Descargando FFmpeg (~80MB, puede tardar)..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip -UseBasicParsing
        Write-Host "    Extrayendo..." -ForegroundColor Gray
        Expand-Archive -Path $ffmpegZip -DestinationPath "$env:TEMP\ffmpeg-extract" -Force
        $extractedFolder = Get-ChildItem "$env:TEMP\ffmpeg-extract" | Select-Object -First 1
        if (Test-Path $ffmpegDir) { Remove-Item $ffmpegDir -Recurse -Force }
        Move-Item "$($extractedFolder.FullName)\bin" $ffmpegDir
        $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$ffmpegDir*") {
            [System.Environment]::SetEnvironmentVariable("Path", "$userPath;$ffmpegDir", "User")
            $env:Path = "$env:Path;$ffmpegDir"
        }
        Remove-Item $ffmpegZip -Force -ErrorAction SilentlyContinue
        Remove-Item "$env:TEMP\ffmpeg-extract" -Recurse -Force -ErrorAction SilentlyContinue
        Write-Success "FFmpeg instalado en $ffmpegDir"
    } catch {
        Write-Err "No se pudo instalar FFmpeg: $_"
        Write-Host "    El Batch Converter no funcionara sin FFmpeg" -ForegroundColor Yellow
    }
}

# 3. INSTALAR DEPENDENCIAS
Write-Title "Instalando dependencias NPM"
try {
    Set-Location $installPath

    # Refrescar PATH para detectar Node.js recien instalado
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

    # Buscar npm en ubicaciones comunes si no esta en PATH
    $npmCmd = "npm"
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        $nodePaths = @(
            "$env:ProgramFiles\nodejs\npm.cmd",
            "$env:LOCALAPPDATA\Programs\nodejs\npm.cmd",
            "C:\Program Files\nodejs\npm.cmd"
        )
        foreach ($p in $nodePaths) {
            if (Test-Path $p) {
                $npmCmd = $p
                Write-Host "    Encontrado npm en: $p" -ForegroundColor Gray
                break
            }
        }
    }

    Write-Host "    Ejecutando npm install..." -ForegroundColor Gray
    $npmResult = & $npmCmd install 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Dependencias instaladas"
    } else {
        Write-Err "npm install fallo"
        Write-Host $npmResult -ForegroundColor Red
    }
} catch {
    Write-Err "Error en npm install: $_"
    Write-Host "    Prueba cerrar esta ventana y ejecutar INSTALL.bat de nuevo" -ForegroundColor Yellow
}

# 4. CREAR ACCESOS DIRECTOS
Write-Title "Creando accesos directos"
try {
    $desktop = [Environment]::GetFolderPath("Desktop")
    $WshShell = New-Object -ComObject WScript.Shell

    $shortcut = $WshShell.CreateShortcut("$desktop\IsiPrime.lnk")
    $shortcut.TargetPath = "$installPath\HermesStream.vbs"
    $shortcut.WorkingDirectory = $installPath
    $shortcut.Description = "IsiPrime - Servidor de Streaming"
    $shortcut.Save()

    $shortcut2 = $WshShell.CreateShortcut("$desktop\IsiPrime Batch Converter.lnk")
    $shortcut2.TargetPath = "$installPath\ConvertirPeliculas-GUI.bat"
    $shortcut2.WorkingDirectory = $installPath
    $shortcut2.Description = "IsiPrime Batch Converter"
    $shortcut2.Save()

    Write-Success "Accesos directos creados en el escritorio"
} catch {
    Write-Err "No se pudieron crear accesos directos: $_"
}

# RESUMEN
Write-Host ""
if ($hasErrors) {
    Write-Host "  ========================================" -ForegroundColor Yellow
    Write-Host "  Instalacion completada con ADVERTENCIAS" -ForegroundColor Yellow
    Write-Host "  ========================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Revisa los errores arriba." -ForegroundColor Yellow
} else {
    Write-Host "  ========================================" -ForegroundColor Green
    Write-Host "       Instalacion completada!" -ForegroundColor Green
    Write-Host "  ========================================" -ForegroundColor Green
}
Write-Host ""
Write-Host "  Accesos directos en el escritorio:" -ForegroundColor White
Write-Host "    - IsiPrime (Servidor de streaming)" -ForegroundColor Gray
Write-Host "    - IsiPrime Batch Converter" -ForegroundColor Gray
Write-Host ""

$launch = Read-Host "Iniciar IsiPrime ahora? (S/n)"
if ($launch -ne "n" -and $launch -ne "N") {
    Start-Process "$installPath\HermesStream.vbs"
}

Write-Host ""
Write-Host "Presiona Enter para cerrar..." -ForegroundColor Cyan
Read-Host
'@ | Out-File -FilePath "$dest\install.ps1" -Encoding UTF8

# Crear README.txt
@'
============================================
   IsiPrime - Guia de Instalacion
============================================

INSTALACION AUTOMATICA
----------------------
1. Haz doble clic en INSTALL.bat
2. Espera a que termine la instalacion
3. Listo! Tendras accesos directos en el escritorio

El instalador configura automaticamente:
- Node.js (si no esta instalado)
- FFmpeg (si no esta instalado)
- Dependencias del proyecto
- Accesos directos

USO
---
- IsiPrime: Servidor de streaming (puerto 8080)
- Batch Converter: Conversor de peliculas (puerto 3333)

CONFIGURACION
-------------
El archivo .env ya viene configurado con:
- Servidor FTP
- API keys de TMDB

============================================
'@ | Out-File -FilePath "$dest\README.txt" -Encoding ASCII

# Crear ZIP
Write-Host "Creando ZIP..." -ForegroundColor Gray
$zipPath = "F:\plex\IsiPrime-Installer.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path $dest -DestinationPath $zipPath -Force

# Limpiar
Remove-Item "F:\plex\installer" -Recurse -Force

Write-Host ""
Write-Host "=== ZIP creado exitosamente ===" -ForegroundColor Green
Write-Host ""
$zipInfo = Get-Item $zipPath
Write-Host "Archivo: $($zipInfo.Name)" -ForegroundColor White
Write-Host "Tamano:  $([math]::Round($zipInfo.Length/1MB, 2)) MB" -ForegroundColor White
Write-Host "Ruta:    $zipPath" -ForegroundColor Gray
Write-Host ""
