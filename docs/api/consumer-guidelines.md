# Guía para consumidores de la API

## URL y versión

La URL base llega desde configuración pública del cliente; no se codifican
hosts reales en fuente. La API versionada actual publica
`/api/v1/system/ping` y `POST`/`GET /api/v1/auth/session`. Las futuras
operaciones de negocio se publicarán bajo `/api/v1` o una versión nueva
compatible. Development usa un Service Tailscale privado; en ejemplos se emplea
`<PRIVATE_API_ORIGIN>` para no versionar su dominio.

La superficie remota actual sigue siendo deliberadamente técnica. Expone
la sesión básica, ping, health/readiness y Swagger dentro del tailnet, pero
todavía no contiene endpoints de negocio. Tailscale limita quién alcanza el
host; no reemplaza la autorización fina por rol, tenant y estación que deberán
proteger esos contratos.

## Sesión

`POST /api/v1/auth/session` recibe email y contraseña y devuelve un Bearer corto
junto con el snapshot inicial del actor. El JWT está firmado con HS256 por un
secreto que solo entra desde el ambiente. Sus únicos datos de identidad son un
`sub` y un `jti`, ambos UUID únicos y obligatorios; roles, membresías y station
scopes no viajan como autoridad en el token.

`GET /api/v1/auth/session` exige ese Bearer y vuelve a resolver en SQL la cuenta,
roles, membresías activas y estaciones vigentes. El cliente debe reemplazar su
contexto local con esa respuesta y no inferir permisos desde el JWT. Aún no hay
refresh, logout, revocación por `jti`, autorización fina de negocio ni contrato
de tenant completo.

La respuesta describe el contexto efectivo observado durante esa solicitud; no
es una concesión de autorización reutilizable ni un snapshot transaccional. Cada
comando de negocio deberá volver a comprobar en el servidor los permisos y
scopes que exige su propia operación.

## Solicitudes

- JSON solo cuando el contrato lo indique.
- El cuerpo de `POST /api/v1/auth/session` admite como máximo 4096 bytes (4 KiB);
  un cuerpo mayor devuelve `413`. Su política por defecto admite 10 intentos por
  IP remota en una ventana fija de 60 segundos y devuelve `429` al agotarla; esos
  valores son configuración del host, no una cuota que el cliente deba consumir.
- Propagar cancelación al abandonar pantalla/flujo.
- No reintentar comandos salvo contrato idempotente.
- Cuando exista el endpoint de comandos offline, Mobile deberá enviar una
  identidad de dispositivo autorizada y una idempotency key estable según su
  contrato; la tabla de receipts por sí sola no implementa este flujo.
- No registrar bodies, tokens o URLs con parámetros sensibles.
- IDs de organización/estación/agente enviados por cliente no sustituyen el scope autenticado del servidor.
- No adjuntar el Bearer a ping, health ni otros endpoints anónimos; el cliente
  compartido solo lo solicita para operaciones autenticadas.

## Respuestas

Tratar los códigos publicados por cada operación de OpenAPI. El ping declara
`200`, `429` y `500`; el `POST` de sesión declara `200`, `400`, `401`, `413`,
`415`, `429`, `500` y `503`; el `GET` declara `200`, `401`, `429` y `500`. Los
errores usan Problem Details cuando el contrato lo indica. Mensajes de UI y correlation
ID de negocio siguen siendo pautas futuras. Nunca base lógica en el texto humano
de `detail`.

`/api/v1/system/ping`, `/health` y `/health/ready` permiten acceso anónimo; los
controllers y hubs mapeados quedan bajo la política fallback autenticada salvo
que declaren otra excepción explícita. Los hubs SignalR exigen Bearer pero siguen
como shells vacíos, sin mensajes ni autorización fina de negocio. Cuando se
publiquen eventos, REST recuperará la verdad tras una reconexión.

Los clientes SignalR de navegador pueden transportar el Bearer como el parámetro
`access_token`; el host solo lo acepta bajo `/hubs/operations` y
`/hubs/notifications`. Esa URL es material sensible: clientes, proxies y
telemetría no deben registrarla con su query string.

## Compatibilidad

Regenerar el cliente al cambiar OpenAPI. Consumidores ignoran campos desconocidos. Un requerido nuevo/cambio semántico necesita versión o estrategia compatible, porque API, dos webs y app nativa se liberan de forma independiente.
