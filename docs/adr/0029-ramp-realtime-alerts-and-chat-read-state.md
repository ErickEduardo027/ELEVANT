# ADR-0029: Tiempo real de rampa, alertas a OCC y estado de lectura del chat

## Estado

Accepted — 2026-11-04.

## Contexto

Fase 3 del ciclo operativo («La operación»), bloque 1. Las entrevistas con OCC (José Pillier)
y con un agente de operaciones dejaron tres problemas:
- la radio va congestionada, así que **toda desviación del proceso normal debe llegar en vivo
  a OCC**;
- el aeropuerto cambia la posición «al minuto», y el agente debe enterarse al momento;
- el chat debe funcionar de verdad entre la tablet y OCC.

La exploración del código mostró que:
- el aviso de un mensaje nuevo solo llegaba a quien lo enviaba;
- el agente nunca sabía que lo habían asignado;
- OCC no veía en vivo el inicio, el checklist, los servicios ni los incidentes;
- la cola de Revisión y «Mis turnos» de la tablet no recibían avisos;
- la tablet solo sondeaba cada 25 segundos.

## Decisión

### Avisos (pistas del feed de cambios)

Siguen el modelo existente: una pista solo **anuncia** que algo cambió; el cliente vuelve a
leer por REST con sus permisos actuales. Las pistas se escriben en la misma transacción que
el cambio.

| Recurso | Destinatarios | Lo emiten |
|---|---|---|
| `operation_messages` | OCC de la estación y agentes asignados, **además** del remitente | enviar un mensaje; marcar una conversación como leída |
| `ramp_operations` | agentes asignados (y el agente recién asignado, o el que entregó, en la decisión de OCC) | asignación, inicio, checklist, servicios, incidentes, recargos, corrección, entrega, decisión de OCC y cambios de posición |
| `occ_review` | OCC de la estación | recargos, corrección, entrega y decisión de OCC |
| `ramp_schedule` | cuentas RAMP_AGENT del propio agente | turnos, permisos y habilitaciones creados o retirados por HR u OCC |
| `occ_planning` | OCC de la estación | también toda escritura de rampa |

`EfAccountChangeReadStore` entrega:
- `ramp_operations` y `ramp_schedule` solo a cuentas con rol de agente de rampa vigente;
- `occ_review` solo a cuentas del departamento de Operaciones con `operations.review.read` y una
  estación en la pista.

`RampOperationChangeWriter` concentra el reparto.

### Notificaciones nuevas

| Tipo | Destinatario | Origen (`sourceId`) |
|---|---|---|
| `operation_assigned` | agente asignado | la asignación |
| `operation_started` | OCC | la operación |
| `incident_reported` | OCC, como **alerta** | el incidente |
| `flight_changed` | agentes asignados | el registro de auditoría del cambio |

`flight_changed` se emite al asignar, reasignar o liberar la posición del vuelo, no al
registrar la llegada. Las notificaciones son únicas por (destinatario, tipo, origen); por eso
cada cambio de posición usa su propio registro de auditoría y un vuelo movido dos veces avisa
dos veces.

`assignment_released` y `deviation_reported` quedan nombrados en los clientes para los bloques 2
y 3; este bloque todavía no los emite.

> **Actualización (8 de noviembre de 2026).** La liberación del agente, el relevo, la
> reasignación por cambio de posición y la cancelación o el desvío de un vuelo avisan
> `assignment_released` al agente que sale; el relevo y la reasignación, `operation_assigned` al
> que entra. `flight_changed` avisa también la corrección de la llegada. OCC recibe tipos nuevos
> que nunca llegan a la tablet: `flight_cancelled_by_provider`, `flight_diverted_by_provider`,
> `stand_change_unassigned` y `contract_not_in_force`. `occ_review` lo emiten además la
> evidencia tardía, la reapertura, las incidencias de OCC y la exclusión de facturación. Ver
> [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).

### Estado de lectura del chat

- Nueva tabla `ops.operation_message_reads`: un cursor por (cuenta, operación) con el último
  mensaje leído.
  - Solo avanza: marcar un mensaje anterior no lo retrocede.
  - Un mensaje desconocido devuelve 404.
- `PUT /api/v1/chat/conversations/{operationId}/read` (`markOperationalConversationRead`, 204)
  requiere `operations.chat.read`.
- Las conversaciones devuelven:
  - `unreadCount`: los mensajes de otros posteriores al cursor propio;
  - `othersReadUpTo`: hasta dónde leyeron los demás participantes;
  - `agentName`: los agentes asignados.
- Los mensajes devuelven `othersReadUpTo`, con el que el cliente muestra «Visto».

### Clientes

**AVIAM Web (OCC)**
- La campana operativa se suscribe al feed. Las notificaciones nuevas aparecen como aviso
  emergente:
  - incidencias y desviaciones como **alerta** (15 s);
  - el resto como información.
  - Nunca se repiten los avisos antiguos al abrir la aplicación.
- La cola de Revisión se recarga sola con `occ_review`, sin perder lo que muestra.

  > **Actualización (8 de noviembre de 2026).** La evaluación del ciclo encontró que el aviso
  > llegaba, pero la pantalla de Revisión no lo escuchaba (hueco 3-N23). Ahora
  > `useOccReviewChangeVersion` escucha `occ_review`: la cola, el detalle y el panel de
  > incidencias se releen sin pasar a «cargando», y una decisión preparada se descarta si cambió
  > la versión. Ver
  > [ADR-0039](0039-operation-planning-coverage-offline-tablet-occ-review-and-reports.md).
- El chat muestra:
  - las insignias de no leídos y el agente;
  - «✓ Enviado» o «✓✓ Visto» en los mensajes propios.
  - Al abrir un hilo con el final a la vista, lo marca como leído.

**Tablet**
- Se conecta a los mismos hubs SignalR (`@microsoft/signalr`). `ChangedV1` despierta al
  momento la reconciliación del cursor REST.
  - Los hubs se desconectan en segundo plano.
  - El sondeo de 25 s queda como respaldo.
- Inicio y Vuelo se recargan con `ramp_operations`.
- «Mis turnos» se recarga con `ramp_schedule`.
- El chat tiene no leídos, «Visto por OCC» y marca como leído el hilo abierto.

## Consecuencias

- **Ventajas:** OCC se entera en segundos de lo que pasa en rampa, y el agente de sus
  asignaciones y cambios de posición, sin depender de la radio.
- **Costo:** cada escritura de rampa añade unas pocas filas al outbox, que el distribuidor ya
  deduplica.
- **Sin cambios de seguridad:** el contenido sigue sin ir por el socket, y la autorización se
  vuelve a resolver en cada lectura.
- **Fuera de alcance:** no hay entrega con la app cerrada (push de Android). La latencia en el
  VPS se mide tras desplegar.
