# Guía para consumidores de la API

## URL y versión

La URL base llega desde configuración pública del cliente; no se codifican
hosts reales en fuente. El único endpoint versionado actual es
`/api/v1/system/ping`. Las futuras operaciones de negocio se publicarán bajo
`/api/v1` o una versión nueva compatible. Development usa un Service Tailscale
privado; en ejemplos se emplea `<PRIVATE_API_ORIGIN>` para no versionar su dominio.

La superficie remota actual sigue siendo deliberadamente técnica. Expone
`/api/v1/system/ping`, `/health`, `/health/ready` y Swagger dentro del tailnet;
todavía no contiene endpoints de negocio ni autenticación funcional. Tailscale
limita quién alcanza el host, pero no reemplaza JWT, RBAC ni el scope tenant que
deberán proteger los contratos de negocio.

## Solicitudes

- JSON solo cuando el contrato lo indique.
- Propagar cancelación al abandonar pantalla/flujo.
- No reintentar comandos salvo contrato idempotente.
- Cuando exista el endpoint de comandos offline, Mobile deberá enviar una
  identidad de dispositivo autorizada y una idempotency key estable según su
  contrato; la tabla de receipts por sí sola no implementa este flujo.
- No registrar bodies, tokens o URLs con parámetros sensibles.
- IDs de organización/estación/agente enviados por cliente no sustituyen el scope autenticado del servidor.

## Respuestas

Tratar los códigos publicados por cada operación de OpenAPI. El ping actual
declara `200`, `429` y `500`; los errores de transporte protegidos usan Problem
Details. Validation Problem Details, mensajes de UI y correlation ID de negocio
son pautas para endpoints futuros, no una garantía de todos los caminos actuales.
Nunca base lógica en el texto humano de `detail`.

`/health` y `/health/ready` son de plataforma, no polling de clientes. Los hubs
SignalR existen como shells vacíos; cuando se publiquen eventos de negocio,
REST recuperará la verdad tras una reconexión.

## Compatibilidad

Regenerar el cliente al cambiar OpenAPI. Consumidores ignoran campos desconocidos. Un requerido nuevo/cambio semántico necesita versión o estrategia compatible, porque API, dos webs y app nativa se liberan de forma independiente.
