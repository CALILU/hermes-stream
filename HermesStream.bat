@echo off
:: IsiPrime - Launcher (NAS LincStation N2)
:: Doble clic para abrir IsiPrime en el navegador
:: Detecta automaticamente si esta en LAN o fuera de casa

:: Ping rapido al NAS (1 segundo timeout)
ping -n 1 -w 1000 192.168.1.45 >nul 2>nul

if %errorlevel%==0 (
    :: En casa - acceso LAN directo (mas rapido)
    start "" http://192.168.1.45:8080
) else (
    :: Fuera de casa - acceso via DDNS
    start "" https://calilu.mooo.com
)
