---
id: arquitectura-indice
title: "Arquitectura ELEVANT"
type: index
area: architecture
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-11-10"
verified_commit: "39a85a46ae089239e22edce448a4d77771680b46"
sources:
  - AGENTS.md
  - backend/AGENTS.md
  - backend/README.md
  - backend/Elevant.sln
  - backend/Elevant.Api/Program.cs
  - backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs
  - backend/Elevant.Infrastructure/DependencyInjection.cs
  - backend/tests/Elevant.ArchitectureTests/Architecture/ProjectDependencyTests.cs
  - database/AGENTS.md
  - database/DevelopmentDB/README.md
  - database/DevelopmentDB/Elevant.Persistence/Persistence/ElevantDbContext.cs
  - database/ProductionDB/.gitkeep
  - docs/architecture/backend-architecture.md
  - docs/architecture/database-v1.md
  - packages/api-client/README.md
  - packages/api-client/openapi/elevant-v1.json
tags:
  - arquitectura
  - mapa
  - backend
  - datos
---

# Arquitectura ELEVANT

Este índice explica la arquitectura comprobable de ELEVANT en el commit
indicado. Es un monorepositorio con tres clientes, una API .NET compartida y
una base lógica por ambiente. La API ofrece los casos de uso de las cuatro
fases del ciclo operativo, autenticados y autorizados en el servidor, y los
tres clientes los consumen con el cliente TypeScript generado del contrato.

> [!IMPORTANT]
> «Existe en el esquema», «aparece en una pantalla», «se puede operar mediante
> la API» y «está desplegado» son estados diferentes. Las notas de esta área
> describen el código; el despliegue solo lo acredita un registro
> `operator-recorded`.

## Mapa de lectura

| Pregunta | Nota |
| --- | --- |
| ¿Qué componentes existen y dónde cambia la confianza? | [Sistema y fronteras de confianza](sistema-y-fronteras-de-confianza.md) |
| ¿Cómo se organiza el backend y qué dependencias están permitidas? | [Backend .NET, capas y dependencias](backend-dotnet-capas-y-dependencias.md) |
| ¿Quién posee el modelo SQL y cómo evolucionan los datos? | [Datos, EF Core, migraciones y persistencia](datos-ef-migraciones-y-persistencia.md) |
| ¿Qué contratos HTTP y tiempo real existen hoy? | [OpenAPI, HTTP y SignalR](openapi-http-y-signalr.md) |
| ¿Cómo se entera un cliente de que algo cambió? | [Feed de cambios operativos](feed-de-cambios-operativos.md) |
| ¿Qué proveedores se consumen realmente y cuáles son solo objetivos? | [Integraciones externas](integraciones-externas.md) |
| ¿Cómo se guardan las fotos, videos y documentos privados? | [Medios comerciales privados](medios-comerciales-privados.md) |
| ¿Qué decisiones gobiernan el diseño y qué riesgos siguen abiertos? | [Decisiones, restricciones y riesgos](decisiones-restricciones-y-riesgos.md) |

## Fotografía de implementación

