# Backend de ELEVANT

Backend compartido por AVIAM Web, Public Web y Mobile Agent. Contiene la solución .NET 10, el dominio, EF Core/SQL Server, migraciones, pruebas, imágenes de base de datos y artefactos para Dokploy. Ningún cliente accede a SQL Server o proveedores externos de forma directa.

## Estructura

```text
src/Elevant.Domain          entidades y reglas sin dependencias de framework
src/Elevant.Application     casos de uso y puertos
src/Elevant.Contracts       contratos públicos de la API
src/Elevant.Infrastructure  EF Core, SQL Server e integraciones
src/Elevant.Api             host HTTP y composition root
src/Elevant.DatabaseTool    verificación y seed one-shot
tests/                       unitarias, arquitectura e integración SQL real
database/                    bootstrap, backup y restore-check
infrastructure/docker/       Compose local y deployables Development
```

La API no migra ni siembra al arrancar. `Elevant.DatabaseTool` y el bundle EF de `Dockerfile.database-release` son tareas separadas de despliegue.

## Base v1

El modelo implementado se distribuye entre `infra`, `iam`, `ref`, `hr`, `commercial`, `ops`, `integration` y `audit`. Usa claves internas `bigint`, UUID públicos, fechas UTC, `rowversion`, relaciones sin cascade delete e historiales append-only. Consulte:

- `docs/architecture/database-v1.md`
- `docs/database/schema-v1.md`
- `docs/database/migrations.md`

`ElevantDevelopmentDb` y `ElevantProductionDb` aplican exactamente las mismas migraciones. Solo Development admite `seed-development`, con datos sintéticos e idempotentes. Production no tiene comando de seed y sus pruebas comprueban cero filas de negocio tras migrar.

## Validación

Ejecutar desde `backend`:

```powershell
dotnet tool restore
dotnet restore Elevant.sln --locked-mode
dotnet build Elevant.sln --configuration Release --no-restore
dotnet test Elevant.sln --configuration Release --no-build
```

Para comprobar drift del modelo:

```powershell
$env:ELEVANT_DATABASE_ENVIRONMENT = 'Development'
$env:ConnectionStrings__ElevantDatabase = 'Server=localhost;Initial Catalog=ElevantDevelopmentDb;Integrated Security=True;TrustServerCertificate=True'
dotnet ef migrations has-pending-model-changes --project src/Elevant.Infrastructure --startup-project src/Elevant.Api --context ElevantDbContext --configuration Release --no-build
```

Las pruebas de SQL usan `ELEVANT_TEST_SQLSERVER_MASTER`. Si no está definida, intentan LocalDB en Windows; CI siempre usa el contenedor SQL Server 2022 fijado por digest.

## Entorno local completo

```powershell
Copy-Item .env.example .env
# Sustituir todos los placeholders y mantener .env fuera de Git.
docker compose --env-file .env -f infrastructure/docker/compose.local.yml up --build
```

El flujo es `SQL -> provisioner -> migrator -> seeder-development -> API`. El bootstrap crea identidades separadas para DBA, migración, API, seed, health y backup; después deshabilita `sa`. Para recrear datos locales sintéticos se elimina únicamente el volumen local mediante un procedimiento consciente; jamás se reutiliza ese patrón en un ambiente compartido.

## Dokploy

Los artefactos remotos son:

- `database/Dockerfile.ops`: provisionamiento, backup y verificación de restore.
- `Dockerfile.database-release`: herramienta de verificación, bundle EF y seed de Development.
- `infrastructure/docker/compose.development.database.yml`: SQL/volúmenes, ciclo manual.
- `infrastructure/docker/compose.development.release.yml`: migración + seed, ciclo por release.

CI construye y ejecuta ambas imágenes contra SQL Server antes de publicarlas en GHCR tras un push válido a `Development`. Dokploy debe consumir referencias con digest. No se construye en el VPS y ningún pipeline de esta rama despliega por sí solo.

## Alcance actual de la API

El esquema y las herramientas de persistencia están listos. Los endpoints/casos de uso de autenticación, vuelos, contratos, operación, facturación y sincronización móvil aún deben implementarse como vertical slices con contratos OpenAPI; no se deben conectar las pantallas a entidades EF directamente.
