# Etapa 12 — Bandeja de notificaciones para Contratos y Finanzas

## Cambios incluidos

- La campana de Contratos y Finanzas abre una bandeja real.
- Muestra hasta ocho avisos persistentes del departamento autenticado.
- Presenta título, descripción, origen y fecha en español dominicano.
- Permite marcar un aviso como leído.
- Permite marcar todos los avisos como leídos.
- Incluye estados de carga, vacío y error con reintento.
- El contador y la bandeja se actualizan juntos.
- OCC conserva su página completa de notificaciones.
- Se agregaron pruebas para la bandeja y sus acciones.

## Aplicar

Desde la raíz del repositorio:

```powershell
git status
git switch Feat/notificaciones-tiempo-real
git pull --ff-only origin Feat/notificaciones-tiempo-real
git switch -c Feat/bandeja-notificaciones

git apply --check "C:\ELEVANT-PARCHES\etapa-12-bandeja-notificaciones.patch"
git apply --index "C:\ELEVANT-PARCHES\etapa-12-bandeja-notificaciones.patch"
git diff --cached --check
```

## Validar

```powershell
cd backend-prototipo
npm test
cd ..

cd frontend\web
npm ci
npm test -- --run src/features/notifications/useNotificationBadge.test.js src/features/notifications/components/NotificationPopover.test.jsx src/features/dashboard/components/Topbar.test.jsx
npm run build
cd ..\..
```

## Confirmar y subir

```powershell
git commit -m "feat(web): agregar bandeja departamental de notificaciones"
git push -u origin HEAD
```

En GitHub compara:

- **base:** `Feat/notificaciones-tiempo-real`
- **compare:** `Feat/bandeja-notificaciones`

## Prueba manual

1. Crea una solicitud desde el portal público.
2. Entra a Contratos y pulsa la campana.
3. Comprueba que aparece la nueva solicitud.
4. Marca el aviso como leído y verifica que el contador disminuya.
5. Crea un contrato y entra a Finanzas.
6. Abre su campana y confirma que el aviso de contrato disponible pertenece a Finanzas.
