---
id: inicio-roadmap-vault
title: "Roadmap de construcción del Vault"
type: backlog
area: backlog
status: documented
maturity: seed
evidence: planned
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "pending"
sources:
  - AGENTS.md
  - docs/README.md
  - Vault/README.md
  - Vault/01-historia/README.md
  - Vault/02-producto/README.md
  - Vault/03-dominio/README.md
  - Vault/04-arquitectura/README.md
  - Vault/05-aplicaciones/README.md
  - Vault/06-desarrollo/README.md
  - Vault/07-entrega/README.md
  - Vault/09-operaciones/README.md
  - Vault/10-seguridad/README.md
  - Vault/11-referencia/README.md
  - Vault/12-backlog/README.md
  - Vault/11-referencia/reconciliacion-docs.md
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
    class F,P,A,O done;
    class R next;
    class L living;
```

| Etapa | Resultado esperado | Estado actual del roadmap |
| --- | --- | --- |
| 1. Fundación | Navegación, evidencia, metadatos, plantillas, diagramas nativos, inventario y CI del Vault | Entregada |
| 2. Producto, dominio e historia | Visión, actores, vocabulario, capacidades, cronología Git y preguntas anteriores al repositorio | Entregada |
| 3. Arquitectura y desarrollo | Mapas por aplicación, backend, datos, OpenAPI, flujo local y guía de cambio seguro | Entregada |
| 4. Operaciones y entrega | CI/CD Development, runbooks saneados, observabilidad, SQL privado y diseño de CI/CD/distribución APK del Mobile Agent | Entregada como documentación; pipeline APK y alertas externas aún diferidos |
| 5. Reconciliación | Auditoría de `docs/`, corrección de contradicciones, saneamiento y enlaces de reemplazo sin borrar historia útil | Preparada en este PR; pendiente de revisión y merge manual |

## Alcances deliberadamente separados

- El Vault [documenta](../07-entrega/mobile-apk-ci-cd.md) decisiones, requisitos de firma, ambientes, distribución, rollback y seguridad de Mobile; la implementación requiere un cambio autorizado aparte.
- Production continúa como frontera futura y separada. Documentarla no autoriza crearla ni desplegarla.
- Alertas externas y simulacros operativos periódicos figuran con [criterios de cierre](../12-backlog/pendientes-transversales.md); ejecutarlos exige un cambio y aceptación separados.
- La historia anterior al primer commit sólo se incorporará mediante entrevista y evidencia identificada; mientras tanto permanece `unknown`.

## Criterio de cierre de cada etapa

Una etapa queda cerrada cuando sus notas son navegables desde [Home](home.md), distinguen presente de futuro, citan fuentes reproducibles, pasan `npm run vault:ci`, no contienen información sensible y el PR fue revisado y fusionado manualmente.

Volver a [Home](home.md) o consultar [Mantenimiento del Vault](../08-gobernanza/mantenimiento-del-vault.md).
