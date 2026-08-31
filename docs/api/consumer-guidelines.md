# Guía para consumidores de la API

## URL y versión

La URL base llega desde configuración pública del cliente. Los endpoints de negocio se consumen bajo `/api/v1`; no se codifican hosts en fuente. Tras completar su handoff, Development usará `https://elevant-dev-api.<tailnet>.ts.net` mediante Tailscale Services. Local/prototipo conserva su URL explícita por ambiente.

La primera entrega remota es deliberadamente un scaffold técnico. Expone
`/api/v1/system/ping`, `/health`, `/health/ready` y Swagger dentro del tailnet;
todavía no contiene endpoints de negocio ni autenticación funcional. Tailscale
limita quién alcanza el host, pero no reemplaza JWT, RBAC ni el scope tenant que
deberán proteger los contratos de negocio.

## Solicitudes

- JSON solo cuando el contrato lo indique.
- Propagar cancelación al abandonar pantalla/flujo.
- No reintentar comandos salvo contrato idempotente.
- Mobile envía device ID + idempotency key estable en escrituras offline.
- No registrar bodies, tokens o URLs con parámetros sensibles.
- IDs de organización/estación/agente enviados por cliente no sustituyen el scope autenticado del servidor.

## Respuestas

Tratar todos los códigos documentados. Los errores usan Problem Details/Validation Problem Details; UI muestra mensaje seguro y correlation ID. Nunca base lógica en el texto humano de `detail`.

`/health` y `/health/ready` son de plataforma, no polling de clientes. SignalR avisa; REST recupera verdad tras reconectar.

## Compatibilidad

Regenerar el cliente al cambiar OpenAPI. Consumidores ignoran campos desconocidos. Un requerido nuevo/cambio semántico necesita versión o estrategia compatible, porque API, dos webs y app nativa se liberan de forma independiente.
