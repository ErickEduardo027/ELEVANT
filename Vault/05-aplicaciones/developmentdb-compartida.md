---
id: aplicaciones-developmentdb-compartida
title: "DevelopmentDB como dependencia compartida"
type: architecture
area: database
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "pending"
sources:
  - Directory.Packages.props
  - database/AGENTS.md
  - database/DevelopmentDB/README.md
  - database/DevelopmentDB/Elevant.DatabaseTool/Program.cs
  - database/DevelopmentDB/Elevant.DatabaseTool/container-entrypoint.sh
  - database/DevelopmentDB/Elevant.Persistence/Elevant.Persistence.csproj
  - database/DevelopmentDB/Elevant.Persistence/Persistence/ElevantDbContext.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/DatabaseInstanceVerifier.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/OperationsConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Seed/DevelopmentDataSeeder.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20260817200402_V1_01_Platform.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20260817201128_V1_02_IdentityReference.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20260817201608_V1_03_WorkforceCommercial.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20260817202135_V1_04_Operations.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/20260817202420_V1_05_MobileAudit.cs
  - database/DevelopmentDB/compose.development.database.yml
  - backend/Elevant.Api/Elevant.Api.csproj
  - backend/Elevant.Api/HealthChecks/DatabaseReadinessHealthCheck.cs
  - backend/Elevant.Domain/Entities/Operations/OperationService.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/DatabaseModelTests.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/DatabaseTargetGuardTests.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/MigrationPolicyTests.cs
  - backend/tests/Elevant.IntegrationTests/Persistence/SqlServerMigrationTests.cs
  - docs/architecture/database-v1.md
  - docs/workflows/local-development.md
tags:
  - aplicaciones
  - database
  - developmentdb
  - ef-core
  - sql-server
---

# DevelopmentDB como dependencia compartida

`database/DevelopmentDB` es la fuente ejecutable del esquema, migraciones, seed sintético y operaciones de la base compartida de Development. No es una base embebida dentro del repositorio ni una dependencia directa de los clientes: `Elevant.Api` referencia Persistence y es la única puerta de aplicación hacia SQL Server.

## Ficha de frontera

| Dimensión | Estado verificado |
| --- | --- |
| Consumidor de aplicación | `Elevant.Api` mediante `Elevant.Persistence`. |
| Clientes directos | Ninguno; Private Web, Public Web y Mobile Agent no conectan a SQL. |
| Tecnología | EF Core 10 con proveedor SQL Server; SQL Server 2022 fijado en Compose. |
| Esquema vigente | Modelo v1 distribuido en `infra`, `iam`, `ref`, `hr`, `commercial`, `ops`, `integration` y `audit`. |
| Historia canónica | Cinco migraciones EF ordenadas y su model snapshot. |
| Datos Development | Seed sintético, determinista e idempotente; no es información de Production. |

## Qué vive aquí

| Ruta | Responsabilidad |
| --- | --- |
| `Elevant.Persistence/` | DbContext, Identity EF, mappings, convenciones, migraciones y seed. |
| `Elevant.DatabaseTool/` | El ejecutable .NET implementa `verify-target` y `seed-development`. Su entrypoint de contenedor despacha `migrate`: primero verifica el destino y después ejecuta el bundle EF. Son comandos one-shot fuera del request path. |
| `scripts/` | Creación/aplicación de migraciones, provisionamiento y utilidades SQL revisadas. |
| `tests/scripts/` | Pruebas del tooling, credenciales, manifests y acceso Development. |
| Compose del stack local | SQL → provisioner → migrator → seeder → API. |
| `compose.development.database.yml` | Modelo revisado del ciclo persistente/operaciones de Development. |
| `compose.development.release.yml` | Migrator y seeder one-shot de una release Development. |
| Dockerfiles | Imágenes separadas para operaciones y bundle de migración/release. |

Esta nota no reproduce la operación del VPS; los runbooks correspondientes pertenecen al área operativa.

## Cadena de migraciones v1

El commit verificado contiene, en orden:

1. `V1_01_Platform`;
2. `V1_02_IdentityReference`;
3. `V1_03_WorkforceCommercial`;
4. `V1_04_Operations`;
5. `V1_05_MobileAudit`.

Las migraciones son la historia del esquema. Los prototipos pueden sugerir una capacidad, pero no autorizan reescribir una migración aplicada ni agregar columnas desde SSMS. Un cambio estructural nuevo usa una migración aditiva revisada.

## Relación con las aplicaciones

| Aplicación | Relación correcta con DevelopmentDB |
| --- | --- |
| Private Web | Consume contratos HTTP; nunca tabla, connection string ni identidad SQL. |
| Public Web | Consume contratos HTTP tenant-scoped; nunca consulta SQL desde Next/browser. |
| Mobile Agent | Sincroniza mediante API; AsyncStorage es caché/outbox, no réplica autoritativa. |
| API | Ejecuta casos de uso con identidad SQL de aplicación y Persistence. |
| Herramienta de base | Verifica destino, aplica migración/seed u operación one-shot fuera del request path. |

