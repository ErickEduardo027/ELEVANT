---
id: arquitectura-indice
title: "Arquitectura ELEVANT"
type: index
area: architecture
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "pending"
sources:
  - AGENTS.md
  - backend/AGENTS.md
  - backend/README.md
  - backend/Elevant.Api/Program.cs
  - backend/tests/Elevant.ArchitectureTests/Architecture/ProjectDependencyTests.cs
  - database/AGENTS.md
  - database/DevelopmentDB/README.md
  - docs/architecture/backend-architecture.md
  - docs/architecture/database-v1.md
  - packages/api-client/README.md
tags:
  - arquitectura
  - mapa
  - backend
  - datos
---

# Arquitectura ELEVANT

Este índice explica la arquitectura comprobable de ELEVANT en el commit indicado. El sistema objetivo es un monorepositorio con tres clientes, una API .NET compartida y una base lógica por ambiente. La implementación está avanzada en modelo persistente y empaquetado técnico, pero todavía no ofrece casos de uso de negocio por HTTP.

> [!IMPORTANT]
> “Existe en el esquema”, “aparece en un prototipo” y “se puede operar mediante la API” son estados diferentes. Las notas de esta área los separan deliberadamente.

## Mapa de lectura

| Pregunta | Nota |
| --- | --- |
| ¿Qué componentes existen y dónde cambia la confianza? | [Sistema y fronteras de confianza](sistema-y-fronteras-de-confianza.md) |
| ¿Cómo se organiza el backend y qué dependencias están permitidas? | [Backend .NET, capas y dependencias](backend-dotnet-capas-y-dependencias.md) |
| ¿Quién posee el modelo SQL y cómo evolucionan los datos? | [Datos, EF Core, migraciones y persistencia](datos-ef-migraciones-y-persistencia.md) |
| ¿Qué contratos HTTP y tiempo real existen hoy? | [OpenAPI, HTTP y SignalR](openapi-http-y-signalr.md) |
| ¿Qué proveedores se consumen realmente y cuáles son solo objetivos? | [Integraciones externas](integraciones-externas.md) |
| ¿Qué decisiones gobiernan el diseño y qué riesgos siguen abiertos? | [Decisiones, restricciones y riesgos](decisiones-restricciones-y-riesgos.md) |

## Fotografía de implementación

| Capa o capacidad | Estado verificable | Lectura correcta |
| --- | --- | --- |
| Monorepositorio y tres fronteras de cliente | Implementado | Private Web, Public Web y Mobile Agent viven separados y comparten el backend y el cliente API. |
| Backend modular .NET 10 | Implementado | Siete proyectos productivos forman un grafo acíclico probado: cinco bajo `backend` y Persistence/DatabaseTool bajo `database/DevelopmentDB`. |
| Modelo persistente v1 | Implementado | EF Core, SQL Server, Identity, cinco migraciones y ocho schemas modelan la plataforma. |
| Superficie HTTP útil | Mínima | El único endpoint funcional versionado en OpenAPI es `GET /api/v1/system/ping`; health y Swagger son capacidades técnicas. |
| Casos de uso de negocio | No implementados | Application no contiene vertical slices de negocio y la API no publica controllers de negocio. |
| Autenticación y autorización de aplicación | No implementadas | Hay tablas Identity, una definición Bearer futura y `AddAuthorization`, pero no existe handler de autenticación ni protección de rutas. |
| SignalR | Shell técnico | Dos rutas de hub están mapeadas; no tienen métodos, mensajes estables ni autorización. |
| FlightAware | Frontera futura | Existe un puerto neutral y opciones; no existe adapter registrado, `HttpClient` ni tráfico real. |
| Cliente TypeScript compartido | Implementado para el contrato mínimo | El snapshot y la salida generada contienen únicamente `GetSystemPing`; los flujos de negocio de los clientes continúan en adaptadores de prototipo/mock. |
| Production | Frontera reservada | El repositorio conserva `database/ProductionDB` vacío salvo `.gitkeep`; no prueba una plataforma Production implementada. |

