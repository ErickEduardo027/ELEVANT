# Inventario del esquema v1

El snapshot de EF Core contiene 67 tablas lógicas contando el marcador pre-EF: 66 creadas por migraciones y `infra.database_instances` creado por bootstrap.

```text
iam (cuentas, personas, organizaciones, permisos)
 ├──> hr (agentes, scopes, habilitaciones, turnos)
 ├──> commercial (solicitudes, contratos y versiones)
 └──> audit

ref (aerolíneas, estaciones, servicios, aeronaves, equipos)
 ├──> hr
 ├──> commercial
 └──> ops (turnaround -> ground operation -> ejecución/revisión)
                         ├──> integration (dispositivo + idempotencia)
                         ├──> audit
                         └──> infra.outbox_messages
```

## Inventario por schema

| Schema | Tablas | Responsabilidad |
| --- | --- | --- |
| `infra` | `database_instances`, `outbox_messages` | identidad inmutable del ambiente e integración transaccional |
| `iam` | `accounts`, `roles`, `account_roles`, `account_claims`, `account_logins`, `account_tokens`, `role_claims`, `persons`, `organizations`, `organization_memberships`, `permissions`, `role_permissions`, `account_station_scopes` | autenticación, identidad humana, tenant, autorización y scopes |
| `ref` | `airlines`, `airports`, `stations`, `terminals`, `stands`, `service_definitions`, `equipment_types`, `equipment_assets`, `aircraft_types`, `operational_positions`, `airline_registry_entries` | catálogos canónicos compartidos; aerolíneas vistas en el feed de vuelos (ADR-0028) |
| `hr` | `ramp_agents`, `ramp_agent_station_scopes`, `ramp_agent_terminal_scopes`, `qualification_cycles`, `airport_permit_cycles`, `shift_assignments`, `availability_requests`, `coverage_requirements` | personal operativo, vigencias, planificación y cobertura |
| `commercial` | `service_requests`, `service_request_stations`, `service_request_items`, `service_request_status_events`, `contracts`, `contract_status_events`, `contract_versions`, `contract_version_stations`, `contract_service_rates` | solicitudes comerciales y contratos/tarifas con historia |
| `ops` | `turnarounds`, `turnaround_status_events`, `flight_legs`, `ground_operations`, `ground_operation_status_events`, `stand_assignments`, `operation_agent_assignments`, `operation_equipment_assignments`, `operation_services`, `operation_service_status_events`, `operation_milestones`, `checklist_templates`, `checklist_template_versions`, `checklist_template_items`, `operation_checklists`, `checklist_answers`, `incidents`, `operation_submissions`, `review_decisions`, `operational_service_requests`, `operation_message_reads` | planificación y ejecución de la escala, evidencia estructurada y control OCC; cursor de lectura del chat por cuenta (ADR-0029) |
| `integration` | `mobile_devices`, `mobile_device_account_bindings`, `mobile_command_receipts`, `provider_usage_entries`, `provider_sync_leases`, `external_flight_proposals` | dispositivos administrados, vínculo de cuenta y deduplicación offline; uso, turno y vuelos propuestos del proveedor de vuelos (ADR-0028) |
| `audit` | `audit_entries`, `audit_changes` | quién, cuándo, tenant/estación, correlación y cambios de campos |

`infra.__EFMigrationsHistory` es una tabla técnica adicional administrada por EF Core.

## Agregados y relaciones importantes

### Identidad y tenant

`iam.persons` representa a la persona; `iam.accounts` representa credenciales; `iam.organization_memberships` define su relación con una organización. Un perfil `hr.ramp_agents` enlaza una persona con su realidad laboral. Esta separación evita usar correo, username o nombre como identidad de negocio.

El diseño del portal público exige partir de una membresía activa y scopes
autorizados, sin confiar en un airline/organization recibido del navegador.
El acceso interno combina permisos de rol con `account_station_scopes`. El
slice de sesión valida credenciales y resuelve desde SQL los roles, membresías
activas y station scopes del actor. `GET /api/v1/auth/session` repite esa
resolución para no confiar el contexto al JWT. Las lecturas OCC vuelven a
resolver el actor, exigen `ADMIN_OCC` + `BackOffice`, membresía interna AVIAM y
scope de estación, y filtran las estaciones/escalas autorizadas dentro de SQL.
Ese control no debe generalizarse a módulos todavía no implementados.

En el slice actual, `organization_memberships.ValidFrom` y `ValidTo` son fechas
civiles inclusivas y se comparan con la fecha UTC del servidor. Es una semántica
provisional: antes de introducir reglas dependientes de jornada o estación debe
decidirse explícitamente su zona horaria de negocio; el cliente no elige esa
interpretación. La resolución de cuenta, persona, roles, membresías y estaciones
usa consultas de lectura separadas, no una transacción con snapshot consistente.
Por ello la respuesta de sesión es contexto informativo y cada comando futuro
debe autorizarse contra el estado vigente dentro de su propia operación.

### Comercial

El esquema permite que una solicitud conserve estaciones, ítems e historial de
estados, y que un contrato tenga eventos de estado y versiones con estaciones
y tarifas. La lectura de opciones OCC selecciona únicamente contratos activos y
versiones aprobadas vigentes para la aerolínea, estación y fecha de la escala;
expone sus tarifas como catálogo predeterminado y falla cerrado ante más de una
versión aplicable. No existe todavía un handler que cree, renueve o modifique
contratos sin sobrescribir una versión histórica.

### Operación

`ops.turnarounds` modela la raíz de la escala. Sus `flight_legs` separan
llegada/salida. El esquema ubica la ejecución en `ground_operations` y las
asignaciones de stand, agentes y equipos en relaciones temporales propias.
`operation_services` tiene columnas para cantidad y snapshot comercial; la
prohibición de repricing histórico requiere lógica de aplicación adicional.

`GET /api/v1/occ/planning` proyecta este grafo sin seguimiento EF: turnaround,
tramos, stand/terminal, operación, asignaciones vigentes, equipos y servicios.
`GET /api/v1/occ/planning/options` deriva el contexto de la escala y calcula la
elegibilidad de agentes desde cuentas mobile, membresía, scopes laborales y de
cuenta, cualificación, permisos aeroportuarios y cobertura del turno en la zona
horaria de la estación. Esos resultados calculados no son nuevas tablas ni
constituyen una asignación. Este corte reutiliza el esquema v1 y no añade una
migración.

El modelo de checklist conecta template -> versión -> ítems -> instancia de
operación -> respuestas. `operation_submissions` y `review_decisions` modelan
envío a OCC y revisión. El comportamiento de corrección append-only aún debe
implementarse y comprobarse en los casos de uso.

### Mobile y auditoría

La unicidad de `integration.mobile_command_receipts` por dispositivo +
idempotency key prepara la deduplicación de reintentos, pero no existe todavía
un handler que procese comandos offline. Las tablas de auditoría pueden guardar
contexto y cambios cuando se implementen sus escrituras; no deben almacenar
tokens, contraseñas, archivos o payloads sensibles completos.

## Elementos que no son tablas v1

- estados calculados de vencimiento, cobertura y elegibilidad;
- KPIs, contadores y resúmenes de dashboard;
- arrays de agentes/equipos dentro de un vuelo;
- nombres descriptivos usados como relaciones;
- binarios/fotos/PDF;
- notificaciones/chat y facturación documental todavía no acordados.

Una nueva tabla requiere una regla de negocio estable, dueño del agregado, tenant/scope, política de historia/retención, índices consultables y prueba de migración limpia + upgrade.
