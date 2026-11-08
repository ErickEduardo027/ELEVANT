# Desarrollo local

## Requisitos

- SDK .NET indicado por `global.json`.
- Docker Desktop/Engine con Compose para el stack SQL local.
- PowerShell 5.1/7 y Git.
- Node.js compatible con cada frontend y npm.

Cada frontend conserva su propio `package-lock.json`; se instala desde su carpeta y no se asume pnpm/root workspace.

## Backend sin contenedores

```powershell
dotnet --info
dotnet tool restore
dotnet restore backend/Elevant.sln --locked-mode
dotnet build backend/Elevant.sln --configuration Release --no-restore
dotnet test backend/Elevant.sln --configuration Release --no-build
```

`backend/scripts/restore-build-test.ps1` encapsula la secuencia. `/health` comprueba proceso; `/health/ready` incluye dependencias y puede fallar sin SQL.

## Stack local completo

```powershell
Copy-Item database/DevelopmentDB/.env.example database/DevelopmentDB/.env
# Reemplazar todos los REPLACE_ME.
docker compose --env-file database/DevelopmentDB/.env -f database/DevelopmentDB/compose.local.yml up --build
```

El orden es SQL -> provisioner -> migrator -> seeder Development -> API. Las identidades SQL son distintas y `sa` queda deshabilitado después del bootstrap. Nunca reutilice esas contraseñas en el VPS o Production.

## Recorrido E2E del ciclo completo

Es opcional y ningún workflow de CI lo ejecuta. Recorre con Playwright el ciclo operativo completo contra este stack: cuatro proyectos encadenados, uno por fase (comercial, pre-operación, operación y facturación), que crean en cada corrida su propia aerolínea sintética ([ADR-0037](../adr/0037-commercial-cycle-requests-drafts-amendments-and-portal-accounts.md)). La configuración es `frontend/public-web/playwright.cycle.config.ts` y las pruebas viven en `frontend/public-web/tests/e2e-cycle/`.

Necesita:

- el stack con el overlay `compose.local.e2e.yml`, que suma almacenamiento S3 local (Garage, fijado por digest) para los PDF y las evidencias, el CORS de los puertos del arnés (`4174` y `4175`) y límites de uso altos. Sus claves `ELEVANT_LOCAL_*` se completan en el mismo `.env` (ver `.env.example`);
- el feed de vuelos simulado, que el mismo overlay activa con `SimulatedFlightFeed__Enabled` ([ADR-0038](../adr/0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md)): un horario determinista de las aerolíneas registradas que nunca llama a AeroDataBox ni a la red. La API se niega a arrancar si AeroDataBox también está activo en el `.env`, así que `ELEVANT_AERODATABOX_ENABLED` debe quedar en `false`. Con `ELEVANT_E2E_SIMULATED_FLIGHT_FEED=false` el overlay no activa el proveedor simulado, y el paso de la fase 2 que importa vuelos se salta;
- Mailpit en `http://127.0.0.1:8025`, que ya levanta `compose.local.yml`; el arnés lee ahí los enlaces y códigos del portal;
- Google Chrome instalado, porque el arnés usa el canal `chrome` de Playwright.

```powershell
docker compose --env-file database/DevelopmentDB/.env -f database/DevelopmentDB/compose.local.yml -f database/DevelopmentDB/compose.local.e2e.yml up --build
```

Desde `frontend/public-web`:

```powershell
$env:E2E_CYCLE_ENV_FILE = "<ruta del .env del stack>"
npm run test:e2e:cycle
```

El arnés levanta public-web en `localhost:4174` y private-web en `localhost:4175` y reenvía el nombre HTTPS de la API (HTTP y WebSocket de SignalR) a la API local (`E2E_CYCLE_API`, por defecto `http://127.0.0.1:8080`). Lee las credenciales sembradas del `.env` sin imprimirlas. El estado de la corrida y las capturas quedan fuera del repositorio, en la carpeta temporal del sistema. Con `E2E_CYCLE_HEADED=1` el recorrido se ve en el navegador, y `--project faseN --no-deps` reanuda una fase sobre la corrida en curso. Los huecos aún abiertos figuran como `test.fixme("hueco …")`: los de las fases 1, 2 y 3 ya son pruebas reales ([ADR-0039](../adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md)), y la fase 4 todavía tiene los pasos `fixme` 4-A y 4-B. Una corrida verde es evidencia local: no prueba CI ni un despliegue.

El recorrido corre entre las 08:30 y las 22:30 de la hora local: la fase 2 elige la plantilla de turno del agente sintético que cubre el vuelo de la corrida y falla con ese aviso fuera de esa franja. En la fase 3, los pasos que necesitan otra ventana libre en el turno de ese día se saltan con su motivo cuando ya no queda, y el paso que reabre la aprobación (3-H) se salta si la operación del ciclo ya está en una prefactura.

El proveedor simulado está pensado para este recorrido local: está apagado por defecto, solo este overlay lo activa y la API lo rechaza fuera de los entornos `Development` o `Test`. La plantilla del VPS Development (`backend/compose.development.api.yml`) no lo define, así que allí el feed sigue siendo AeroDataBox.

## Frontends

Entre a `frontend/private-web`, `frontend/public-web` o `frontend/mobile-agent`, lea su README y ejecute solo los scripts declarados en su `package.json`. Una tablet no puede alcanzar el `localhost` de la PC; use una URL de red autorizada/Tailscale según el ambiente.

## Cierre de sesión

- ejecutar pruebas/build enfocados;
- revisar `git diff` y `git status`;
- actualizar docs si cambió un contrato;
- no incluir `.env`, secrets, `bin`, `obj`, `.next`, `node_modules`, bases, backups, artefactos de firma o resultados runtime.
