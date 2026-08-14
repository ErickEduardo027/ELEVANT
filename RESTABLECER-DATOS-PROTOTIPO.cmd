@echo off
setlocal
cd /d "%~dp0"
echo Cierra primero el backend. Esta accion reiniciara el prototipo con los datos iniciales.
set /p CONFIRMAR=Escribe SI para continuar:
if /I not "%CONFIRMAR%"=="SI" exit /b 0

if exist "backend-prototipo\data\runtime.json" (
  move "backend-prototipo\data\runtime.json" "backend-prototipo\data\runtime.backup-%RANDOM%.json" >nul
  echo Datos anteriores respaldados y estado restablecido.
) else (
  echo El prototipo ya estaba limpio.
)
pause
