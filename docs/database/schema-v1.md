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
| `ref` | `airlines`, `airports`, `stations`, `terminals`, `stands`, `service_definitions`, `equipment_types`, `equipment_assets`, `aircraft_types`, `operational_positions` | catálogos canónicos compartidos |
| `hr` | `ramp_agents`, `ramp_agent_station_scopes`, `ramp_agent_terminal_scopes`, `qualification_cycles`, `airport_permit_cycles`, `shift_assignments`, `availability_requests`, `coverage_requirements` | personal operativo, vigencias, planificación y cobertura |
| `commercial` | `service_requests`, `service_request_stations`, `service_request_items`, `service_request_status_events`, `contracts`, `contract_status_events`, `contract_versions`, `contract_version_stations`, `contract_service_rates` | solicitudes comerciales y contratos/tarifas con historia |
| `ops` | `turnarounds`, `turnaround_status_events`, `flight_legs`, `ground_operations`, `ground_operation_status_events`, `stand_assignments`, `operation_agent_assignments`, `operation_equipment_assignments`, `operation_services`, `operation_service_status_events`, `operation_milestones`, `checklist_templates`, `checklist_template_versions`, `checklist_template_items`, `operation_checklists`, `checklist_answers`, `incidents`, `operation_submissions`, `review_decisions`, `operational_service_requests` | planificación y ejecución de la escala, evidencia estructurada y control OCC |
| `integration` | `mobile_devices`, `mobile_device_account_bindings`, `mobile_command_receipts` | dispositivos administrados, vínculo de cuenta y deduplicación offline |
| `audit` | `audit_entries`, `audit_changes` | quién, cuándo, tenant/estación, correlación y cambios de campos |

`infra.__EFMigrationsHistory` es una tabla técnica adicional administrada por EF Core.

## Agregados y relaciones importantes

### Identidad y tenant

`iam.persons` representa a la persona; `iam.accounts` representa credenciales; `iam.organization_memberships` define su relación con una organización. Un perfil `hr.ramp_agents` enlaza una persona con su realidad laboral. Esta separación evita usar correo, username o nombre como identidad de negocio.

El diseño del portal público exige partir de una membresía activa y scopes
autorizados, sin confiar en un airline/organization recibido del navegador.
El acceso interno previsto combina permisos de rol con
`account_station_scopes`. Hoy esas tablas y relaciones existen en el esquema,
pero no hay autenticación, autorización tenant ni endpoints de negocio que
apliquen todavía esas reglas.

### Comercial

El esquema permite que una solicitud conserve estaciones, ítems e historial de
estados, y que un contrato tenga eventos de estado y versiones con estaciones
y tarifas. No existe todavía un handler que imponga la renovación sin
sobrescribir una versión histórica.

### Operación

`ops.turnarounds` modela la raíz de la escala. Sus `flight_legs` separan
llegada/salida. El esquema ubica la ejecución en `ground_operations` y las
asignaciones de stand, agentes y equipos en relaciones temporales propias.
`operation_services` tiene columnas para cantidad y snapshot comercial; la
prohibición de repricing histórico requiere lógica de aplicación adicional.

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
