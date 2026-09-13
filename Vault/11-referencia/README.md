---
id: referencia-indice
title: "Índice de referencia y fuentes primarias"
type: index
area: reference
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "c2a060179983a13b7e5a0dd45cba1a1fd2e54e8a"
sources:
  - AGENTS.md
  - docs/README.md
  - packages/api-client/openapi/elevant-v1.json
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/ElevantDbContextModelSnapshot.cs
  - Vault/08-gobernanza/fuentes-y-evidencia.md
  - Vault/_generated/repository-inventory.json
tags:
  - referencia
  - fuentes
  - navegacion
---

# Referencia: encontrar la prueba, no otra copia

Este índice responde «¿dónde está la fuente vigente?» y evita que una síntesis del Vault se confunda con un contrato ejecutable. Para una pregunta sobre estado vivo del VPS, la fuente versionada explica **qué comprobar**; hace falta una verificación operativa nueva para responder **qué está pasando ahora**.

| Pregunta | Fuente primaria | Lectura guiada |
| --- | --- | --- |
| ¿Qué área posee un cambio? | [`AGENTS.md`](../../AGENTS.md) y el `AGENTS.md` más cercano | [Arquitectura](../04-arquitectura/README.md) |
| ¿Qué comportamiento implementa la API? | [Código del backend](../../backend/README.md) y sus tests | [API compartida](../05-aplicaciones/api-compartida.md) |
| ¿Qué endpoint y DTO existen? | [Contrato OpenAPI](../../docs/api/openapi-contract.md) y [snapshot generado](../../packages/api-client/openapi/elevant-v1.json) | [OpenAPI, HTTP y SignalR](../04-arquitectura/openapi-http-y-signalr.md) |
| ¿Qué forma tiene la base? | [Migraciones EF](../../docs/database/migrations.md) y [model snapshot](../../database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations/ElevantDbContextModelSnapshot.cs) | [Datos y persistencia](../04-arquitectura/datos-ef-migraciones-y-persistencia.md) |
| ¿Qué valida o publica CI? | [Workflow backend](../../.github/workflows/backend-ci.yml) y demás workflows activos con sus filtros de ruta | [Workflows y estado](../07-entrega/workflows-y-estado.md) |
| ¿Cómo se opera Development? | [Plantillas y runbooks revisados](../../ops/dokploy/README.md) | [Operaciones](../09-operaciones/README.md) |
| ¿Qué decisión justifica un límite? | [ADR](../../docs/adr/0001-use-monorepo.md) y su estado | [Decisiones y riesgos](../04-arquitectura/decisiones-restricciones-y-riesgos.md) |

La [política de fuentes](../08-gobernanza/fuentes-y-evidencia.md) resuelve discrepancias; el [inventario generado](../_generated/repository-inventory.json) ayuda a localizar archivos, pero no certifica por sí solo comportamiento, despliegue ni vigencia.

## Documentación técnica reconciliada

- [Índice de `docs/`](../../docs/README.md): documentación técnica cerca del código.
- [Auditoría y reconciliación de `docs/`](reconciliacion-docs.md): qué se revisó, qué se corrigió y qué sigue abierto.
- [Mapa de preguntas](../00-inicio/mapa-de-preguntas.md): entrada cuando aún no conoces el área.
- [Backlog transversal](../12-backlog/README.md): huecos que una fuente actual no puede cerrar.

Si una ruta de este índice cambia, actualiza el enlace y la nota explicativa en el mismo PR. No mantengas dos contratos vigentes para el mismo hecho.
