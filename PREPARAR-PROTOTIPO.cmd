@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul || (echo ERROR: Instala Node.js 20 o superior.& pause & exit /b 1)

call :install "frontend\web" || exit /b 1
call :install "frontend\public-web" || exit /b 1
call :install "frontend\mobile-agent" || exit /b 1

echo.
echo Preparacion completada.
pause
exit /b 0

:install
echo.
echo Instalando dependencias de %~1...
pushd "%~1"
call npm ci
if errorlevel 1 (popd & echo ERROR preparando %~1.& pause & exit /b 1)
popd
exit /b 0
