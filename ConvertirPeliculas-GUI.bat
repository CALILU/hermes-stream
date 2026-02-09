@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "ConvertirPeliculas-GUI.ps1"
