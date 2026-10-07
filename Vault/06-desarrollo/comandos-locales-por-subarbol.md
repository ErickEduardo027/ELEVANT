---
id: desarrollo-comandos-locales-subarbol
title: "Comandos locales por subárbol"
type: reference
area: development
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "29600f562e82092b4341ff4c1696171037b51593"
sources:
  - package.json
  - backend/README.md
  - backend/scripts/restore-build-test.ps1
  - database/DevelopmentDB/README.md
  - database/DevelopmentDB/Elevant.Persistence/Persistence/ElevantDbContextFactory.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/DatabaseTargetGuard.cs
  - database/DevelopmentDB/scripts/add-migration.ps1
  - database/DevelopmentDB/scripts/update-database.ps1
  - frontend/private-web/README.md
  - frontend/private-web/package.json
  - frontend/public-web/README.md
  - frontend/public-web/package.json
  - frontend/public-web/scripts/validate-development-env.mjs
  - frontend/mobile-agent/README.md
  - frontend/mobile-agent/package.json
  - packages/api-client/README.md
  - packages/api-client/package.json
tags:
  - desarrollo
  - comandos
  - pruebas
  - build
---

# Comandos locales por subárbol

Ejecuta cada bloque desde la ubicación indicada. `npm ci` es la instalación
reproducible usada por los workflows; no mezcles lockfiles entre aplicaciones.

## Root y Vault

Desde la raíz:

```powershell
npm ci
npm run check
npm run vault:ci
git diff --check
```

`npm run check` busca secretos; no compila las aplicaciones. `vault:ci` prueba
y valida el Vault sin regenerarlo. Si cambió el inventario del Vault, la persona
responsable del artefacto generado ejecuta `npm run vault:generate`, revisa el
diff y repite `npm run vault:ci`.

## Backend y persistencia .NET

Desde la raíz, forma expandida:

```powershell
dotnet tool restore
dotnet restore backend/Elevant.sln --locked-mode
dotnet build backend/Elevant.sln --configuration Release --no-restore
dotnet test backend/Elevant.sln --configuration Release --no-build
```

Para el check EF siguiente, carga **fuera del repositorio** en la sesión una
cadena de conexión de **migrator local** a `ElevantDevelopmentDb`; comprueba
que el servidor es tu SQL local y no el ambiente compartido. El `--env-file`
de Docker Compose no exporta variables al PowerShell. Este preflight no
imprime la cadena ni sustituye la guarda del tooling:

```powershell
$env:ELEVANT_DATABASE_ENVIRONMENT = 'Development'
if ([string]::IsNullOrWhiteSpace($env:ConnectionStrings__ElevantDatabase)) {
  throw 'Falta la conexión del migrator local en esta sesión.'
}
dotnet ef migrations has-pending-model-changes `
  --project database/DevelopmentDB/Elevant.Persistence `
  --startup-project backend/Elevant.Api `
  --context ElevantDbContext `
  --configuration Release `
  --no-build
