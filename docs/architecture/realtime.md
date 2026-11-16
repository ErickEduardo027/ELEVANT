# Comunicación en tiempo real

Elevant reserva SignalR para notificaciones servidor-cliente y actualizaciones operativas. REST continúa siendo la fuente de verdad.

## Hubs iniciales

- `/hubs/operations`: cambios operativos relevantes para pantallas activas.
- `/hubs/notifications`: futuros avisos dirigidos a usuarios o roles.

Ambos hubs están mapeados como shells técnicos sin métodos ni eventos de
negocio. La política fallback exige un Bearer válido durante el handshake, pero
todavía no existe autorización por grupo, rol, tenant o estación. Ningún cliente
debe asumir eventos hasta que su nombre, payload, autorización y compatibilidad
estén implementados y documentados.

El transporte SignalR de navegador puede enviar el JWT mediante
`access_token` en la query string. La API solo toma ese parámetro bajo
`/hubs/operations` y `/hubs/notifications`; fuera de esas rutas se ignora. Como
una URL con ese parámetro contiene una credencial, no debe quedar en logs,
trazas, analytics ni mensajes de error. Development eleva
`Microsoft.AspNetCore.Hosting.Diagnostics` a `Warning` para que el log estándar
de inicio de solicitud no registre esa query; cualquier proxy o colector delante
de la API también debe redactarla.

## Semántica de entrega

La conexión puede perder mensajes, reconectarse o recibir duplicados. Por eso cada evento futuro debería incluir identificador, tipo, versión, fecha UTC y una clave de agregado o recurso. El cliente invalida su caché o consulta REST; no construye estado crítico exclusivamente sumando eventos recibidos.

## Seguridad y escala

Antes de enviar datos reales se debe revalidar el actor vigente desde SQL,
autorizar cada suscripción y grupo por rol, tenant y estación, limitar payloads,
validar orígenes y cerrar o renovar conexiones cuando el token expire o sea
revocado. También se versionan nombre y payload de cada evento y se prueba que un
actor no pueda observar datos fuera de su scope. El Bearer actual autentica el
handshake, pero no satisface esos controles. Al escalar a varias réplicas se
decide un backplane o servicio administrado compatible; no se presupone afinidad
de sesión como solución permanente.
