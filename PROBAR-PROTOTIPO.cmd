@echo off
setlocal
cd /d "%~dp0"

call :run "backend-prototipo" "npm test" || goto :failed
call :run "frontend\private-web" "npm test" || goto :failed
call :run "frontend\public-web" "npm run typecheck" || goto :failed
call :run "frontend\mobile-agent" "npx tsc --noEmit" || goto :failed

echo.
echo TODAS LAS VALIDACIONES TERMINARON CORRECTAMENTE.
pause
exit /b 0

:run
echo.
echo ===== %~1 =====
pushd "%~1"
call %~2
if errorlevel 1 (popd & exit /b 1)
popd
exit /b 0

:failed
echo.
echo ALGUNA VALIDACION FALLO. Revisa el ultimo bloque mostrado.
pause
exit /b 1
