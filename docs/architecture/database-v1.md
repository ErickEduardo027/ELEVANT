# Base de datos ELEVANT v1

Estado del esquema: implementado y versionado en `Development`; la cadena v1
fue aceptada mediante la operación controlada de Development. Esto no significa
que las capacidades de negocio representadas por todas sus tablas ya tengan
handlers o endpoints. Production permanece como frontera futura separada.

## Límite del producto

ELEVANT posee tres clientes y una sola fuente de verdad por ambiente. La última
columna expresa la **regla de diseño**, no permisos de aplicación ya efectivos:

| Cliente | Audiencia | Frontera de datos |
| --- | --- | --- |
| `frontend/private-web` | Equipos internos AVIAM | Acceso entre aerolíneas solo con rol y scope de estación explícitos |
| `frontend/public-web` | Clientes/aerolíneas | Tenant derivado por la API desde la membresía autenticada |
| `frontend/mobile-agent` | Agentes de rampa | Agente/estación derivados por la API; comandos offline idempotentes |

Ningún cliente se conecta a SQL Server. Cuando se habilite Production, su base,
VPS, credenciales y volúmenes serán independientes de Development; aplicará la
misma secuencia ordenada de migraciones, pero no recibirá fixtures sintéticos.

## Decisiones derivadas de los frontends

- `turnaround` representa una escala aeroportuaria. Puede tener como máximo un tramo de llegada y uno de salida, con STA/ETA/ATA y STD/ETD/ATD independientes.
- Aerolíneas, aeropuertos, estaciones, terminales, stands, servicios, equipos, aeronaves y posiciones son catálogos canónicos. Un texto de un mock nunca es foreign key.
- Persona, cuenta de acceso, membresía de organización y perfil laboral de agente son conceptos separados.
- Habilitaciones y permisos son ciclos históricos. `vigente`, `por vencer` y `vencido` son proyecciones calculadas desde fechas.
- Los contratos tienen versiones aprobables. Tarifas, moneda y vigencia pertenecen a una versión; un servicio ejecutado guarda su snapshot y no se revaloriza con la tarifa actual.
- Las asignaciones son relaciones normalizadas. Los arrays duplicados dentro de vuelos mock no se persisten.
- Estados operativos, respuestas de checklist, envíos a OCC y decisiones de revisión deben conservar historial append-only. Las tablas modelan ese historial; todavía faltan handlers y permisos que lo garanticen en todos los caminos de escritura.
- Cada futura escritura móvil debe usar una clave de idempotencia dentro del scope de un dispositivo registrado y almacenar su resultado/error para responder reintentos. La tabla e índice existen, pero no hay endpoint de comandos offline.
- KPIs, cobertura, conteos, alertas, no-leídos y elegibilidad son read models, no tablas autoritativas.

## Convenciones SQL Server

- SQL Server 2022, compatibility level `160`.
- Schemas: `infra`, `iam`, `ref`, `hr`, `commercial`, `ops`, `integration`, `audit`.
- Claves internas `bigint identity`; agregados expuestos usan `uniqueidentifier` público y único.
- Instantes en `datetimeoffset(3)` UTC; fechas civiles en `date`; estaciones con zona IANA.
- Dinero `decimal(19,4)`, cantidades `decimal(18,4)`, moneda ISO 4217 `char(3)`.
- Agregados mutables con `rowversion` para concurrencia optimista.
- Foreign keys `NO ACTION`; no hay borrado en cascada de historial operativo, contractual o de auditoría.
- Nombres físicos `snake_case`; clases de dominio en singular.

## Cadena de migraciones v1

| Orden | Migración | Módulos |
| --- | --- | --- |
| 1 | `V1_01_Platform` | schemas, outbox y convenciones base |
| 2 | `V1_02_IdentityReference` | Identity, personas, organizaciones, scopes y catálogos |
| 3 | `V1_03_WorkforceCommercial` | agentes, habilitaciones, turnos, solicitudes y contratos versionados |
| 4 | `V1_04_Operations` | turnarounds, vuelos, asignaciones, servicios, checklists, incidentes y revisión |
| 5 | `V1_05_MobileAudit` | dispositivos, idempotencia y auditoría detallada |

EF Core conserva un único historial en `infra.__EFMigrationsHistory`. `infra.database_instances` se crea antes de EF y se excluye de migraciones para que la herramienta pueda verificar el destino antes de modificar el esquema.

## Política de ambientes y datos

Una ejecución debe coincidir en tres niveles:

1. `ELEVANT_DATABASE_ENVIRONMENT=Development|Production`;
2. nombre exacto `ElevantDevelopmentDb` o `ElevantProductionDb`;
3. marcador singleton del mismo ambiente en `infra.database_instances`.

Production además exige `ELEVANT_CONFIRM_PRODUCTION_SCHEMA_CHANGE=ElevantProductionDb`. La migración de Production crea tablas/índices/constraints, pero no filas de negocio. El único registro previo permitido es el marcador técnico del ambiente; EF añade su historial técnico. No existe comando de seed de Production.

El seed de Development es un ejecutable separado, transaccional, determinista, idempotente y limitado por el marcador. Nunca hace reset, delete global o reemplazo de datos existentes. Todo fixture es sintético y usa identidades `.test`.

## Diferido explícitamente

- facturas, prefacturas y ledger de conciliación;
- notificaciones y chat;
- documentos y evidencia binaria;
- proyecciones analíticas materializadas.

Los mocks actuales tienen reglas incompletas o contradictorias para esas capacidades. Los binarios usarán almacenamiento S3-compatible; SQL conservará metadatos y object keys cuando se diseñe el módulo. Hasta entonces no se improvisan carpetas persistentes en el VPS ni columnas blob.
