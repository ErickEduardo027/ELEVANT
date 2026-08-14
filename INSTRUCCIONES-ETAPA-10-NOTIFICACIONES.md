# Etapa 10 — Notificaciones integradas

## Qué incorpora

- Notificaciones persistentes en el archivo JSON del backend.
- Avisos automáticos por nueva solicitud, contrato creado, vuelo asignado, operación sincronizada y operación aprobada.
- Aislamiento por rol: cada departamento recibe únicamente sus avisos.
- Pantalla de Notificaciones de OCC conectada al backend real.
- Marcado individual como leído/no leído y marcado general como leído.
- Prueba de creación y lectura de una notificación persistente.

## Aplicar el parche

Ejecuta desde la raíz del repositorio:

```powershell
git status
git switch Feat/panel-desarrollo-ocultable
git pull --ff-only origin Feat/panel-desarrollo-ocultable
git switch -c Feat/backend-notificaciones
git apply --check "C:\ELEVANT-PARCHES\etapa-10-notificaciones.patch"
git apply --index "C:\ELEVANT-PARCHES\etapa-10-notificaciones.patch"
git diff --cached --check
```

## Probar

```powershell
cd backend-prototipo
npm test
cd ..
```

El resultado esperado es `12` pruebas aprobadas y `0` fallidas.

Si tienes instaladas las dependencias web:

```powershell
cd frontend\web
npm test -- --run src/services/notificationsService.test.js
npm run build
cd ..\..
```

## Confirmar y subir

```powershell
git commit -m "feat(prototipo): integrar notificaciones del flujo operativo"
git push -u origin HEAD
```

En GitHub compara:

- **base:** `Feat/panel-desarrollo-ocultable`
- **compare:** `Feat/backend-notificaciones`

## Prueba manual rápida

1. Inicia backend y web.
2. Desde el portal público crea una solicitud.
3. Entra como Contratos y verifica que la solicitud esté disponible.
4. Crea el contrato; el backend registra avisos para OCC y Finanzas.
5. Entra como OCC y abre **Notificaciones**: debe aparecer el nuevo contrato.
6. Marca el aviso como leído, recarga la página y confirma que conserva el estado.
