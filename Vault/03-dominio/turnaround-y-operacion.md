---
id: dominio-turnaround-operacion
title: "Turnaround y operación en tierra"
type: capability
area: domain
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "0c392571a9a235ff5e75846d14b2a127b6c25c73"
sources:
  - docs/architecture/database-v1.md
  - docs/database/schema-v1.md
  - backend/Elevant.Domain/Entities/Operations/Turnaround.cs
  - backend/Elevant.Domain/Entities/Operations/FlightLeg.cs
  - backend/Elevant.Domain/Entities/Operations/GroundOperation.cs
  - backend/Elevant.Domain/Entities/Operations/OperationService.cs
  - backend/Elevant.Domain/Entities/Operations/ChecklistAnswer.cs
  - backend/Elevant.Domain/Entities/Operations/OperationSubmission.cs
  - backend/Elevant.Domain/Enumerations/OperationsEnums.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/OperationsConfiguration.cs
  - database/DevelopmentDB/scripts/bootstrap/provision-development.sql
  - frontend/mobile-agent/README.md
tags:
  - turnaround
  - operaciones
  - ground-handling
  - estados
---

# Turnaround y operación en tierra

`Turnaround` representa la escala completa que AVIAM planifica en una estación. `GroundOperation` representa su ejecución en tierra. La separación permite conservar horarios y procedencia de los vuelos sin mezclar asignaciones, servicios, checklist, incidentes o revisión.

## Anatomía de una escala

```mermaid
flowchart LR
    PLAN[Turnaround · aerolínea · estación · fecha] --> ARR[FlightLeg Arrival]
    PLAN --> DEP[FlightLeg Departure]
    PLAN --> STAND[Historia de stand]
    PLAN --> EXEC[GroundOperation]
    EXEC --> TEAM[Asignaciones de agentes]
    EXEC --> EQUIP[Asignaciones de equipos]
    EXEC --> SERVICES[Servicios e hitos]
    EXEC --> CHECK[Checklist y respuestas]
    EXEC --> INCIDENTS[Incidentes]
    CHECK --> SUBMIT[Envío revisionado]
    SUBMIT --> REVIEW[Decisión OCC]
```

Un turnaround guarda código de operación, aerolínea, estación, fecha civil, tipo/matrícula opcionales, estado actual y procedencia. Cada tramo guarda dirección, número de vuelo, origen, destino y sus tiempos programado, estimado y real. La unicidad turnaround-dirección materializa como máximo una llegada y una salida.

## Vocabulario de estado persistido

Los siguientes son conjuntos de valores, no una matriz de transición:

| Objeto | Estados disponibles |
| --- | --- |
| Turnaround | `Scheduled`, `Confirmed`, `InProgress`, `Completed`, `Cancelled`, `Diverted` |
| Operación en tierra | `Planned`, `Assigned`, `InProgress`, `PendingReview`, `InReview`, `Approved`, `Returned`, `Cancelled` |
| Servicio ejecutado | `Planned`, `InProgress`, `Completed`, `NotPerformed`, `Exception` |
| Hito | `Pending`, `Estimated`, `Actual`, `Missed` |
| Checklist | `NotStarted`, `InProgress`, `Submitted` |
| Envío | `PendingReview`, `InReview`, `Approved`, `Returned` |
| Incidente | `Open`, `InReview`, `Resolved`, `Closed` |

```mermaid
flowchart TB
    ENUM[Enum persistido] --> CURRENT[Estado actual en la entidad]
    CURRENT --> EVENT[Evento histórico cuando existe]
    EVENT --> AUDIT[Auditoría transversal]
    RULES[Transiciones autorizadas] -.-> GAP[Pendientes de casos de uso y pruebas]
    GAP -.-> CURRENT
```

El modelo dispone de historias explícitas para turnaround, operación y servicio. Checklist, envío, decisión e incidente conservan sus propios registros. No hay código de aplicación que defina de forma completa qué actor puede mover cada estado, las precondiciones ni las transiciones prohibidas.

## Planificación y recursos

- Un turnaround sólo puede tener una asignación de stand abierta.
- Una operación sólo puede asignar una vez al mismo agente mientras la relación permanezca abierta.
- Un activo de equipo sólo puede participar en una asignación abierta a la vez.
- `OperationalPosition` expresa la función/habilitación requerida; `AssignmentRole` es un texto contextual de la asignación y su taxonomía aún no está cerrada.
- Los intervalos de asignación no pueden terminar antes de empezar, pero el esquema no impide todos los solapamientos entre operaciones o recursos.

## Servicios e hitos

Cada línea de `OperationService` exige una definición canónica y posee una FK opcional `ContractServiceRateId`. También conserva cantidad contratada, cantidad ejecutada y unidad obligatoria; precio y moneda snapshot son opcionales. La FK y esas columnas independientes no demuestran por sí solas procedencia contractual ni que el snapshot se haya copiado de esa tarifa.

