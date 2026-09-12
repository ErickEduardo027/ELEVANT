---
id: diagram-arquitectura-aplicaciones-desarrollo
title: "Arquitectura, aplicaciones y desarrollo"
type: diagram
area: architecture
status: documented
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "pending"
sources:
  - AGENTS.md
  - Vault/04-arquitectura/README.md
  - Vault/05-aplicaciones/README.md
  - Vault/06-desarrollo/README.md
  - Vault/diagrams/arquitectura-aplicaciones-desarrollo.canvas
  - Vault/diagrams/arquitectura-aplicaciones-desarrollo.base
tags:
  - arquitectura
  - aplicaciones
  - desarrollo
  - navegacion
---

# Arquitectura, aplicaciones y desarrollo

Este mapa conecta tres preguntas que deben responderse juntas antes de modificar ELEVANT: **dónde pertenece el comportamiento**, **qué frontera lo consume** y **qué evidencia demuestra que el cambio es seguro**.

- [Abrir el Canvas interactivo](arquitectura-aplicaciones-desarrollo.canvas)
- [Abrir la Base filtrable de las notas 04, 05 y 06](arquitectura-aplicaciones-desarrollo.base)

> [!IMPORTANT]
> El Canvas es una ruta de exploración, no una afirmación de que todos los recorridos estén integrados. El OpenAPI vigente sólo contiene la superficie contractual mínima; los perfiles de aplicación indican dónde todavía hay mocks o adaptadores prototípicos.

## Sistema y ciclo de cambio

```mermaid
flowchart LR
    subgraph CLIENTES[Clientes no confiables]
        PRIVATE[Private Web]
        PUBLIC[Public Web]
        MOBILE[Mobile Agent]
    end

    CONTRACT[@elevant/api-client\ndesde OpenAPI]

    subgraph BACKEND[Monolito modular .NET]
        API[Elevant.Api]
        APP[Elevant.Application]
        DOMAIN[Elevant.Domain]
        INFRA[Elevant.Infrastructure]
        PERSIST[Elevant.Persistence]
    end

    DB[(SQL Server\nbase lógica por ambiente)]
    CHANGE[Rama desde Development]
    TEST[Checks del subárbol\ncontrato y compatibilidad]
    PR[PR manual]
    VAULT[Evidencia + Vault]

    PRIVATE --> CONTRACT
    PUBLIC --> CONTRACT
    MOBILE -. integración en evolución .-> CONTRACT
    CONTRACT --> API
    API --> APP
    APP --> DOMAIN
    API --> INFRA
    API --> PERSIST
    PERSIST --> DB

    CHANGE --> TEST --> PR --> VAULT
    TEST -. comprueba .-> CONTRACT
    TEST -. comprueba .-> BACKEND
    TEST -. comprueba .-> DB
```

## Adyacencia legible sin el gráfico

| Desde | Hacia | Regla verificable |
| --- | --- | --- |
| Private Web, Public Web y Mobile Agent | `@elevant/api-client` | El contrato compartido proviene de OpenAPI; un mock o tipo local no lo reemplaza. |
| Cliente API | `Elevant.Api` | HTTP versionado; la identidad y los scopes deben resolverse en servidor cuando se implementen. |
| API | Application, Contracts, Infrastructure y Persistence | API es composition root; no debe concentrar reglas de dominio ni ejecutar migraciones al iniciar. |
| Application/Infrastructure/Persistence | Domain | Las dependencias apuntan hacia el núcleo; las pruebas de arquitectura fijan el grafo exacto. |
| Persistence | SQL Server | EF Core y sus migraciones son la fuente ejecutable del esquema. Ningún cliente accede directamente. |
| Cambio local | Tests y contratos | La validación depende de los subárboles afectados y de los límites que cruza el cambio. |
| PR | Handoff y Vault | El resultado declara pruebas, riesgos, documentación y aquello que no fue desplegado. |

## Cómo recorrer el Canvas

1. Empieza en **Arquitectura** para ubicar la regla y la frontera de confianza.
2. Abre **Aplicaciones** para comprobar el consumidor y su madurez real.
3. Revisa **Contrato y datos** antes de cambiar HTTP o persistencia.
4. Sigue **Desarrollo** desde preparación hasta Definition of Done.
5. Termina en **Evidencia** para verificar fuentes, estado y trabajo todavía diferido.