El modelo incluye identidad, referencia, personal, contratos, operaciones, integración móvil, outbox y auditoría. Esto demuestra estructura persistente; no demuestra que existan endpoints o reglas completas para cada tabla.

## Invariantes relevantes para consumidores

- Development y la futura Production son bases físicas distintas que deben aplicar la misma cadena ordenada.
- El catálogo de Development tiene nombre exacto y marcador `infra.database_instances` validado por tooling/readiness.
- Claves internas usan `bigint identity`; agregados expuestos usan UUID; instantes son UTC `datetimeoffset(3)`; agregados mutables usan `rowversion` donde se configuró.
- Relaciones operativas, contractuales y de auditoría evitan cascade delete.
- El modelo ofrece un vínculo opcional a la tarifa y campos opcionales de snapshot de importe/moneda para preservar la condición comercial ejecutada. Exigir su presencia y coherencia todavía es una regla pendiente; no debe asumirse como invariante aplicada.
- KPIs, contadores y etiquetas derivadas son proyecciones, no tablas autoritativas por defecto.
- Binarios de evidencia no pertenecen a SQL; una capacidad futura conservará metadatos/object keys cuando exista object storage.

Consulta [Base de datos v1](../../docs/architecture/database-v1.md) para el modelo completo y [Dominio](../03-dominio/README.md) para significado, coherencias implementadas y brechas.

## Desarrollo local

Para levantar el stack completo desde la raíz:

```powershell
Copy-Item database/DevelopmentDB/.env.example database/DevelopmentDB/.env
# Sustituye todos los placeholders y conserva .env fuera de Git.
$localCompose = 'database/DevelopmentDB/compose' + '.' + 'local.yml'
docker compose --env-file database/DevelopmentDB/.env `
  -f $localCompose up --build
```

Para crear/aplicar migraciones solo en el flujo revisado:

```powershell
./database/DevelopmentDB/scripts/add-migration.ps1 -Name NombreAditivo
./database/DevelopmentDB/scripts/update-database.ps1 -Environment Development
```

Antes de aceptar una migración se inspeccionan operaciones/SQL, se prueba una base limpia y un upgrade desde el esquema anterior, y se ejecuta el pending-model check descrito en [API compartida](api-compartida.md).

## Pruebas y verificaciones

- `DatabaseModelTests` comprueba convenciones y estructura esperada del modelo EF.
- `DatabaseTargetGuardTests` verifica ambiente, catálogo y la confirmación explícita requerida para Production; no verifica el marcador persistido.
- `DatabaseInstanceVerifier` valida el marcador inmutable; `SqlServerMigrationTests` y readiness ejercitan esa verificación con SQL Server.
- `MigrationPolicyTests` protege reglas de migraciones.
- `SqlServerMigrationTests` prueba la cadena en SQL Server cuando está disponible.
- scripts de test verifican manifiestos, transporte seguro de contraseña y contrato de acceso humano Development.
- la solución .NET incluye tanto Persistence como DatabaseTool y se restaura con manifests bloqueados.

## Configuración y secretos

- `.env.example` declara nombres y placeholders; el `.env` real nunca se versiona.
- Hay identidades separadas para bootstrap/DBA, migración, aplicación, seed, health y backup.
- La API usa privilegio mínimo y nunca `sa` ni la identidad de migración.
- Las contraseñas llegan al tooling por variables protegidas; no se imprimen ni se pasan como argumentos visibles de `sqlcmd`.
- Compose y documentación no autorizan publicar SQL Server en Internet.

El acceso humano de Development es una frontera controlada y separada para manipular datos sintéticos; DDL, backups y administración continúan denegados. Lee el [contrato de acceso SQL](../../docs/security/database-access.md) antes de usarlo. No copies cuentas, endpoints ni contraseñas al Vault.

## Límites y brechas

- **Límite actual:** las aplicaciones no deben acoplarse a nombres de tabla ni entidades EF.
- **Límite actual:** una operación CRUD de datos Development no sustituye una migración para cambios estructurales.
- **Brecha de aplicación:** gran parte del modelo aún no tiene casos de uso ni endpoints públicos.
- **Brecha futura:** persistencia de archivos/evidencias requiere object storage y un contrato aprobado.
- **Desconocido:** qué partes del modelo v1 necesitarán ajustes al implementar los primeros vertical slices; se decidirá con pruebas y reglas, no desde fixtures.
- **Futuro explícito:** `database/ProductionDB` permanece reservado y no es una dependencia desplegada actual.

## Fuentes y relaciones

- [README de DevelopmentDB](../../database/DevelopmentDB/README.md)
- [DbContext actual](../../database/DevelopmentDB/Elevant.Persistence/Persistence/ElevantDbContext.cs)
- [API compartida](api-compartida.md)
- [Entidades y relaciones v1](../03-dominio/entidades-y-relaciones-v1.md)
- [Mapa de aplicaciones](README.md)
