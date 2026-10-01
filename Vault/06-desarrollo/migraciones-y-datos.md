---
id: desarrollo-migraciones-y-datos
title: "Migraciones y datos de Development"
type: guide
area: development
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "29600f562e82092b4341ff4c1696171037b51593"
sources:
  - AGENTS.md
  - backend/AGENTS.md
  - database/AGENTS.md
  - docs/architecture/database-v1.md
  - docs/workflows/local-development.md
  - docs/database/migrations.md
  - backend/README.md
  - .github/workflows/backend-ci.yml
  - database/DevelopmentDB/README.md
  - database/DevelopmentDB/.env.example
  - database/DevelopmentDB/Elevant.Persistence/Persistence/ElevantDbContextFactory.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/DatabaseTargetGuard.cs
  - database/DevelopmentDB/scripts/README.md
  - database/DevelopmentDB/scripts/add-migration.ps1
  - database/DevelopmentDB/scripts/update-database.ps1
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Seed/README.md
tags:
  - desarrollo
  - base-de-datos
  - migraciones
  - datos
---

# Migraciones y datos de Development

La base no es un archivo que se abre desde el repositorio. El repositorio
contiene el modelo, mappings, migraciones y herramientas; SQL Server ejecuta
esa historia y conserva los datos del ambiente. Local y Development comparten
el mismo diseño lógico, no las mismas credenciales ni los mismos datos.

## Propiedad de cada capa

| Necesidad | Mecanismo correcto |
| --- | --- |
| tabla, columna, FK, índice o constraint | EF Core mapping + migración revisada |
| creación física/identidades técnicas | scripts de plataforma versionados |
| anclas reproducibles del ambiente | seeder sintético de Development |
| datos de una prueba manual | hoy, login SQL individual aprobado en Development compartido; CRUD vía API cuando existan operaciones de negocio |
| corrección durable de datos | cambio explícito y revisado; no DML oculto en migración |

`backend` consume `Elevant.Persistence`, pero la historia EF vive bajo
`database/DevelopmentDB`. No crees otro DbContext por cliente.

La rama local añade una preparación opcional de escenario mediante
`seed-development-scenario`: el operador elige una fecha local PUJ y ejecuta
un comando separado del CD, sin compartir credenciales en el repositorio.
Inserta solo datos sintéticos de operaciones planificadas y turnos; se puede
repetir sin restablecer filas trabajadas y nunca se usa en Production. Los
prerrequisitos y límites están en el [README de DevelopmentDB](../../database/DevelopmentDB/README.md).

## Infraestructura local

Prepara una copia ignorada del ejemplo:

```powershell
Copy-Item database/DevelopmentDB/.env.example database/DevelopmentDB/.env
```

**Antes de `config` o `up`**, sustituye en esa copia todos los `REPLACE_ME` por
secretos locales únicos y conformes a las reglas del ejemplo; no reutilices
contraseñas de Development compartido. `config --quiet` valida el modelo y la
interpolación, pero no demuestra que las contraseñas sean seguras ni que los
marcadores se hayan reemplazado. Consulta el
[README de DevelopmentDB](../../database/DevelopmentDB/README.md).

Después valida sin volcar la configuración:

```powershell
$localCompose = Join-Path 'database/DevelopmentDB' `
  ('compose' + '.' + 'local.yml')

docker compose `
  --env-file database/DevelopmentDB/.env `
  -f $localCompose `
  config --quiet

docker compose `
  --env-file database/DevelopmentDB/.env `
  -f $localCompose `
  up --build
