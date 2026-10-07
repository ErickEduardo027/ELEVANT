---
id: dominio-brechas-preguntas
title: "Brechas y preguntas abiertas del dominio"
type: backlog
area: domain
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "0c392571a9a235ff5e75846d14b2a127b6c25c73"
sources:
  - README.md
  - docs/architecture/database-v1.md
  - docs/database/schema-v1.md
  - docs/architecture/external-integrations.md
  - docs/api/openapi-contract.md
  - backend/README.md
  - backend/Elevant.Application/README.md
  - backend/Elevant.Application/DependencyInjection.cs
  - backend/Elevant.Contracts/README.md
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/IdentityReferenceConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/WorkforceCommercialConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/OperationsConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/IntegrationAuditConfiguration.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/PlatformConfiguration.cs
  - database/DevelopmentDB/scripts/bootstrap/provision-development.sql
  - frontend/private-web/README.md
  - frontend/public-web/README.md
  - frontend/mobile-agent/README.md
tags:
  - brechas
  - preguntas-abiertas
  - backlog
  - dominio
---

# Brechas y preguntas abiertas del dominio

Esta lista evita que un vacío se convierta en una suposición. “Brecha” no significa necesariamente defecto: identifica una decisión, regla o capacidad que el repositorio todavía no demuestra.

## Estado honesto

| Capa | Existe | Falta |
| --- | --- | --- |
| Persistencia | Entidades, enums, configuraciones y cinco migraciones v1 | Algunas invariantes de aplicación, transiciones y políticas temporales |
| Backend HTTP | Salud, readiness, ping y Swagger | Autenticación y todos los endpoints/casos de uso de negocio |
| OpenAPI | Scaffold y proceso de snapshot/generación | DTOs y operaciones del dominio |
| Private Web | Recorridos internos ejecutables | Sustitución general de mocks y autorización real |
| Public Web | Landing/portal demostrativo | Sesión real, tenant enforcement y operaciones API |
| Mobile Agent | Recorrido nativo y cola local demostrativa | Integración .NET, autenticación segura y sync contractual |
| Production | Frontera reservada | Infraestructura, datos, secretos, despliegue y políticas aprobadas |

## Decisiones de negocio prioritarias

### Estados y comandos

- Definir matriz de transición por turnaround, operación, servicio, solicitud, contrato, checklist, incidente y revisión.
- Definir actor, permiso, precondición, idempotencia y efecto secundario de cada comando.
- Resolver cómo se mantienen atómicamente estado actual, evento histórico, auditoría y outbox.
- Acordar cancelación, devolución, reapertura y corrección sin borrar historia.

### Tenant y autorización

- Fijar catálogo de permisos y su asignación a roles por portal.
- El modelo ya permite membresías activas simultáneas en organizaciones distintas; definir cómo se elige y valida el contexto y fallar de forma cerrada ante ambigüedad.
- Definir precedencia entre membresía, scope de cuenta, scope laboral de agente y terminal.
- Especificar acceso interno entre aerolíneas y pruebas de aislamiento negativas.
- Diseñar autenticación, invitación, recuperación, bloqueo, revocación de sesión y dispositivo.

### Planificación y tiempo

- Representar turnos que cruzan medianoche y cambios de zona/DST.
- Detectar solapamientos de turnos, stands, agentes y equipos que los índices actuales no cubren.
- Definir algoritmo de elegibilidad y razones explicables.
- Exigir coherencia estación-terminal-stand/equipo/turnaround mediante aplicación o constraints adicionales.
- Acordar códigos de hito, SLA, tolerancias y cálculo de puntualidad/cumplimiento.

### Comercial

- Definir transiciones entre solicitud aprobada, alta de aerolínea y creación de contrato.
- Exigir que `OriginatingServiceRequestId`, cuando exista, apunte a una solicitud aprobada de la misma aerolínea del contrato.
- Evitar solapamientos incompatibles entre versiones y resolver suspensión/terminación.
- Al vincular `OperationService` con una tarifa, exigir precio/moneda all-or-none, enlace de tarifa cuando corresponda, la misma definición de servicio y aerolínea, cobertura de estación, versión aprobada y vigente, y copia consistente e histórica de unidad/precio/moneda.
- Normalizar o gobernar strings todavía abiertos: unidad de cobro, categoría, estado de equipo, rol de asignación y tipo de incidente.
- Decidir Schedule Change, Special Assistance y otros tipos observados en Public Web sin asumir que ya existen.
- Definir facturación, prefacturas, impuestos, conciliación, disputas y ledger; hoy están explícitamente fuera de v1.

### Operación, evidencia y revisión

- Definir cuándo nace una `GroundOperation` y cómo se relacionan estados de turnaround y ejecución.
- Acordar obligatoriedad de servicios, checklist, firmas/evidencias e incidentes antes de enviar.
- Exigir que cada `ChecklistAnswer` use un ítem de la misma versión instanciada por su `OperationChecklist` y que cada `OperationSubmission` use un checklist de su misma `GroundOperation`.
- Precisar devolución y nueva revisión: hoy el envío no snapshottea respuestas, varios envíos pueden apuntar al mismo checklist y sus respuestas siguen mutables. Hace falta versionado/snapshot y enforcement append-only.
- Alinear outcome de `ReviewDecision` con el estado de `OperationSubmission`.
- Diseñar metadatos, object keys, tipos, tamaño, retención, antivirus y permisos para fotos/PDF; SQL no almacenará binarios.
- Definir qué solicita `OperationalServiceRequest`, su historia de estados y relación con una línea ejecutada.
- En `OperationalServiceRequest`, validar membresía activa y autorización del solicitante/resolutor, scope de estación, aplicabilidad del servicio y coherencia de aerolínea/estación con turnaround; exigir además `NeededAt >= RequestedAt` y coherencia entre estado, resolutor, nota y fecha. Las FKs y el único check temporal actual no lo garantizan.

