# Detectar archivos MP4 con codecs no compatibles con navegadores
# Uso: .\detectar-codecs.ps1

$ruta = "E:\"
$compatibles = @("h264", "avc1", "hevc", "h265", "hvc1", "hev1")
$incompatibles = @()

Write-Host "`nEscaneando archivos MP4 en $ruta...`n" -ForegroundColor Cyan

$archivos = Get-ChildItem -Path $ruta -Filter "*.mp4" -File

foreach ($archivo in $archivos) {
    $codec = & ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of default=noprint_wrappers=1:nokey=1 $archivo.FullName 2>$null
    $codec = $codec.Trim().ToLower()

    if ($codec -and $compatibles -notcontains $codec) {
        $incompatibles += [PSCustomObject]@{
            Archivo = $archivo.Name
            Codec = $codec
            Tamano = "{0:N2} GB" -f ($archivo.Length / 1GB)
        }
        Write-Host "  [X] $($archivo.Name) - $codec" -ForegroundColor Red
    } else {
        Write-Host "  [OK] $($archivo.Name) - $codec" -ForegroundColor Green
    }
}

Write-Host "`n========================================" -ForegroundColor Yellow
Write-Host "RESUMEN:" -ForegroundColor Yellow
Write-Host "  Total archivos: $($archivos.Count)"
Write-Host "  Compatibles: $($archivos.Count - $incompatibles.Count)" -ForegroundColor Green
Write-Host "  INCOMPATIBLES: $($incompatibles.Count)" -ForegroundColor Red

if ($incompatibles.Count -gt 0) {
    Write-Host "`nArchivos que necesitan CONVERSION (no remux):" -ForegroundColor Yellow
    $incompatibles | Format-Table -AutoSize

    # Guardar lista
    $incompatibles | Select-Object Archivo, Codec | Export-Csv -Path "$ruta\incompatibles.csv" -NoTypeInformation -Encoding UTF8
    Write-Host "Lista guardada en: $ruta\incompatibles.csv`n" -ForegroundColor Cyan
}
