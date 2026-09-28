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

Las migraciones `CommercialRepresentativeDetails` y `ContractRateConfirmation` agregan campos opcionales a solicitudes comerciales y una marca nullable de confirmación de tarifa. `NULL` conserva el significado de legado; los borradores nuevos empiezan sin confirmación y no pueden activarse hasta confirmar cada tarifa. Ninguna migración actualiza datos de negocio. El seed inserta las fichas iniciales de la lista histórica AVIAM con procedencia y verificaciones IATA disponibles; en bases existentes, el superadministrador usa la acción autorizada **Completar fichas AVIAM** para enriquecer sólo fixtures intactos. El diagnóstico `verify-development.sql` mantiene la lista exacta de IDs EF; una prueba compara esa lista con los archivos de migración antes de la certificación de contenedores.

## Migraciones

Las migraciones aditivas `PublicCommercialIntake`, `CommercialGovernance`,
`CommercialProvisioning` y `ContractDraftConversation` agregan catálogo público,
perfiles de aerolínea, solicitudes, roles personalizados, vinculación de cuenta
y observaciones de borrador. No incluyen datos de negocio. El seed de Development
requiere además `ELEVANT_DEV_SUPERADMIN_ACCOUNT_PASSWORD` para crear la cuenta
sintética de superadministrador; el valor no se guarda aquí. El flujo y sus
límites están en [solicitud comercial y gobernanza](../../docs/workflows/commercial-intake-and-governance.md).

`CommercialMediaAssets` crea la tabla de metadatos de archivos privados;
`PersonAvatarMedia` agrega el vínculo opcional de avatar en `iam.persons`.
No contienen datos de negocio ni BLOBs. El [almacén S3 privado](../../ops/dokploy/media-storage/README.md)
se instala como recurso independiente antes de la API que usa estos campos.

La consulta pública y la recepción de solicitudes comparten el mismo filtro de servicios activos y publicados. Un servicio interno no publicado no puede solicitarse mediante un UUID conocido. La admisión usa una transacción serializable entre la lectura de visibilidad y la escritura, para ordenar correctamente una retirada concurrente del catálogo. Esta regla no requiere una migración adicional.

La migración `AccountChangeFeed` de esta rama añade `infra.account_changes`
y concede a `elevant_app_role` permisos de objeto limitados para
escribir/procesar el outbox y leer/insertar pistas del feed.
`provision-development.sql` reproduce esos grants en una reprovisión y
`verify-development.sql` comprueba sus límites efectivos. Esta migración
no está desplegada hasta completar la certificación y la promoción controlada.

La migración aditiva `PreinvoiceDraft` de la rama de integración crea
`commercial.preinvoices` y `commercial.preinvoice_lines`. Cada línea guarda
cantidad, unidad, precio, moneda e importe congelados junto con la entrega
aprobada por OCC que la justifica. Índices únicos sobre `request_id` y
`operation_service_id` impiden solicitudes duplicadas y reservar dos veces
un servicio. Todas las FKs usan `NO ACTION`; la migración no carga datos de
negocio. Se prueba una base limpia y la actualización de una base con
operaciones previas. No se ha aplicado al VPS.

Desde cualquier directorio:

```powershell
./database/DevelopmentDB/scripts/add-migration.ps1 -Name NombreAditivo
./database/DevelopmentDB/scripts/update-database.ps1 -Environment Development
```

Los scripts validan el destino y utilizan la solución `backend/Elevant.sln`. Production requiere un plan y confirmaciones independientes; `database/ProductionDB` permanece vacío.

## Operaciones y certificación

Los comandos del contenedor `Dockerfile.ops` son `initialize-backup-storage`, `provision-development`, `provision-development-team-access`, `install-development-diagram-support`, `backup-development`, `restore-check-development` y `verify-development`. SQL Server y sus volúmenes tienen un ciclo de vida separado del API.

Los procesos `sqlcmd` reciben la credencial de autenticación mediante `SQLCMDPASSWORD`; nunca se pasa con `-P` ni se envían contraseñas como variables `-v`. Antes de cada invocación, los scripts dejan de exportar los nombres originales y sólo conservan en el proceso hijo las variables de entorno estrictamente necesarias; el provisionador añade sus variables de scripting aprobadas.

CI construye las imágenes desde la raíz del repositorio, las certifica contra un SQL Server aislado y publica únicamente referencias inmutables por digest. El fixture `tests/scripts/fixtures/initialize-production.sql` crea una base Production efímera solo durante esa certificación; no es un recurso desplegable ni autoriza Production.