```

El orden esperado es bootstrap/SQL, provisioner, migrator, seeder de
Development y API. Las identidades tienen privilegios separados y el bootstrap
no debe convertirse en la identidad cotidiana de la aplicación.

## Crear una migración

Desde la raíz, prepara por separado la sesión de tooling EF. El `.env` pasado a
Docker Compose **no** se importa al PowerShell. Obtén desde tu almacén local
seguro una cadena de conexión para el **login migrator** del SQL local, con
catálogo `ElevantDevelopmentDb`; no uses el login de aplicación del ejemplo,
un servidor compartido ni una credencial real en el comando o en Git. Verifica
el destino local antes de continuar y no imprimas el valor:

```powershell
# Precondición: el almacén seguro ya asignó la cadena del migrator LOCAL
# a ConnectionStrings__ElevantDatabase en esta sesión.
$env:ELEVANT_DATABASE_ENVIRONMENT = 'Development'
if ([string]::IsNullOrWhiteSpace($env:ConnectionStrings__ElevantDatabase)) {
  throw 'Falta la conexión del migrator local en esta sesión.'
}
```

Los scripts [add-migration](../../database/DevelopmentDB/scripts/add-migration.ps1)
y [update-database](../../database/DevelopmentDB/scripts/update-database.ps1)
exigen esa variable y verifican el destino. Con el preflight satisfecho:

```powershell
./database/DevelopmentDB/scripts/add-migration.ps1 `
  -Name V1_06_NombreDescriptivo
```

El nombre debe seguir la secuencia del repositorio y describir el cambio.
Revisa los archivos generados **antes de aplicar** la migración:

- `Up`, `Down`, el `.Designer.cs` de la migración y
  `ElevantDbContextModelSnapshot.cs`;
- nombres de tablas, schemas, columnas, claves e índices;
- nulabilidad y defaults compatibles con filas existentes;
- ausencia de cascadas no aprobadas y DML de negocio;
- que no se reescribió una migración ya compartida;
- que el diff no contiene credenciales ni artefactos generados de ejecución.

Aplica solo al ambiente Development/local explícito:

```powershell
./database/DevelopmentDB/scripts/update-database.ps1 `
  -Environment Development
```

No ejecutes desde esta guía una variante de Production. `database/ProductionDB`
está reservado y debe permanecer vacío salvo `.gitkeep` hasta un plan aprobado.

## Verificación local del modelo

Después de restaurar y compilar, mantén en **esta misma sesión** las dos
variables del preflight anterior. La verificación EF usa su factory de diseño
y falla si falta el ambiente o la conexión, aunque Compose esté saludable:

```powershell
dotnet ef migrations has-pending-model-changes `
  --project database/DevelopmentDB/Elevant.Persistence `
  --startup-project backend/Elevant.Api `
  --context ElevantDbContext `
  --configuration Release `
  --no-build

python -m unittest discover `
  -s database/DevelopmentDB/tests/scripts `
  -p "test_*.py" `
  -v
```

El primer comando falla si el modelo y snapshot divergen. Las pruebas Python
cubren tooling; CI agrega SQL Server efímero, **genera** SQL idempotente
revisable y comprueba instalación limpia, upgrade, Compose e imágenes. Generar
ese archivo no demuestra por sí mismo que el script SQL se haya ejecutado.

## Datos: local, compartido y Production

### Local

- Es descartable y se puede reconstruir con migrator + seeder.
- Usa solo los secretos de `.env` local, nunca los de otro ambiente.
- El seed es sintético, determinista e idempotente; no copies PII de fixtures,
  navegadores, prototipos o backups.

### Development compartido

- Los desarrolladores con acceso individual pueden hacer CRUD de datos
  sintéticos para probar y ver el resultado compartido.
- Ese permiso no incluye DDL, backups, identidades, infraestructura ni cambios
  de schema. El schema siempre entra por migración y PR.
- Evita depender de una fila manual: una prueba automatizada crea y limpia su
  propio dato o usa anclas documentadas del seeder.
- No registres aquí nombres de usuario, contraseñas, direcciones privadas ni el
  procedimiento operativo para entrar al host.

### Production

No uses datos, secretos ni recursos de Production para desarrollar. Este
documento no autoriza ni describe una mutación allí.

## Cuando algo falla

No borres volúmenes, no reescribas la migración aceptada y no apliques SQL a
mano para “desbloquear” el modelo. Conserva el error, identifica si falló
bootstrap, migrator, seed o API, y sigue
[Depuración local](depuracion-local.md). Si el diseño es incompatible, vuelve a
la estrategia [expand/contract](cambio-seguro-por-tipo.md#cambio-coordinado-expandir-antes-de-contraer).
