---
id: diagram-arquitectura-contexto
title: "Arquitectura y contexto inicial"
type: diagram
area: architecture
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "bea325aad4863ad85281d92ed5c005fa53f905bc"
sources:
  - AGENTS.md
  - docs/architecture/overview.md
  - docs/deployment/environments.md
  - docs/deployment/dokploy.md
tags:
  - arquitectura
  - contexto
  - development
---

# Arquitectura y contexto inicial

ELEVANT conserva una sola API y una sola base lógica por ambiente. Los tres clientes son fronteras independientes de experiencia, no backends ni bases separadas. El [Canvas interactivo](arquitectura-contexto.canvas) permite recorrer las relaciones espacialmente.

```mermaid
flowchart LR
    subgraph PEOPLE[Personas]
        INTERNAL[Personal interno AVIAM]
        CUSTOMER[Clientes y aerolíneas]
        RAMP[Agentes de rampa]
        OPERATOR[Operaciones autorizadas]
    end

    subgraph CLIENTS[Clientes no confiables]
        PRIVATE[Private Web]
        PUBLIC[Public Web]
        MOBILE[Mobile Agent]
    end

    subgraph PLATFORM[Plataforma ELEVANT por ambiente]
        API[API .NET compartida]
        DB[(SQL Server · base lógica compartida)]
        EXT[Adaptadores a proveedores autorizados]
        CONTROL[Control plane privado]
        SQLTOOLS[Acceso SQL humano controlado]
    end

    INTERNAL --> PRIVATE
    CUSTOMER --> PUBLIC
    RAMP --> MOBILE
    PRIVATE -->|HTTPS · OpenAPI| API
    PUBLIC -->|HTTPS · OpenAPI| API
    MOBILE -->|HTTPS · OpenAPI| API
    API -->|Persistencia| DB
    API -.->|Tras puertos, apagados por defecto| EXT
    OPERATOR -->|Acceso privado| CONTROL
    OPERATOR -->|Acceso privado y personal| SQLTOOLS
    CONTROL -->|Promoción DB pull-based| DB
    CONTROL -->|Promoción API pull-based| API
    CONTROL -->|Promoción pull-based| PRIVATE
    CONTROL -->|Promoción pull-based| PUBLIC
    SQLTOOLS -->|CRUD sintético acotado| DB

    subgraph FUTURE[Production futura y separada · no desplegada]
        PROD[Infraestructura, secretos, datos y promoción propios]
    end

    classDef people fill:#f4e9ff,color:#332044,stroke:#9a63c7;
    classDef client fill:#dce8ff,color:#17213a,stroke:#4f75c2;
    classDef core fill:#e5f7ef,color:#173f31,stroke:#36a579,stroke-width:2px;
    classDef future fill:#fff1d6,color:#4d3512,stroke:#d99021,stroke-dasharray:5 5;
    class INTERNAL,CUSTOMER,RAMP,OPERATOR people;
    class PRIVATE,PUBLIC,MOBILE client;
    class API,DB,EXT,CONTROL,SQLTOOLS core;
    class PROD future;
```

*Posterior al commit verificado de esta nota (código de `39a85a46`):* Mobile Agent también consume la API con el cliente compartido, y los adaptadores a proveedores externos arrancan apagados hasta que una configuración explícita los enciende.

## Límites que el mapa hace explícitos

- Ningún cliente accede directamente a SQL Server ni a proveedores externos.
- Private Web y Public Web tienen imágenes y carriles de entrega independientes, pero consumen la misma API.
- Mobile Agent se distribuye como aplicación nativa y no se aloja en Dokploy.
- El acceso SQL humano pertenece sólo a Development, es privado y no sustituye migraciones revisadas.
- Production requiere infraestructura, secretos, datos, backups y promoción separados; hoy permanece diferida.

Amplía el contexto en [Arquitectura general](../../docs/architecture/overview.md), [Ambientes](../../docs/deployment/environments.md) y [Development en Dokploy](../../docs/deployment/dokploy.md).

Volver a [Home](../00-inicio/home.md) o al [Atlas general](atlas-elevant.md).