```

El wrapper ejecuta restore, build y tests, y escribe TRX en
`backend/TestResults`:

```powershell
./backend/scripts/restore-build-test.ps1 -Configuration Release
```

El wrapper no incluye el check de modelo EF; ejecútalo aparte cuando toques
Domain/Persistence o antes del handoff completo del backend.

## Cliente TypeScript compartido

Desde `packages/api-client`:

```powershell
npm ci
npm run check
```

`check` comprueba salida generada, TypeScript y tests. Después de actualizar el
snapshot OpenAPI por el proceso aprobado:

```powershell
npm run generate
npm run check
```

Para comparar sin escribir archivos:

```powershell
npm run check:openapi -- ./ruta/al/swagger-temporal.json
npm run check:openapi -- http://127.0.0.1:8080/swagger/v1/swagger.json
```

## Private Web

Desde `frontend/private-web`:

```powershell
npm ci
npm run test:delivery
npm test
npm run lint
npm run typecheck
$env:NEXT_PUBLIC_ELEVANT_API_URL = "https://api.elevant.test"
$env:NEXT_PUBLIC_PROTOTYPE_API_URL = $env:NEXT_PUBLIC_ELEVANT_API_URL
$env:NEXT_PUBLIC_HR_DEMO_MODE = "dashboard-read-only"
npm run build
npm run dev -- -p 5173
```

El build ejecuta `validate:development-env`: exige los dos orígenes HTTPS DNS,
sin ruta ni slash final, idénticos y no loopback, además del modo de
demostración de Gestión Humana. El puerto 5173 evita chocar con Public Web en
el 3000 y es uno de los orígenes locales permitidos por CORS en la API.

Para una prueba Vitest enfocada:

```powershell
npm test -- tests/elevantApiClient.smoke.test.js
```

## Public Web

Desde `frontend/public-web`:

```powershell
npm ci
$env:NEXT_PUBLIC_SITE_URL = "http://localhost:3000"
$env:NEXT_PUBLIC_DEMO_FORM_MODE = "preview"
$env:NEXT_PUBLIC_ELEVANT_API_URL = "https://api.elevant.test"
$env:NEXT_PUBLIC_PROTOTYPE_API_URL = $env:NEXT_PUBLIC_ELEVANT_API_URL
npm run lint
npm run typecheck
npm test
npm run build
npm run dev
```

`typecheck` ejecuta primero `next typegen`. Para recorridos de navegador:

```powershell
npm run test:e2e
```

Ese último comando requiere que los navegadores de Playwright ya estén
instalados. Antes de modificar APIs o convenciones de Next, lee la documentación
de la versión instalada bajo el `node_modules` de esta aplicación.

Este bloque es el build **local**. `npm run build` de Public Web no ejecuta
`validate:development-env`. Ese validador corresponde a una imagen de
Development y exige metadatos de procedencia completos y orígenes HTTPS DNS;
el ejemplo `http://localhost:3000` sirve para desarrollo local, no para ese
gate. CI suministra la configuración de release; no inventes metadatos ni
copies valores privados para hacerlo pasar. Consulta el
[README de Public Web](../../frontend/public-web/README.md).

## Mobile Agent

Desde `frontend/mobile-agent`:

```powershell
npm ci
npm run lint
npm run typecheck
npm run test:api-client-bundle
npm run start
```

También existen `npm run android`, `npm run ios` y `npm run web`. El manifiesto
actual no declara un script de tests unitarios general: lint, typecheck y el
smoke de bundling Metro son la validación automatizada disponible en esa capa.
Una tablet no alcanza el `localhost` de la computadora; configura una URL de
prueba alcanzable y autorizada sin incorporarla al repositorio.

## Base de datos

Crear una migración exige una conexión local de migrator ya configurada en la
variable de proceso, cuyo valor no debe imprimirse:

```powershell
./database/DevelopmentDB/scripts/add-migration.ps1 `
  -Name V1_06_DescriptiveName
```

Aplicar únicamente a una base Development local validada:

```powershell
./database/DevelopmentDB/scripts/update-database.ps1 `
  -Environment Development
```

Para los tests Python del tooling de base, usa la variante que corresponda a tu
instalación de Python 3:

```powershell
python -m unittest discover `
  -s database/DevelopmentDB/tests/scripts `
  -p "test_*.py" -v
```

No ejecutes la variante Production, no renombres migraciones ya publicadas y no
uses comandos manuales de reset. El flujo completo está en
[Migraciones y datos](migraciones-y-datos.md).

## Selección mínima

| Cambio | Bloques mínimos antes del PR |
| --- | --- |
| Backend sin modelo | Backend + secret scan |
| Modelo/EF | Backend + pending-model + revisión de migración |
| Contrato HTTP | Backend + API client + consumidores afectados |
| Private/Public/Mobile | bloque del cliente + API client si cambia su seam |
| Vault | Root/Vault + diff generado coordinado |

La matriz completa y lo que CI añade están en
[Pruebas, calidad y frontera con CI](pruebas-calidad-y-frontera-ci.md).
