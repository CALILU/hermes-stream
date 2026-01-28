@echo off
echo Restaurando build del frontend...

if exist "backups\build-backup-20260128" (
    if exist "my-ui\build" rmdir /s /q "my-ui\build"
    xcopy /e /i /y "backups\build-backup-20260128" "my-ui\build"
    echo.
    echo Build restaurado correctamente!
) else (
    echo ERROR: No se encontro el backup
    echo Ejecuta: cd my-ui ^&^& npm run build
)

pause