Los dos Compose de Development se publican dentro del bundle OCI con los nombres estables `/compose/compose.development.database.yml` y `/compose/compose.development.release.yml`. Dokploy y el controlador CD siguen consumiendo ese contrato sin depender de la ubicación física del repositorio.

## Acceso humano de Development

`provision-development-team-access` crea o reconcilia los tres logins personales fijos
`elevant_dev_erick`, `elevant_dev_eliezer` y `elevant_dev_laisha`. Las contraseñas
llegan exclusivamente mediante las variables documentadas en
`.team-access.env.example`; el provisionador vuelve a aplicar el valor declarado para
permitir rotaciones idempotentes y nunca lo coloca en argumentos de `sqlcmd`.
Las tres claves personales deben contener mayúsculas, minúsculas, números y
caracteres especiales; los marcadores del archivo de ejemplo se rechazan. La clave
DBA existente solo autentica mediante `SQLCMDPASSWORD`: puede conservar su formato
actual siempre que no esté vacía ni sea un marcador y no se reutilice para una
cuenta personal. Si un DBA deshabilita un login
para retirar acceso, una reconciliación posterior conserva ese estado deshabilitado.
La reconciliación sustituye cada login dentro de una transacción, genera un SID nuevo
y remapea el usuario ya existente de `ElevantDevelopmentDb`. Así neutraliza cualquier
mapping accidental en otra base sin ampliar los permisos globales del DBA, mientras
conserva el `principal_id` local y la propiedad de los diagramas. Debe ejecutarse en
una ventana breve sin sesiones SSMS de esas cuentas: `DROP LOGIN` falla cerrado si
una de ellas sigue conectada y toda la reconciliación se revierte.
El mismo `DROP LOGIN` devuelve el error nativo 15141 si un administrador de instancia
hubiera hecho al login dueño de un server role que el DBA delegado no puede ver. El
provisionador lo traduce a un error estable y revierte; no se amplía al DBA con
`ALTER ANY SERVER ROLE`, `VIEW ANY DEFINITION` ni `CONTROL SERVER`.
Por esa visibilidad de metadatos, el verificador de solo lectura no puede descubrir
por sí solo un server role oculto creado después por un administrador de seguridad
del servidor. La auditoría autoritativa de ese caso es volver a ejecutar el one-shot:
el reemplazo falla cerrado con 51114 sin modificar logins ni usuarios.

La única membresía explícita de los tres usuarios es
`elevant_dev_team_editor`; como todo usuario, conservan el rol implícito
`public`. El rol editor hereda
`SELECT`, `INSERT`, `UPDATE` y `DELETE` para objetos presentes y futuros en `iam`,
`ref`, `hr`, `commercial`, `ops` e `integration`. Puede consultar `infra` y `audit`,
pero no modificarlos. Los permisos DDL, ejecución de procedimientos, backups y
administración de usuarios o roles quedan denegados. Por tanto, los datos sintéticos
pueden manipularse directamente desde SSMS, mientras cualquier cambio de tabla,
columna, índice, constraint o clave foránea continúa siendo una migración EF revisada.
Para evitar ampliar CRUD mediante ownership chaining o ejecución implícita, el
verificador rechaza views, sinónimos, funciones, agregados CLR, secuencias, triggers
y tablas externas dentro de esos seis esquemas. También rechaza cascadas
`ON DELETE`/`ON UPDATE` desde una tabla editable hacia `infra` o `audit`. Cualquiera
de esos objetos futuros requiere antes una decisión explícita y permisos revisados.
Una tabla system-versioned editable tampoco puede escribir su historial temporal en
`infra` o `audit`, porque un `UPDATE`/`DELETE` produciría una mutación protegida
implícita.

`install-development-diagram-support` es un segundo comando, deliberadamente
separado y ejecutado como `elevant_dev_dba`. Instala de manera idempotente el contrato
de objetos que SSMS usa para almacenar diagramas. El rol editor solo puede ejecutar
los procedimientos controlados para sus propios diagramas; no recibe acceso directo
a `dbo.sysdiagrams` ni capacidad para alterar las tablas representadas.
`dbo.sp_upgraddiagrams` permanece reservado al DBA porque solo forma parte del
bootstrap/upgrade del soporte, no de la edición cotidiana en SSMS.

Ambos comandos son one-shot. En el VPS se ejecutan desde la imagen `elevant-db-ops`
certificada por digest, conectada solamente a `elevant-dev-data`, y con un archivo
temporal `root:root 0600` suministrado mediante `docker run --env-file`. Ese archivo
debe eliminarse después de comprobar el acceso de las tres cuentas. No se añaden
servicios a los Compose certificados y no se autoriza exponer SQL Server a Internet.
