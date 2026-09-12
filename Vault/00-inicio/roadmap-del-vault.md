---
id: inicio-roadmap-vault
title: "Roadmap de construcción del Vault"
type: backlog
area: backlog
status: deferred
maturity: seed
evidence: planned
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "f6e0c231abaa9ce9c23a5aa37a501d2859d7152b"
sources:
  - AGENTS.md
  - docs/README.md
  - Vault/README.md
  - Vault/01-historia/README.md
  - Vault/02-producto/README.md
  - Vault/03-dominio/README.md
tags:
  - roadmap
  - conocimiento
  - entregas
---

# Roadmap de construcción del Vault

Esta nota hace visible el alcance que todavía no forma parte de la fundación. Cada etapa se entrega en un PR independiente creado desde el `Development` actualizado y sólo avanza después del merge manual de la etapa anterior.

## Secuencia acordada

```mermaid
flowchart LR
    F[1 · Fundación] --> P[2 · Producto, dominio e historia]
    P --> A[3 · Arquitectura y desarrollo]
    A --> O[4 · Operaciones y entrega]
    O --> R[5 · Reconciliación]
    R --> L[Mantenimiento vivo por PR]

    classDef done fill:#e5f7ef,color:#173f31,stroke:#36a579;
    classDef next fill:#fff1d6,color:#4d3512,stroke:#d99021;
    classDef living fill:#dce8ff,color:#17213a,stroke:#4f75c2;
    class F done;
    class P,A,O,R next;
    class L living;
```

| Etapa | Resultado esperado | Estado al crear la fundación |
| --- | --- | --- |
| 1. Fundación | Navegación, evidencia, metadatos, plantillas, diagramas nativos, inventario y CI del Vault | Entregada |
| 2. Producto, dominio e historia | Visión, actores, vocabulario, capacidades, cronología Git y preguntas anteriores al repositorio | Entregada |
| 3. Arquitectura y desarrollo | Mapas por aplicación, backend, datos, OpenAPI, flujo local y guía de cambio seguro | Pendiente |
| 4. Operaciones y entrega | CI/CD Development, runbooks saneados, observabilidad, SQL privado y diseño de CI/CD/distribución APK del Mobile Agent | Pendiente |
| 5. Reconciliación | Auditoría de `docs/`, corrección de contradicciones, saneamiento y enlaces de reemplazo sin borrar historia útil | Pendiente |

## Alcances deliberadamente separados

- El Vault no implementa CI/CD móvil: primero documentará decisiones, requisitos de firma, ambientes, distribución, rollback y seguridad; la implementación requiere un cambio autorizado aparte.
- Production continúa como frontera futura y separada. Documentarla no autoriza crearla ni desplegarla.
- Alertas externas y simulacros operativos periódicos se documentarán con criterios de aceptación antes de ejecutarse.
- La historia anterior al primer commit sólo se incorporará mediante entrevista y evidencia identificada; mientras tanto permanece `unknown`.

## Criterio de cierre de cada etapa

Una etapa queda cerrada cuando sus notas son navegables desde [Home](home.md), distinguen presente de futuro, citan fuentes reproducibles, pasan `npm run vault:ci`, no contienen información sensible y el PR fue revisado y fusionado manualmente.

Volver a [Home](home.md) o consultar [Mantenimiento del Vault](../08-gobernanza/mantenimiento-del-vault.md).
