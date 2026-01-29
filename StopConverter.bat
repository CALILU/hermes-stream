@echo off
title Detener IsiPrime Batch Converter

echo Deteniendo IsiPrime Batch Converter (puerto 4000)...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :4000 ^| findstr LISTENING') do (
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Batch Converter detenido.
pause
