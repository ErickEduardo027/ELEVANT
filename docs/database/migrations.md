# Migraciones de base de datos

EF Core es la única fuente del esquema normal. Las migraciones residen en `database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations`; la API nunca ejecuta `Migrate`, `EnsureCreated` ni seed al arrancar.

Esta rama suma `PublicCommercialIntake`, `CommercialGovernance`,
`CommercialProvisioning` y `ContractDraftConversation`: columnas y tablas
aditivas para el [flujo comercial](../workflows/commercial-intake-and-governance.md).
El seed sintético de Development es un paso separado; las migraciones no
insertan servicios, aerolíneas ni cuentas.

`AddContractSigningEnvelope` conserva los contratos existentes con firma no
requerida. `AddRequestPackagesAndRecordedAcceptance` añade selecciones de
paquete por solicitud, unicidad filtrada de contrato por solicitud de origen y
campos de método, snapshot, actor, hash, UUID y fecha de aceptación al
expediente. Se generó con `scripts/add-migration.ps1` y pasó
`has-pending-model-changes`; no se aplicó a una base de datos en esta tarea.

`AddServiceClosureRequests` agrega `commercial.service_closure_requests` de forma
aditiva: expediente, actor solicitante y decisor, motivos, instantes, UUID,
`rowversion` e índice único filtrado para una sola petición pendiente por
servicio. Las cuatro FKs son `NO ACTION`; los checks SQL exigen coherencia de
decisión y reapertura. No cambia tablas contractuales ni inserta datos. El seed
de Development crea únicamente las definiciones y grants de permisos OCC y
Contratos ausentes. La API compatible debe publicarse después de aplicar la
migración; una imagen anterior tolera la tabla adicional.

`CommercialMediaAssets` agrega metadatos y claves de objetos en
`commercial.media_assets` con FK al actor que subió el archivo.
`PersonAvatarMedia` agrega una referencia nullable en `iam.persons`.
Ambas son aditivas y no mueven bytes ni actualizan filas existentes. Los bytes
requieren el [almacén privado](../../ops/dokploy/media-storage/README.md),
instalado y respaldado antes de promover la API que permita subir archivos.

Development y Production aplican la misma cadena. Se separan por instancia, nombre, marcador, credenciales, volumen, datos y backups. Una migración no contiene DML de negocio; Production queda vacía salvo marcador e historial técnicos.

## Crear una migración

Desde la raíz:

```powershell
$env:ELEVANT_DATABASE_ENVIRONMENT = 'Development'
$env:ConnectionStrings__ElevantDatabase = 'Server=localhost;Initial Catalog=ElevantDevelopmentDb;Integrated Security=True;TrustServerCertificate=True'
./database/DevelopmentDB/scripts/add-migration.ps1 -Name V1_08_DescriptiveName
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
dotnet build backend/Elevant.sln --configuration Release
$env:ConnectionStrings__ElevantDatabase = 'REPLACE_WITH_DEVELOPMENT_MIGRATOR_CONNECTION'
./database/DevelopmentDB/scripts/update-database.ps1 -Environment Development
```

Production requiere además `-AllowProduction` y escribir exactamente `MIGRATE ElevantProductionDb SCHEMA ONLY`. El script configura la segunda guarda, verifica nombre + marcador antes y después, y no ejecuta seed:

```powershell
./database/DevelopmentDB/scripts/update-database.ps1 -Environment Production -AllowProduction
```

Esto es una herramienta de administrador local. En Dokploy se usa la imagen `elevant-db-release` con bundle EF inmutable, no el SDK ni el checkout del repositorio.

## Bootstrap

- Development: `database/DevelopmentDB/scripts/bootstrap/provision-development.sql`, ejecutado por `elevant-db-ops`.
- Production futura: no tiene bootstrap desplegable todavía. `database/ProductionDB` permanece vacío hasta aprobar su diseño.

El bootstrap de Development crea la base y su marcador antes de EF. No adopta silenciosamente una base existente sin marcador. El registro técnico de `database_instances` no es un seed de negocio. El SQL de `DevelopmentDB/tests/scripts/fixtures` se usa únicamente en certificación efímera y no autoriza Production.

## Release remoto Development

1. CI prueba migraciones contra SQL Server 2022 y construye el bundle.
2. CI ejecuta provisionamiento -> migración -> seed en una instancia efímera.
3. En un push DB-owned válido a `Development`, publica ambas imágenes GHCR y
   registra referencias inmutables por digest.
4. CI genera y valida un manifiesto de entrega con esos digests, hashes de
   Compose y fingerprints de cadena de migraciones/modelo/seed, y crea el bundle
   OCI v1 con ese JSON y los dos Compose exactos.
5. CI extrae y compara los tres payloads. Solo después de publicar todo lo
   anterior mueve el alias OCI
   `development-certified`; el alias es descubrimiento, no identidad de
   ejecución.
6. El controlador privado resuelve el digest del bundle, valida sus labels,
   manifiesto y hashes, cachea ambos Compose y exige equivalencia semántica con
   los Raw vivos. Bajo lock exclusivo ejecuta backup -> migrator -> seeder ->
   verify -> backup -> restore-check usando solo imágenes `@sha256:` y Compose
   certificados.
7. Solo tras todos los códigos cero registra la entrega como aceptada. La futura
   API compatible puede desplegarse después por su carril independiente.

Las referencias mutables `:development` y `:development-certified` sirven para
descubrimiento. Los contenedores ejecutados siempre quedan fijados a
`@sha256:...`; sus definiciones Compose se cargan desde el cache content-addressed
de la entrega aceptada, no desde un tag ni desde el Raw vivo.

Un fallo queda bloqueado y no se reintenta por polling. Corrija el código y
publique otro bundle o use el retry manual explícito solo después de
resolver una causa externa. No haga retry editando la base.

## Cambios incompatibles

Use expand/contract:

1. agregar columnas/tablas compatibles;
2. desplegar código que tolere la forma anterior y nueva;
3. completar backfill con un job separado, reanudable y medible;
4. cambiar lecturas y verificar;
5. retirar estructuras antiguas en otro release.

Revertir una imagen no revierte el esquema. Nunca improvise un `Down` destructivo en una base compartida. Preserve backup y evidencia, detenga la promoción y siga el procedimiento de recuperación aprobado.
