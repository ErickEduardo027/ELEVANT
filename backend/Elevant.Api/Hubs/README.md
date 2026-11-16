# Hubs SignalR

En Development, el distribuidor de `infra.outbox_messages` proyecta cambios
confirmados a `infra.account_changes` y emite `ChangedV1` al usuario destino
en el hub correspondiente. El evento WebSocket solo lleva `eventId`, sin
contenido, identificadores internos ni datos de la operación.
`Realtime:AccountChangeDispatcherEnabled` permanece desactivado por defecto
fuera de Development. Una desconexión o pérdida del evento se recupera con
el feed HTTP por cursor y después con la consulta REST autorizada del recurso.
SignalR no constituye confirmación de lectura.

La API reserva `/hubs/operations` y `/hubs/notifications` para comunicación
servidor-cliente. REST y la base de datos siguen siendo la fuente de verdad; tras
reconectarse, los clientes deben volver a consultar el estado mediante REST.

SignalR se utilizará únicamente para notificaciones, cambios en tiempo real y
actualizaciones de dashboards. No reemplazará comandos ni consultas REST.

Eventos futuros, todavía no implementados ni considerados contratos estables:

- `FlightStatusChanged`
- `FlightAssigned`
- `OperationStarted`
- `ServiceCompleted`
- `IncidentReported`
- `OperationValidated`
