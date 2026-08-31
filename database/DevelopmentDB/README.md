# Elevant DevelopmentDB

Fuente ejecutable del esquema y operaciones de la base compartida de Development.

```text
Elevant.Persistence/              DbContext, mappings, migraciones y seed sintético
Elevant.DatabaseTool/             verificación y seed one-shot
Dockerfile.ops                    provisionamiento, backup y restore-check
Dockerfile.database-release       bundle EF y herramienta de release
compose.development.database.yml  SQL Server y volúmenes del VPS
compose.development.release.yml   migración y seed por release
compose.local.yml                 stack local completo con API
scripts/                          migraciones, SQL, contenedores y manifiesto CD
tests/scripts/                    pruebas del tooling y fixture de certificación
```

`ElevantDevelopmentDb` es la única base desplegada actualmente. Sus migraciones son la historia canónica del esquema. El seed es sintético, determinista e idempotente; nunca se ejecuta fuera de Development.

## Migraciones

Desde cualquier directorio:

```powershell
./database/DevelopmentDB/scripts/add-migration.ps1 -Name NombreAditivo
./database/DevelopmentDB/scripts/update-database.ps1 -Environment Development
```

Los scripts validan el destino y utilizan la solución `backend/Elevant.sln`. Production requiere un plan y confirmaciones independientes; `database/ProductionDB` permanece vacío.

## Operaciones y certificación

Los comandos del contenedor `Dockerfile.ops` son `initialize-backup-storage`, `provision-development`, `backup-development`, `restore-check-development` y `verify-development`. SQL Server y sus volúmenes tienen un ciclo de vida separado del API.

CI construye las imágenes desde la raíz del repositorio, las certifica contra un SQL Server aislado y publica únicamente referencias inmutables por digest. El fixture `tests/scripts/fixtures/initialize-production.sql` crea una base Production efímera solo durante esa certificación; no es un recurso desplegable ni autoriza Production.

Los dos Compose de Development se publican dentro del bundle OCI con los nombres estables `/compose/compose.development.database.yml` y `/compose/compose.development.release.yml`. Dokploy y el controlador CD siguen consumiendo ese contrato sin depender de la ubicación física del repositorio.
