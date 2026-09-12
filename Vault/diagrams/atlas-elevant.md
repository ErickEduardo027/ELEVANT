---
id: diagram-atlas-elevant
title: "Atlas general de ELEVANT"
type: diagram
area: vault
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "bea325aad4863ad85281d92ed5c005fa53f905bc"
sources:
  - AGENTS.md
  - README.md
  - docs/README.md
  - docs/architecture/repository-structure.md
tags:
  - atlas
  - conocimiento
  - navegacion
---

# Atlas general de ELEVANT

Este mapa conecta las áreas que explican ELEVANT sin convertir la documentación en una segunda fuente de verdad. Empieza en [Home](../00-inicio/home.md), comprueba la vigencia en [Estado inicial](../00-inicio/estado-inicial.md) y termina siempre en una fuente ejecutable o en evidencia explícita.

- [Abrir el Canvas interactivo](atlas-elevant.canvas)
- [Abrir la Base nativa de conocimiento](atlas-conocimiento.base)
- [Ver arquitectura y contexto](arquitectura-contexto.md)
- [Ver navegación y estados](navegacion-estado.md)

```mermaid
flowchart TB
    H[Home y preguntas] --> P[Producto y dominio]
    H --> A[Arquitectura y aplicaciones]
    H --> D[Desarrollo y contratos]
    H --> O[CI/CD y operaciones]
    H --> G[Seguridad y gobernanza]
    H --> E[Estado, historia y backlog]

    P --> WEB[Private Web · Public Web]
    P --> MOB[Mobile Agent]
    A --> WEB
    A --> MOB
    A --> API[API compartida]
    A --> DB[(Base lógica por ambiente)]
    D --> API
    D --> CONTRACT[OpenAPI y cliente generado]
    CONTRACT --> WEB
    CONTRACT -.->|integración en evolución| MOB
    O --> RELEASE[Artefactos inmutables y promoción pull-based]
    RELEASE --> API
    RELEASE --> WEB
    MOB -.->|APK/EAS pendiente| RELEASE
    RELEASE --> DB
    G --> TRUST[Fronteras de confianza y evidencia]
    TRUST --> WEB
    TRUST --> MOB
    TRUST --> API
    TRUST --> DB
    E --> CHECK{¿Está vigente y demostrado?}
    CHECK -->|Sí| SOURCE[Fuente versionada u operator-recorded]
    CHECK -->|No| LABEL[Marcar draft, deferred o unknown]

    classDef entry fill:#6c63ff,color:#fff,stroke:#4b44c7,stroke-width:2px;
    classDef system fill:#dce8ff,color:#17213a,stroke:#4f75c2;
    classDef control fill:#e5f7ef,color:#173f31,stroke:#36a579;
    classDef caution fill:#fff1d6,color:#4d3512,stroke:#d99021;
    class H entry;
    class WEB,MOB,API,DB,CONTRACT system;
    class RELEASE,TRUST,SOURCE control;
    class CHECK,LABEL caution;
```

## Cómo leerlo

1. **Orientación:** Home y los mapas de preguntas indican dónde buscar.
2. **Explicación:** producto, arquitectura y aplicaciones aportan contexto.
3. **Cambio:** desarrollo, contratos y CI/CD describen cómo evolucionar el sistema.
4. **Operación:** despliegue, seguridad y recuperación explican cómo conservarlo sano.
5. **Prueba:** el estado y la evidencia determinan si una afirmación puede usarse hoy.

La [estructura real del repositorio](../../docs/architecture/repository-structure.md) y las reglas de [`AGENTS.md`](../../AGENTS.md) prevalecen sobre este dibujo.
