# Comunicación en tiempo real

Elevant reserva SignalR para notificaciones servidor-cliente y actualizaciones operativas. REST continúa siendo la fuente de verdad.

## Hubs iniciales

- `/hubs/operations`: cambios operativos relevantes para pantallas activas.
- `/hubs/notifications`: avisos dirigidos a usuarios o roles cuando exista autenticación.

Los hubs pueden existir como shell técnico sin métodos de negocio. Ningún cliente debe asumir eventos hasta que su nombre, payload, autorización y compatibilidad estén documentados.

## Semántica de entrega

La conexión puede perder mensajes, reconectarse o recibir duplicados. Por eso cada evento futuro debería incluir identificador, tipo, versión, fecha UTC y una clave de agregado o recurso. El cliente invalida su caché o consulta REST; no construye estado crítico exclusivamente sumando eventos recibidos.

## Seguridad y escala

Antes de enviar datos reales se implementan autenticación del handshake, autorización por grupo, límites de payload, validación de origen y revocación. Al escalar a varias réplicas se decide un backplane o servicio administrado compatible; no se presupone afinidad de sesión como solución permanente.

