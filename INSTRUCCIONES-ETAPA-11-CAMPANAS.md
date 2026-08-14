# Etapa 11 — Campanas departamentales actualizadas automáticamente

## Cambios incluidos

- La campana de OCC, Contratos, Finanzas y Gestión Humana consulta el backend real.
- El contador muestra únicamente notificaciones pendientes de lectura del usuario autenticado.
- Actualización automática cada 15 segundos.
- Actualización al regresar a la pestaña o enfocar nuevamente la ventana.
- Actualización inmediata después de marcar una notificación como leída o no leída.
- Si el backend no responde, se conserva el último contador válido y la interfaz no se bloquea.
- Pruebas unitarias del nuevo hook de actualización.

## Aplicar

Desde la raíz del repositorio:

```powershell
git status
git switch Feat/backend-notificaciones
git pull --ff-only origin Feat/backend-notificaciones
git switch -c Feat/notificaciones-tiempo-real

git apply --check "C:\ELEVANT-PARCHES\etapa-11-campanas.patch"
git apply --index "C:\ELEVANT-PARCHES\etapa-11-campanas.patch"
git diff --cached --check
```

## Validar

```powershell
cd backend-prototipo
npm test
cd ..

cd frontend\web
npm ci
npm test -- --run src/features/notifications/useNotificationBadge.test.js src/services/notificationsService.test.js
npm run build
cd ..\..
```

## Confirmar y subir

```powershell
git commit -m "feat(web): actualizar campanas departamentales automáticamente"
git push -u origin HEAD
```

En GitHub compara:

- **base:** `Feat/backend-notificaciones`
- **compare:** `Feat/notificaciones-tiempo-real`

## Prueba manual

1. Inicia backend y web.
2. Crea una solicitud desde el portal público.
3. Entra como Contratos: la campana debe mostrar un aviso pendiente.
4. Crea un contrato.
5. Entra como OCC y luego como Finanzas: cada sesión debe ver su aviso correspondiente.
6. En OCC abre Notificaciones y marca el aviso como leído; el contador debe disminuir sin recargar toda la aplicación.
