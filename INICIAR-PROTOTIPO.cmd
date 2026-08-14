@echo off
setlocal
cd /d "%~dp0"

echo Iniciando ELEVANT...
start "ELEVANT Backend" cmd /k "cd /d ""%CD%\backend-prototipo"" && npm start"
timeout /t 2 /nobreak >nul
start "ELEVANT Web departamental" cmd /k "cd /d ""%CD%\frontend\web"" && npm run dev -- --host 0.0.0.0"
start "ELEVANT Portal aerolinea" cmd /k "cd /d ""%CD%\frontend\public-web"" && npm run dev -- --hostname 0.0.0.0"
start "ELEVANT Agente movil" cmd /k "cd /d ""%CD%\frontend\mobile-agent"" && npx expo start --tunnel --clear"

timeout /t 7 /nobreak >nul
start "" http://localhost:5173
start "" http://localhost:3000

echo.
echo Backend:       http://localhost:4310/health
echo Departamentos: http://localhost:5173
echo Aerolinea:     http://localhost:3000
echo Movil: escanea el QR de la ventana de Expo.
echo.
echo IMPORTANTE: el movil debe apuntar a la IP local de esta PC en frontend\mobile-agent\.env.
pause
