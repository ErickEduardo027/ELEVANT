@echo off
setlocal
cd /d "%~dp0"
if not exist "frontend\public-web\.env.local" copy "frontend\public-web\.env.example" "frontend\public-web\.env.local" >nul
start "ELEVANT Backend prototipo" cmd /k "cd /d ""%~dp0backend-prototipo"" && npm start"
start "ELEVANT Departamentos" cmd /k "cd /d ""%~dp0frontend\web"" && npm run dev"
start "ELEVANT Portal aerolinea" cmd /k "cd /d ""%~dp0frontend\public-web"" && npm run dev"
echo Servicios iniciados. Espere a que cada terminal muestre su direccion.
