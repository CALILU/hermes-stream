@echo off
:: IsiPrime - Launcher (NAS LincStation N2)
:: Doble clic para abrir IsiPrime en el navegador

:: IP del NAS
set NAS_URL=http://192.168.1.45:8080

:: Abrir navegador directamente
start "" %NAS_URL%
