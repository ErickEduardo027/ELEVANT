# ADR-0011: CD pull-based para la API Development

## Estado

Accepted — 2026-08-31. Solo aplica a la API y base sintética de Development.
Production y los tres clientes conservan ciclos de entrega separados.

## Contexto

La base Development ya se promueve mediante el controlador privado definido en
ADR-0009 y el bundle OCI de ADR-0010. La API debe actualizarse después de CI y,
cuando cambia Persistence, únicamente después de que esa base haya aceptado la
entrega compatible. Dokploy y el VPS permanecen privados y no reciben conexiones
iniciadas por GitHub.

El AutoDeploy del provider GitHub de Dokploy se activa con el push, recompila en
el VPS y no constituye un gate entre CI, migraciones y API. Una Application de
Dokploy tampoco conserva simultáneamente la red bridge interna de SQL y el bind
exclusivo de loopback requerido por Tailscale Serve.

## Decisión

- GitHub Actions restaura, compila, prueba y certifica la imagen fuera del VPS.
- CI publica la imagen API por digest y después un bundle OCI v1 con manifiesto y
  Compose API secret-free. El alias `development-certified` se mueve al final y
  solo sirve para descubrimiento.
- La API corre como Docker Compose normal, separado de SQL y de los clientes. Se
  conecta a la red interna `elevant-dev-data` y a una red de salida propia; solo
  publica `127.0.0.1:18080:8080`.
- Un controlador `api-cd` instalado manualmente consulta GHCR desde el plano
  privado. Valida identidad, labels, hashes, Compose, imagen y compatibilidad DB
  antes de mutar el servicio.
- El manifiesto fija el bundle DB requerido y sus fingerprints de migraciones y
  modelo. El controlador acepta ese bundle exacto o uno posterior con ambos
  fingerprints idénticos; nunca acepta una base anterior ni un esquema distinto.
- Las promociones API comparten el lock de operaciones DB y un lock propio. La
  secuencia es `DB compatible -> API -> health/readiness/ping/Swagger`.
- Un candidato no saludable vuelve al último par imagen + Compose/hash sano.
  Nunca ejecuta migraciones descendentes, restore SQL automático ni
  `docker compose down`.
- El primer despliegue, la instalación y la adopción son checkpoints manuales.
  Después, un schedule privado consulta el alias cada minuto.
- Development permanece accesible solo mediante
  `svc:elevant-dev-api`. Tailscale limita alcance de red, pero no sustituye la
  futura autenticación, RBAC y separación tenant de la aplicación.

## Consecuencias

- Un push relevante a `Development` solo llega al VPS después de tests y de una
  publicación completa; no se compila .NET en el KVM.
- Un cambio de Persistence publica primero DB y luego API. Un cambio API-only usa
  la última base certificada compatible.
- Un fallo de DB deja la API anterior activa. Un fallo de API conserva la base
  ya migrada y exige que los cambios de esquema sigan expand/contract para que el
  rollback de aplicación sea seguro.
- Los secretos permanecen en Environment/Docker config root-only del VPS; GitHub
  publica únicamente artefactos sin credenciales.
- El guard reduce las carreras antes de mover el alias, pero GitHub refs y tags
  GHCR no admiten una actualización condicional atómica conjunta. Una entrega
  anterior podría anunciarse brevemente si coincide exactamente con un nuevo
  push; la serialización, el `runId` monotónico y el siguiente poll impiden una
  regresión persistente. Toda auditoría y rollback usa digests, nunca el alias.
- Mientras no exista autenticación funcional, la entrega compartida expone solo
  el scaffold técnico dentro del tailnet: health, readiness, ping, Swagger y hubs
  todavía sin métodos de negocio.

Guías operativas:
[`docs/deployment/dokploy.md`](../deployment/dokploy.md) y
[`ops/dokploy/api-cd/README.md`](../../ops/dokploy/api-cd/README.md).
