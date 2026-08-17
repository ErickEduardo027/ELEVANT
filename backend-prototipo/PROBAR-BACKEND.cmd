@echo off
setlocal
cd /d "%~dp0"
echo Ejecutando pruebas del backend local de ELEVANT...
npm test
pause