Las columnas usan color y texto; ninguna relación depende sólo del color. La [Base filtrable](arquitectura-aplicaciones-desarrollo.base) consulta las notas de Arquitectura, Aplicaciones y Desarrollo por área, tipo, estado y evidencia; no incluye las tarjetas externas de referencia. El índice siguiente permite abrir **todas** las tarjetas sin Canvas ni Base. La nota de DevelopmentDB aparece deliberadamente en dos carriles: perfil de aplicación y frontera de datos, no dos bases distintas.

## Índice completo de tarjetas

### 01 · Arquitectura

- [Mapa de Arquitectura](../04-arquitectura/README.md)
- [Sistema y fronteras de confianza](../04-arquitectura/sistema-y-fronteras-de-confianza.md)
- [Capas y dependencias .NET](../04-arquitectura/backend-dotnet-capas-y-dependencias.md)
- [Integraciones externas](../04-arquitectura/integraciones-externas.md)
- [Decisiones, restricciones y riesgos](../04-arquitectura/decisiones-restricciones-y-riesgos.md)
- [Arquitectura de contexto](arquitectura-contexto.md)

### 02 · Aplicaciones

- [Mapa de Aplicaciones](../05-aplicaciones/README.md)
- [Private Web AVIAM](../05-aplicaciones/private-web-aviam.md)
- [Public Web y portal](../05-aplicaciones/public-web-portal.md)
- [Mobile Agent](../05-aplicaciones/mobile-agent.md)
- [API compartida](../05-aplicaciones/api-compartida.md)
- [DevelopmentDB compartida](../05-aplicaciones/developmentdb-compartida.md)

### 03 · Contrato y datos

- [OpenAPI, HTTP y SignalR](../04-arquitectura/openapi-http-y-signalr.md)
- [Guía de cambio OpenAPI y cliente](../06-desarrollo/openapi-y-cliente-compartido.md)
- [Paquete API client](../../packages/api-client/README.md)
- [Datos, EF y migraciones](../04-arquitectura/datos-ef-migraciones-y-persistencia.md)
- [DevelopmentDB como frontera de datos](../05-aplicaciones/developmentdb-compartida.md)
- [Entidades y relaciones v1](../03-dominio/entidades-y-relaciones-v1.md)

### 04 · Desarrollo

- [Mapa de Desarrollo](../06-desarrollo/README.md)
- [Preparación del entorno local](../06-desarrollo/preparacion-del-entorno-local.md)
- [Comandos por subárbol](../06-desarrollo/comandos-locales-por-subarbol.md)
- [Flujo de rama y PR](../06-desarrollo/flujo-de-rama-y-pull-request.md)
- [Cambio seguro por tipo](../06-desarrollo/cambio-seguro-por-tipo.md)
- [Migraciones y datos](../06-desarrollo/migraciones-y-datos.md)
- [Pruebas, calidad y frontera CI](../06-desarrollo/pruebas-calidad-y-frontera-ci.md)
- [Definition of Done y handoff](../06-desarrollo/definition-of-done-y-handoff.md)

### 05 · Evidencia

- [Este companion accesible](arquitectura-aplicaciones-desarrollo.md)
- [Base filtrable](arquitectura-aplicaciones-desarrollo.base)
- [Home](../00-inicio/home.md)
- [Estado inicial](../00-inicio/estado-inicial.md)
- [Fuentes y evidencia](../08-gobernanza/fuentes-y-evidencia.md)
- [Roadmap y brechas](../00-inicio/roadmap-del-vault.md)

## Límites visibles

- Una pantalla ejecutable no prueba que exista un caso de uso de negocio en la API.
- Una tabla existente no prueba endpoint, autorización ni coherencia completa del workflow.
- La privacidad de red de Development no sustituye autenticación, RBAC o aislamiento tenant/station.
- Mobile Agent es una aplicación nativa; su entrega APK/EAS pertenece a la etapa de entrega y operaciones.
- Production sigue siendo una frontera futura separada y no queda autorizada por este mapa.

Volver a [Home](../00-inicio/home.md), al [Atlas general](atlas-elevant.md) o abrir los índices de [Arquitectura](../04-arquitectura/README.md), [Aplicaciones](../05-aplicaciones/README.md) y [Desarrollo](../06-desarrollo/README.md).
