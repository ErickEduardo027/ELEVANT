---
id: flujo-comercial-y-gobernanza
title: "Solicitud comercial y gobernanza"
type: capability
area: applications
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-26"
verified_commit: "9260622a61b6b1d32576e7559ec3e31f9f6aaf32"
sources:
  - docs/workflows/commercial-intake-and-governance.md
  - backend/Elevant.Api/Controllers/PublicCommercialRequestsController.cs
  - backend/Elevant.Api/Controllers/CommercialRequestsManagementController.cs
  - backend/Elevant.Api/Controllers/CommercialProvisioningController.cs
  - backend/Elevant.Api/Controllers/GovernanceController.cs
  - backend/Elevant.Api/Controllers/ContractDraftsController.cs
  - frontend/public-web/src/components/commercial/AccessRequestWizard.tsx
  - frontend/private-web/src/features/governance/GovernanceShell.jsx
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Seed/DevelopmentDataSeeder.cs
tags:
  - solicitud-comercial
  - contratos
  - superadministrador
  - aerolineas
---

# Solicitud comercial y gobernanza

Esta capacidad está implementada en una rama de trabajo y todavía no se ha desplegado ni aceptado operativamente en Development. El [recorrido detallado](../../docs/workflows/commercial-intake-and-governance.md) explica las decisiones, contratos HTTP y límites de los datos iniciales.

```mermaid
flowchart LR
    L[Landing: Solicitar acceso] --> S[Servicios]
    S --> A[Aerolínea predefinida]
    A --> R[Representante]
    R --> C[Contratos revisa]
    C -->|aprueba| U[Superadministrador crea acceso]
    C -->|declina| X[Solicitud rechazada]
    U --> B[Aerolínea revisa borrador]
    B --> T[Contratos ajusta y activa]
```

El catálogo público recibe nombres, textos y medios controlados por Contratos. La lista inicial de aerolíneas ofrece nombres históricos; los campos legales y logos quedan explícitamente pendientes de verificación. El representante no elige contraseña. Contratos verifica y decide; la aprobación crea un contrato en borrador. El superadministrador crea la cuenta con contraseña temporal y entrega manual. La aerolínea puede comentar el borrador y Contratos lo activa cuando cumple las condiciones de vigencia, servicios y estaciones.

El API conserva la autoridad sobre permisos de roles personalizados, identidad de la aerolínea y estado contractual. Los avisos internos se guardan en el outbox y se recuperan por cuenta; SignalR indica que se debe releer. No hay correos automáticos ni modificación del VPS como parte de esta rama.

Volver al [Mapa de aplicaciones](README.md).
