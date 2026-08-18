# Migraciones de base de datos

EF Core es la única fuente del esquema normal. Las migraciones residen en `backend/src/Elevant.Infrastructure/Persistence/Migrations`; la API nunca ejecuta `Migrate`, `EnsureCreated` ni seed al arrancar.

Development y Production aplican la misma cadena. Se separan por instancia, nombre, marcador, credenciales, volumen, datos y backups. Una migración no contiene DML de negocio; Production queda vacía salvo marcador e historial técnicos.

## Crear una migración

Desde la raíz:

```powershell
$env:ELEVANT_DATABASE_ENVIRONMENT = 'Development'
$env:ConnectionStrings__ElevantDatabase = 'Server=localhost;Initial Catalog=ElevantDevelopmentDb;Integrated Security=True;TrustServerCertificate=True'
./backend/scripts/add-migration.ps1 -Name V1_06_DescriptiveName
```

El script fuerza Development y comprueba que no quede drift. Después:

1. revisar `Up`, `Down`, designer y snapshot;
2. confirmar nombres, precisión, nullability, índices, foreign keys y ausencia de cascadas/DML;
3. generar SQL idempotente;
4. probar una base limpia y upgrade desde la última migración publicada;
5. probar que Production migra con cero filas de negocio;
6. documentar compatibilidad y recuperación.

No se edita `infra.__EFMigrationsHistory` a mano ni se reutiliza el nombre/ID de una migración publicada.

## Aplicación local administrada

Primero compile Release. Configure una cadena con credenciales de migración y el nombre exacto. Development:

```powershell
Push-Location backend
dotnet build Elevant.sln --configuration Release
$env:ConnectionStrings__ElevantDatabase = 'REPLACE_WITH_DEVELOPMENT_MIGRATOR_CONNECTION'
./scripts/update-database.ps1 -Environment Development
Pop-Location
```

Production requiere además `-AllowProduction` y escribir exactamente `MIGRATE ElevantProductionDb SCHEMA ONLY`. El script configura la segunda guarda, verifica nombre + marcador antes y después, y no ejecuta seed:

```powershell
./backend/scripts/update-database.ps1 -Environment Production -AllowProduction
```

Esto es una herramienta de administrador local. En Dokploy se usa la imagen `elevant-db-release` con bundle EF inmutable, no el SDK ni el checkout del repositorio.

## Bootstrap

- Development: `database/scripts/bootstrap/provision-development.sql`, ejecutado por `elevant-db-ops`.
- Production futura: `database/scripts/bootstrap/initialize-production.sql`, manual, con `sqlcmd -b -v CONFIRM_PRODUCTION_DATABASE=ElevantProductionDb`.

El bootstrap crea la base y su marcador antes de EF. No adopta silenciosamente una base existente sin marcador. El registro técnico de `database_instances` no es un seed de negocio.

## Release remoto Development

1. CI prueba migraciones contra SQL Server 2022 y construye el bundle.
2. CI ejecuta provisionamiento -> migración -> seed en una instancia efímera.
3. En un push válido a `Development`, publica imágenes GHCR con tag SHA.
4. El operador resuelve ese tag a digest y actualiza `ELEVANT_DB_RELEASE_IMAGE`.
5. Dokploy ejecuta `compose.development.release.yml`: migrator y luego seeder.
6. Solo tras ambos códigos cero se despliega/actualiza la API compatible.

La referencia mutable `:development` sirve para descubrimiento; Dokploy debe fijar `@sha256:...`.

## Cambios incompatibles

Use expand/contract:

1. agregar columnas/tablas compatibles;
2. desplegar código que tolere la forma anterior y nueva;
3. completar backfill con un job separado, reanudable y medible;
4. cambiar lecturas y verificar;
5. retirar estructuras antiguas en otro release.

Revertir una imagen no revierte el esquema. Nunca improvise un `Down` destructivo en una base compartida. Preserve backup y evidencia, detenga la promoción y siga el procedimiento de recuperación aprobado.
