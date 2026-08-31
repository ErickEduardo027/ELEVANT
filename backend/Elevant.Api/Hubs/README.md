# Hubs SignalR

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
