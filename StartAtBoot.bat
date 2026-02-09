@echo off
:: Añadir HermesStream al inicio de Windows
:: Ejecutar como administrador

set STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
copy "%~dp0HermesStream.vbs" "%STARTUP%\HermesStream.vbs"

echo.
echo HermesStream se iniciara automaticamente con Windows.
echo Los servidores arrancaran ocultos en segundo plano.
echo.
echo Para quitar del inicio, elimina el archivo de:
echo %STARTUP%\HermesStream.vbs
echo.
pause
