---
id: vault-readme
title: "Vault ELEVANT"
type: index
area: vault
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "b75d1df4dbb42cfae27366a3cff0e5cdcaa495b8"
sources:
  - AGENTS.md
  - docs/README.md
  - .obsidian/app.json
  - Vault/00-inicio/home.md
tags:
  - vault
  - onboarding
  - navegacion
---

# Vault ELEVANT

`Vault/` es la puerta de entrada al conocimiento durable de ELEVANT. Está diseñado para leerse directamente en GitHub y dentro del repositorio abierto como un vault de Obsidian, sin instalar plugins comunitarios.

El Vault explica qué existe, por qué existe, cómo se cambia y cómo se opera. No reemplaza las fuentes ejecutables ni convierte un diseño futuro en una capacidad implementada.

## Empieza aquí

1. Abre [Home](00-inicio/home.md) para orientarte.
2. Consulta [Respuestas rápidas](00-inicio/respuestas-rapidas.md) si llegaste con una pregunta concreta.
3. Usa el [Mapa de preguntas](00-inicio/mapa-de-preguntas.md) para encontrar la fuente correcta.
4. Lee [Cómo usar el Vault](00-inicio/como-usar-el-vault.md) antes de editarlo.
5. Revisa el [Estado inicial del conocimiento](00-inicio/estado-inicial.md) para distinguir lo operativo de lo pendiente.
6. Consulta el [Roadmap del Vault](00-inicio/roadmap-del-vault.md) para conocer las siguientes entregas y sus límites.
7. Si retomas el proyecto sin historial de conversación, sigue el [Protocolo de recuperación de contexto](00-inicio/protocolo-recuperacion-contexto.md).

## Mapa del conocimiento

| Área | Responde principalmente | Punto de entrada |
| --- | --- | --- |
| Inicio | ¿Dónde encuentro algo y qué está vigente? | [Home](00-inicio/home.md) |
| Producto | ¿Para quién existe ELEVANT y qué problema resuelve? | Índice de Producto |
| Arquitectura | ¿Cómo se conectan aplicaciones, API y datos? | Índice de Arquitectura |
| Dominio | ¿Qué significan los conceptos operativos? | Índice de Dominio |
| Aplicaciones | ¿Qué hace cada cliente y cuál es su estado? | Índice de Aplicaciones |
| Desarrollo | ¿Cómo preparo, cambio y valido el código? | Índice de Desarrollo |
| CI/CD | ¿Qué valida y qué entrega cada pipeline? | Índice de CI/CD |
| Operaciones | ¿Cómo se despliega, observa y recupera Development? | Índice de Operaciones |
| Seguridad | ¿Cuáles son las fronteras de confianza y acceso? | Índice de Seguridad |
| Gobernanza | ¿Cómo sabemos que una afirmación es confiable? | [Política de evidencia](08-gobernanza/fuentes-y-evidencia.md) |
| Historia | ¿Cómo llegó el proyecto al estado actual? | Índice de Historia |
| Referencia | ¿Dónde están contratos, inventarios y glosarios? | Índice de Referencia |
| Backlog | ¿Qué está diferido y qué falta decidir? | Índice de Backlog |

Los índices que todavía no tengan enlace se incorporan por entregas. Una ausencia se registra como pendiente; nunca se rellena con una suposición.

## Relación con el repositorio

El conocimiento se distribuye deliberadamente:

- `Vault/` organiza explicaciones, decisiones, recorridos y estado verificable.
- [`docs/`](../docs/README.md) conserva la documentación técnica y operativa junto al código.
- Los `README.md` de cada producto explican comandos y límites locales.
- Los `AGENTS.md` definen reglas obligatorias para personas y agentes que modifican cada subárbol.
- El código, las pruebas, OpenAPI, las migraciones y los workflows continúan siendo fuentes ejecutables de verdad.

Cuando dos fuentes discrepan, aplica la precedencia de la [Política de evidencia y fuentes](08-gobernanza/fuentes-y-evidencia.md), detén cualquier operación riesgosa y corrige la documentación en el mismo PR que resuelva la discrepancia.

## Principios

- **Verificable:** toda afirmación importante identifica una fuente o se marca como desconocida.
- **Vivo:** un cambio durable de comportamiento actualiza el conocimiento afectado.
- **Navegable:** toda nota publicada se alcanza desde Home o desde un mapa de contenido.
- **Seguro:** no se guardan secretos, PII, dominios privados reales, IP públicas, backups ni credenciales.
- **Honesto:** `planned`, `deferred` y `unknown` nunca se presentan como implementados.
- **Portable:** enlaces Markdown relativos y diagramas Mermaid funcionan fuera de Obsidian.

## Antes de contribuir

Lee, en este orden:

- [Reglas para trabajar dentro del Vault](AGENTS.md)
- [Cómo usar el Vault](00-inicio/como-usar-el-vault.md)
- [Metadatos](08-gobernanza/metadatos.md)
- [Política de evidencia y fuentes](08-gobernanza/fuentes-y-evidencia.md)
- [Mantenimiento del Vault](08-gobernanza/mantenimiento-del-vault.md)
- [Roadmap de construcción](00-inicio/roadmap-del-vault.md)
- [Protocolo de recuperación de contexto](00-inicio/protocolo-recuperacion-contexto.md)
- [Leyenda del grafo](diagrams/leyenda-grafo.md)
- [Plantillas](99-plantillas/README.md)

El Vault documenta; por sí solo no autoriza un merge, una migración, una publicación de artefactos ni una mutación del VPS.