## Arquitectura en una vista

```mermaid
flowchart LR
    subgraph Clientes[Clientes no confiables]
        PRIV[Private Web]
        PUB[Public Web]
        MOB[Mobile Agent]
    end

    CLIENT[@elevant/api-client]

    subgraph Backend[Monolito modular .NET 10]
        API[Elevant.Api]
        APP[Elevant.Application]
        DOM[Elevant.Domain]
        CON[Elevant.Contracts]
        INF[Elevant.Infrastructure]
        PER[Elevant.Persistence]
    end

    DB[(SQL Server por ambiente)]
    EXT[Proveedor de aviación futuro]

    PRIV --> CLIENT
    PUB --> CLIENT
    MOB --> CLIENT
    CLIENT -->|HTTPS versionado| API
    API --> APP
    API --> CON
    API --> INF
    API --> PER
    APP --> DOM
    INF --> APP
    INF --> DOM
    PER --> DOM
    PER --> DB
    INF -. adapter no implementado .-> EXT
```

El diagrama expresa dependencias y límites objetivo. No afirma que los recorridos de negocio de los tres clientes ya atraviesen la API real.

## Invariantes de arquitectura

- Los clientes no importan entidades .NET, no consultan tablas y no poseen credenciales de servidor.
- La API es la única frontera prevista para datos, reglas y proveedores de aviación.
- Hay una sola base lógica compartida por ambiente, no una base ni un backend por cliente.
- `Elevant.Contracts` define formas HTTP; EF y los mocks no son contratos públicos.
- `Elevant.Api` compone dependencias, pero no debe contener reglas ni ejecutar migraciones o seed al iniciar.
- Las migraciones EF constituyen la historia del esquema normal; el bootstrap técnico crea antes el marcador inmutable del ambiente.
- Development y una futura Production son destinos físicos separados que comparten la cadena de esquema, no datos ni credenciales.
- Una integración externa nace detrás de un puerto de Application y adapta su modelo en Infrastructure.
- SignalR acelera avisos; REST y la base siguen siendo la verdad canónica.

## Cómo interpretar el estado

- **Implementado:** existe código ejecutable o una prueba que exige el comportamiento.
- **Contrato:** aparece en el OpenAPI versionado o en otra interfaz estable aprobada.
- **Prototipo:** sirve para descubrir flujos y vocabulario, pero no demuestra seguridad ni persistencia real.
- **Objetivo:** decisión aceptada o frontera preparada cuyo comportamiento todavía debe implementarse.
- **Desconocido:** falta una decisión o evidencia suficiente; no se completa por intuición.

## Verificación reproducible

La fotografía se obtuvo comparando proyectos, referencias, composición de la API, snapshot OpenAPI, DbContext y migraciones en el commit del frontmatter. Para comprobarla sin ejecutar infraestructura:

1. abre la prueba [ProjectDependencyTests](../../backend/tests/Elevant.ArchitectureTests/Architecture/ProjectDependencyTests.cs) y contrástala con los `.csproj`;
2. revisa [Program](../../backend/Elevant.Api/Program.cs) y sus extensiones de DI/pipeline;
3. inspecciona [ElevantDbContext](../../database/DevelopmentDB/Elevant.Persistence/Persistence/ElevantDbContext.cs) y la carpeta de migraciones;
4. compara [el snapshot OpenAPI](../../packages/api-client/openapi/elevant-v1.json) con controllers y contratos;
5. busca implementaciones de puertos, hubs y casos de uso, no sólo interfaces o nombres de carpetas.

Esta verificación describe el repositorio. No demuestra por sí sola el estado de un runtime o despliegue.

## Relacionados

- [Home](../00-inicio/home.md)
- [Dominio ELEVANT](../03-dominio/README.md)
- [Producto ELEVANT](../02-producto/README.md)
- [Política de evidencia](../08-gobernanza/fuentes-y-evidencia.md)
