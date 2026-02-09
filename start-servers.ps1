# HermesStream - Script de arranque de servidores
# Ejecutar con: .\start-servers.ps1

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "   HermesStream - Iniciando servidores" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

$projectPath = Split-Path -Parent $MyInvocation.MyCommand.Path

# Verificar que estamos en el directorio correcto
if (-not (Test-Path "$projectPath\server.js")) {
    Write-Host "Error: No se encuentra server.js" -ForegroundColor Red
    Write-Host "Ejecuta este script desde el directorio del proyecto" -ForegroundColor Yellow
    pause
    exit 1
}

# Matar procesos previos de node en estos puertos
Write-Host "Limpiando procesos anteriores..." -ForegroundColor Yellow
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 1

# Verificar node_modules
if (-not (Test-Path "$projectPath\node_modules")) {
    Write-Host "Instalando dependencias del backend..." -ForegroundColor Yellow
    Set-Location $projectPath
    npm install
}

if (-not (Test-Path "$projectPath\my-ui\node_modules")) {
    Write-Host "Instalando dependencias del frontend..." -ForegroundColor Yellow
    Set-Location "$projectPath\my-ui"
    npm install
    Set-Location $projectPath
}

Write-Host ""
Write-Host "[1/2] Iniciando Backend (puerto 4000)..." -ForegroundColor Green

# Iniciar backend en nueva ventana
$backendCmd = "cd '$projectPath'; Write-Host '=== Backend HermesStream ===' -ForegroundColor Cyan; Write-Host 'Puerto: 4000' -ForegroundColor Gray; Write-Host ''; node server.js"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd -WindowStyle Normal

# Esperar a que el backend esté listo
Write-Host "Esperando a que el backend arranque..." -ForegroundColor Gray
$maxAttempts = 30
$attempt = 0
$backendReady = $false

while ($attempt -lt $maxAttempts -and -not $backendReady) {
    Start-Sleep -Seconds 1
    $attempt++
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:4000/api/test" -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.StatusCode -eq 200) {
            $backendReady = $true
            Write-Host "Backend listo!" -ForegroundColor Green
        }
    } catch {
        Write-Host "." -NoNewline -ForegroundColor Gray
    }
}

if (-not $backendReady) {
    Write-Host ""
    Write-Host "Advertencia: El backend puede no estar listo aun" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[2/2] Iniciando Frontend (puerto 3000)..." -ForegroundColor Green

# Iniciar frontend en nueva ventana
$frontendCmd = "cd '$projectPath\my-ui'; Write-Host '=== Frontend HermesStream ===' -ForegroundColor Cyan; Write-Host 'Puerto: 3000' -ForegroundColor Gray; Write-Host ''; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd -WindowStyle Normal

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "   Servidores iniciados" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Backend:  http://localhost:4000" -ForegroundColor White
Write-Host "Frontend: http://localhost:3000" -ForegroundColor White
Write-Host ""
Write-Host "El navegador se abrira automaticamente cuando el frontend este listo." -ForegroundColor Gray
Write-Host ""
Write-Host "Puedes cerrar esta ventana." -ForegroundColor Cyan