| Capa o capacidad | Estado verificable | Lectura correcta |
| --- | --- | --- |
| Monorepositorio y tres fronteras de cliente | Implementado | Private Web, Public Web y Mobile Agent viven separados y comparten el backend y el cliente API. |
| Backend modular .NET 10 | Implementado | Siete proyectos productivos forman un grafo acíclico probado: cinco bajo `backend` y Persistence y DatabaseTool bajo `database/DevelopmentDB`. |
| Modelo persistente | Implementado | EF Core sobre SQL Server, Identity, 57 migraciones y ocho schemas. |
| Superficie HTTP | Amplia | 400 operaciones en OpenAPI v1, de la sesión al cobro con tarjeta ([API compartida](../05-aplicaciones/api-compartida.md)). |
| Casos de uso | Implementados por módulo | Operations, Commercial, Finance, Identity e Integration, con Problem Details, `Idempotency-Key` y versión esperada. |
| Autenticación y autorización | Implementadas | JWT con refresh rotativo, política fallback autenticada y permisos por departamento, organización y estación resueltos en SQL. |
| SignalR | Avisos `ChangedV1` | Tres hubs que solo anuncian; el cliente relee por REST. El despachador está apagado por defecto y encendido en Development. |
| Proveedores de vuelos | Adaptador AeroDataBox configurable | Apagado sin `AeroDataBox:Enabled` y clave; OpenSky también es opcional y FlightAware sigue sin adaptador. |
| Simulaciones | e-CF y pasarela de tarjeta | Marcadas «Simulación — sin validez fiscal»; la pasarela simulada no arranca fuera de Development, Test o Testing. |
| Cliente TypeScript compartido | 400 operaciones | Snapshot, salida generada y wrappers validados que consumen las tres aplicaciones. |
| Production | Frontera reservada | `database/ProductionDB` solo contiene `.gitkeep`; no hay plataforma Production implementada. |

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
    S3[(Bucket S3 privado)]
    EXT[Proveedores autorizados]

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
    PER --> S3
    INF -. configurable, apagado por defecto .-> EXT
```

## Invariantes de arquitectura

- Los clientes no importan entidades .NET, no consultan tablas y no poseen
  credenciales de servidor.
- La API es la única frontera para datos, reglas y proveedores de aviación.
- Hay una sola base lógica compartida por ambiente, no una base ni un backend
  por cliente.
- `Elevant.Contracts` define las formas HTTP; EF y los mocks no son contratos
  públicos.
- `Elevant.Api` compone dependencias, pero no contiene reglas ni ejecuta
  migraciones o seeds al iniciar.
- Las migraciones EF son la historia del esquema; el bootstrap técnico crea
  antes el marcador inmutable del ambiente.
- Development y una futura Production son destinos físicos separados que
  comparten la cadena de esquema, no datos ni credenciales.
- Una integración externa nace detrás de un puerto de Application y adapta su
  modelo en Infrastructure.
- SignalR acelera avisos; REST y la base siguen siendo la verdad canónica.

## Cómo interpretar el estado

- **Implementado:** existe código ejecutable o una prueba que exige el comportamiento.
- **Contrato:** aparece en el OpenAPI versionado o en otra interfaz estable aprobada.
- **Configurable:** el código existe y arranca apagado hasta que una configuración explícita lo enciende.
- **Simulado:** el efecto externo se imita y cada documento lo declara.
- **Objetivo:** decisión aceptada cuyo comportamiento todavía debe implementarse.
- **Desconocido:** falta una decisión o evidencia suficiente; no se completa por intuición.

## Verificación reproducible

Para comprobar la fotografía sin ejecutar infraestructura:

1. abre [ProjectDependencyTests](../../backend/tests/Elevant.ArchitectureTests/Architecture/ProjectDependencyTests.cs)
   y contrástala con [la solución](../../backend/Elevant.sln);
2. revisa [Program](../../backend/Elevant.Api/Program.cs), la
   [composición de la API](../../backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs)
   y la de [Infrastructure](../../backend/Elevant.Infrastructure/DependencyInjection.cs);
3. inspecciona [ElevantDbContext](../../database/DevelopmentDB/Elevant.Persistence/Persistence/ElevantDbContext.cs)
   y la carpeta de migraciones;
4. recorre `paths` en [el snapshot OpenAPI](../../packages/api-client/openapi/elevant-v1.json)
   y compáralo con los controllers;
5. busca implementaciones de puertos y casos de uso, no solo interfaces o
   nombres de carpetas.

Esta verificación describe el repositorio. No demuestra el estado de un
runtime o despliegue.

## Relacionados

- [Home](../00-inicio/home.md)
- [Dominio ELEVANT](../03-dominio/README.md)
- [Producto ELEVANT](../02-producto/README.md)
- [Mapa de capacidades](../02-producto/mapa-de-capacidades.md)
- [Política de evidencia](../08-gobernanza/fuentes-y-evidencia.md)