### Mobile e integraciones

- Versionar payloads/comandos offline, respuesta repetible, expiración y resolución de conflictos.
- Definir registro/revocación de dispositivos, almacenamiento seguro de tokens y pérdida de tablet.
- Exigir al procesar cada comando un binding activo cuya cuenta coincida con el recibo, una cuenta habilitada y un dispositivo no revocado; de estas coherencias sólo está materializado el dedupe dispositivo-clave.
- Alinear estado del recibo con `ProcessedAt`, resultado y error, y devolver exactamente el resultado persistido en un reintento sin duplicar trabajo.
- Establecer reconciliación tras reconexión; SignalR sólo puede acelerar avisos, no ser fuente de verdad.
- Acordar precedencia y reconciliación de datos `Internal`, `Manual`, `AirlineClient` y `ExternalProvider`.
- Completar puertos/use cases para FlightAware u otros proveedores antes de declarar integración real.

### Auditoría, privacidad y retención

- Definir catálogo de acciones auditables y política de acceso/retención.
- Redactar secretos, tokens, documentos, payloads y PII en errores, outbox, audit y metadata JSON.
- Definir derecho de corrección/eliminación sin romper historia regulatoria u operacional.
- Establecer observabilidad y alertas sin duplicar auditoría como log técnico.

## Pruebas negativas mínimas para estas coherencias

- rechazar una respuesta cuyo ítem pertenezca a otra versión de template y un envío cuyo checklist pertenezca a otra operación;
- rechazar precio/moneda incompletos, tarifa ausente o de otra definición, aerolínea o estación, versión no aprobada/no vigente y snapshots que no coincidan al crear la línea;
- rechazar contrato originado por una solicitud no aprobada o de otra aerolínea;
- rechazar creación o resolución de solicitud operativa fuera de tenant/scope, con referencias incoherentes, tiempos invertidos o resolución incompatible con su estado;
- rechazar recibo móvil con cuenta distinta del binding, binding cerrado, cuenta deshabilitada o dispositivo revocado;
- rechazar recibos con estado/resultado/error incoherentes y comprobar replay exacto sin repetir efectos;
- rechazar modificación o borrado de eventos, respuestas, envíos y decisiones que el diseño declare históricos.

## Contradicciones de vocabulario que deben resolverse

| Fuente de prototipo | Diferencia respecto al modelo | Tratamiento actual |
| --- | --- | --- |
| Public Web | Tipos de solicitud adicionales; objetos de factura, conciliación, documento, disputa y notificación | Conservar como exploración; módulos no modelados siguen diferidos. |
| Mobile Agent | Estados de vuelo en español y granularidad aeronáutica distinta de `TurnaroundStatus` | No mapear uno-a-uno; definir traducción/procedencia en un caso de uso. |
| Private Web | Departamentos y roles detallados; permisos como textos de interfaz | No convertir en autorización hasta tener catálogo servidor y pruebas. |
| Dashboards | KPI, conteos, alertas, cobertura y elegibilidad | Implementar como read models derivados, no tablas por conveniencia. |

## Fuera de alcance v1 explícito

- facturas, prefacturas y ledger de conciliación;
- notificaciones y chat;
- documentos y evidencia binaria;
- proyecciones analíticas materializadas;
- endpoints de negocio inferidos directamente de entidades EF;
- acceso directo de cualquier cliente a SQL Server o proveedor externo;
- reutilizar datos, credenciales o archivos del prototipo como seed real;
- tratar Production como una extensión del host Development.

## Criterio para cerrar una brecha

```mermaid
flowchart LR
    QUESTION[Pregunta de dominio] --> DECISION[Regla o ADR aprobada]
    DECISION --> MODEL[Modelo y migración si aplica]
    DECISION --> USECASE[Caso de uso y autorización]
    USECASE --> OPENAPI[Contrato OpenAPI]
    OPENAPI --> CLIENTS[Clientes consumidores]
    MODEL --> TESTS[Pruebas de invariantes y upgrade]
    USECASE --> TESTS
    OPENAPI --> TESTS
    TESTS --> DOCS[Vault y docs actualizados]
```

Una pantalla terminada o un campo agregado no cierra por sí solo una brecha. Debe existir decisión verificable, comportamiento ejecutable, contrato cuando cruza la API y pruebas proporcionales al riesgo.

## Relacionados

- [Índice de dominio](README.md)
- [Contextos y límites](contextos-y-limites.md)
- [Identidad, tenancy y autorización](identidad-tenancy-y-autorizacion.md)
- [Tiempo, estados y trazabilidad](tiempo-estados-y-trazabilidad.md)

## Fuentes

- [Límites v1](../../docs/architecture/database-v1.md)
- [Contrato OpenAPI](../../docs/api/openapi-contract.md)
- [Estado del backend](../../backend/README.md)
- [Límites de Public Web](../../frontend/public-web/README.md)
- [Límites de Mobile Agent](../../frontend/mobile-agent/README.md)