Antes de tratar una tarifa como origen autorizado, un caso de uso debe validar y probar que:

- precio y moneda están ambos ausentes o ambos presentes, y una línea con precio contractual referencia una tarifa;
- la tarifa corresponde al mismo `ServiceDefinitionId` de la línea;
- su versión contractual cubre la estación de la operación, pertenece a la misma aerolínea del turnaround, está `Approved` y es vigente en la fecha acordada;
- unidad y precio se copian de la tarifa y moneda de su versión de forma consistente al crear la línea, y el snapshot histórico no se revaloriza después.

Ninguna de esas coherencias cruzadas está materializada hoy por las FKs o constraints de `OperationService`.

Los hitos separan tiempo planeado, estimado y real e identifican su procedencia. La definición de los códigos de hito, SLA y reglas de cumplimiento aún necesita contrato de aplicación; un dashboard no debe inventarlos como columnas autoritativas.

## Checklist, incidentes y revisión

1. Un template posee versiones con vigencia e ítems ordenados; el código y el orden son únicos dentro de cada versión.
2. La pareja operación-versión identifica una instancia de checklist y la pareja checklist-ítem identifica una respuesta. Las FKs no prueban que el ítem respondido pertenezca a la versión instanciada.
3. Un envío numera la revisión y conserva quién/cuándo la presentó. Sus FKs no prueban que el checklist y el envío apunten a la misma operación.
4. Una cuenta revisora emite como máximo una decisión por envío: aprobar o devolver. El esquema no alinea automáticamente el outcome con el estado actual del envío.
5. `OperationSubmission` no captura un snapshot de respuestas: varios envíos pueden referenciar el mismo checklist y `ChecklistAnswer` sigue siendo mutable. Conservar una corrección como nueva revisión sin alterar contenido o decisión anterior es el diseño esperado, pero la unicidad y `NO ACTION` no impiden un `UPDATE` o `DELETE`. El comportamiento append-only aún necesita enforcement y una estrategia de versionado o snapshot.

Las pruebas negativas deben rechazar, como mínimo, una respuesta con un ítem de otra versión, un envío con el checklist de otra operación, la mutación de respuestas ya enviadas y una decisión incompatible con el estado del envío.

Los incidentes registran tipo, severidad, descripción y tiempos de ocurrencia, reporte y resolución. Las fotografías o archivos reales no están resueltos en v1 y no deben guardarse como blobs improvisados.

## Procedencia de datos de vuelo

`OperationalDataSource` admite `Internal`, `Manual`, `AirlineClient` y `ExternalProvider`. Turnaround, tramo, hito y eventos relevantes conservan fuente y, cuando corresponde, referencia/observación externa. El enum no decide precedencia, reconciliación ni confianza entre fuentes; esa política sigue abierta.

## Estado de disponibilidad

En el commit histórico indicado en el frontmatter, Mobile Agent y Private Web presentaban recorridos prototípicos y la API todavía no ofrecía esos casos de uso. Esa observación no describe por sí sola la rama de integración posterior ni certifica un ciclo end-to-end desplegado.

### Cambio en la rama de integración de Development

La rama `feat/integrated-cycle-realtime` añade un caso de uso para que OCC cree una escala manual desde planificación. La API deriva el alcance de estación de la cuenta vigente, exige una única versión contractual aprobada y vigente para aerolínea/estación/fecha, valida ruta y fecha local, reserva una posición activa sin solapamiento y registra llegada, salida, operación planificada, historia, auditoría y aviso recuperable para la aerolínea en una transacción. El UUID de intención permite repetir el mismo cuerpo sin duplicar la escala. Un segundo comando OCC programa un turno local de agente para la estación y terminal derivadas de la escala; exige cobertura de toda la operación, aptitud vigente y ausencia de otro turno para el día. Después OCC refresca elegibilidad y usa el ETag nuevo para el despacho habitual. Programar el turno no asigna por sí solo, no factura y no debe confundirse con una promoción al VPS; el resto del ciclo continúa en implementación.

## Relacionados

- [Glosario canónico](glosario-canonico.md)
- [Entidades y relaciones v1](entidades-y-relaciones-v1.md)
- [Tiempo, estados y trazabilidad](tiempo-estados-y-trazabilidad.md)
- [Brechas y preguntas abiertas](brechas-y-preguntas-abiertas.md)

## Fuentes

- [Decisiones de base v1](../../docs/architecture/database-v1.md)
- [Entidad Turnaround](../../backend/Elevant.Domain/Entities/Operations/Turnaround.cs)
- [Enums operativos](../../backend/Elevant.Domain/Enumerations/OperationsEnums.cs)
- [Restricciones EF de operaciones](../../database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/OperationsConfiguration.cs)
- [Permisos de la aplicación en Development](../../database/DevelopmentDB/scripts/bootstrap/provision-development.sql)
- [Recorrido observado en Mobile Agent](../../frontend/mobile-agent/README.md)
