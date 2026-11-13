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

- el stack con el overlay `compose.local.e2e.yml`, que suma almacenamiento S3 local (Garage, fijado por digest) para los PDF y las evidencias, el CORS de los puertos del arnés (`4174` y `4175`) y límites de uso altos. Sus claves `ELEVANT_LOCAL_*` se completan en el mismo `.env` (ver `.env.example`). El overlay también fija `CardPayments__Mode=Simulated`, la pasarela simulada con la que la fase 4 paga en el portal: aprueba o rechaza en memoria las tarjetas de prueba, sin red ([ADR-0040](../adr/0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md));
- el feed de vuelos simulado, que el mismo overlay activa con `SimulatedFlightFeed__Enabled` ([ADR-0038](../adr/0038-preoperation-contract-lifecycle-permits-master-data-and-workforce-readiness.md)): un horario determinista de las aerolíneas registradas que nunca llama a AeroDataBox ni a la red. La API se niega a arrancar si AeroDataBox también está activo en el `.env`, así que `ELEVANT_AERODATABOX_ENABLED` debe quedar en `false`. Con `ELEVANT_E2E_SIMULATED_FLIGHT_FEED=false` el overlay no activa el proveedor simulado, y el paso de la fase 2 que importa vuelos se salta;
- Mailpit en `http://127.0.0.1:8025`, que ya levanta `compose.local.yml`; el arnés lee ahí los enlaces y códigos del portal y, en la fase 4, el correo de la nota de crédito con su PDF;
- Google Chrome instalado, porque el arnés usa el canal `chrome` de Playwright.

```powershell
docker compose --env-file database/DevelopmentDB/.env -f database/DevelopmentDB/compose.local.yml -f database/DevelopmentDB/compose.local.e2e.yml up --build
```

Desde `frontend/public-web`:

```powershell
$env:E2E_CYCLE_ENV_FILE = "<ruta del .env del stack>"
npm run test:e2e:cycle
```

El arnés levanta public-web en `localhost:4174` y private-web en `localhost:4175` y reenvía el nombre HTTPS de la API (HTTP y WebSocket de SignalR) a la API local (`E2E_CYCLE_API`, por defecto `http://127.0.0.1:8080`). Lee las credenciales sembradas del `.env` sin imprimirlas. El estado de la corrida y las capturas quedan fuera del repositorio, en la carpeta temporal del sistema. Con `E2E_CYCLE_HEADED=1` el recorrido se ve en el navegador, y `--project faseN --no-deps` reanuda una fase sobre la corrida en curso. Ya no queda ningún `test.fixme("hueco …")`: los huecos de las cuatro fases son pruebas reales ([ADR-0039](../adr/0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md) y [ADR-0040](../adr/0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md)). En la fase 4, el paso del charter se salta mientras la corrida de la fase 3 no deje un charter facturado (las pruebas SQL cubren ese caso), el del estado de cuenta del portal se salta si la corrida no emitió su nota de crédito, y el último paso comprueba sin navegador que cada operación que cita el mapa de capacidades del Vault existe en el snapshot de OpenAPI y que ninguna nota vigente describe la API como vacía ni da por inexistentes la autenticación, las rutas de negocio, el tiempo real o el almacenamiento privado. Una corrida verde es evidencia local: no prueba CI ni un despliegue.

El recorrido corre entre las 08:30 y las 22:30 de la hora local: la fase 2 elige la plantilla de turno del agente sintético que cubre el vuelo de la corrida y falla con ese aviso fuera de esa franja. En la fase 3, los pasos que necesitan otro vuelo en el turno de ese día se saltan con su motivo cuando ya no queda un número de vuelo libre o una ventana libre; 3-D se salta si el agente ya lleva tres operaciones en la ventana del vuelo aprobado y 3-E si su turno empieza demasiado temprano para un vuelo previo el mismo día, y el paso que reabre la aprobación (3-H) se salta si la operación del ciclo ya no figura en «Por facturar», porque ya se facturó, o si la retiene un borrador con factura emitida (`pending_preinvoice`): su corrección es una nota de crédito.

El proveedor simulado está pensado para este recorrido local: está apagado por defecto, solo este overlay lo activa y la API lo rechaza fuera de los entornos `Development` o `Test`. La plantilla del VPS Development (`backend/compose.development.api.yml`) no lo define, así que allí el feed sigue siendo AeroDataBox.

La pasarela de tarjeta simulada también está apagada por defecto (`CardPayments:Mode=Disabled`): la encienden `appsettings.Development.json` y este overlay, y la API se niega a arrancar con ella fuera de los entornos `Development`, `Test` o `Testing`. La plantilla del VPS Development fija `ASPNETCORE_ENVIRONMENT=Development`, así que allí la tarjeta también usa la simulación ([ADR-0040](../adr/0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md)).

Los vuelos demo de Superadministración ([ADR-0041](../adr/0041-demo-flights-and-punta-cana-stands.md)) también están apagados por defecto (`DemoFlights:Mode=Disabled`): los enciende `appsettings.Development.json` y la API se niega a arrancar con ellos fuera de los entornos `Development`, `Test` o `Testing`. Como `compose.local.yml` y la plantilla del VPS Development ejecutan la API como `Development`, el overlay no necesita ninguna variable y en el VPS quedan encendidos al desplegar la API que los trae. El arnés tiene para ellos un quinto proyecto, `demo` (`tests/e2e-cycle/demo-vuelo.spec.ts`), que no depende de las fases: usa la aerolínea sembrada «Demo Airlines» con su contrato y el agente sembrado. Carga las posiciones de Punta Cana, programa o amplía el turno del día del agente para que cubra la hora actual, le da una cobertura de una posición libre de la Terminal A (liberando antes las que el agente tenga ese día) y dispara el vuelo «Al azar», así que el servidor lo envía a esa posición; al final libera esa cobertura. Corre con el resto en `npm run test:e2e:cycle` o aparte con `npx playwright test --config playwright.cycle.config.ts --project=demo`, en la misma franja de 08:30 a 22:30, y tarda unos 10 minutos porque espera el aterrizaje y el despegue que marca la API. Antes de empezar termina los vuelos demo activos que nadie importó, como los que deja un intento fallido; se salta si la API los tiene apagados o si la estación ya tiene tres vuelos demo activos que OCC importó. Ni este recorrido ni una demostración pulsan «Actualizar ahora» en «Importar vuelos»: un vuelo demo no necesita una lectura del proveedor, y en el VPS esa lectura gasta unidades de AeroDataBox.

## Frontends

Entre a `frontend/private-web`, `frontend/public-web` o `frontend/mobile-agent`, lea su README y ejecute solo los scripts declarados en su `package.json`. Una tablet no puede alcanzar el `localhost` de la PC; use una URL de red autorizada/Tailscale según el ambiente.

## Cierre de sesión

- ejecutar pruebas/build enfocados;
- revisar `git diff` y `git status`;
- actualizar docs si cambió un contrato;
- no incluir `.env`, secrets, `bin`, `obj`, `.next`, `node_modules`, bases, backups, artefactos de firma o resultados runtime.
