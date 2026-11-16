# Arquitectura del backend

ELEVANT usa Clean Architecture dentro de un monolito modular. La solución está en `backend/Elevant.sln`; sus proyectos productivos aparecen directamente en Visual Studio, sin carpetas virtuales `src`, Core, Contracts, Infrastructure o Presentation. Solo las pruebas se agrupan bajo `tests`.

La persistencia tiene un límite físico separado en `database/DevelopmentDB`, pero sigue siendo parte de la misma solución y sirve a una sola API.

## Regla de dependencias

```text
Api ───────────────> Application ───────────────> Domain
 ├───────────────> Contracts
 ├───────────────> Infrastructure ──────────────> Application + Domain
 └───────────────> Persistence ─────────────────> Domain

DatabaseTool ─────> Persistence
```

Domain y Contracts no dependen de ningún proyecto interno. Application solo conoce Domain. Infrastructure implementa proveedores y puertos no persistentes. Persistence posee EF Core, SQL Server, Identity y el esquema. Api compone las cuatro capas. DatabaseTool verifica destinos y ejecuta exclusivamente el seed permitido de Development. Las pruebas de arquitectura exigen este grafo y rechazan ciclos.

## Proyectos productivos

### Domain

`backend/Elevant.Domain` contiene entidades, value objects, eventos e invariantes sin ASP.NET, EF Core o proveedores.

### Application

`backend/Elevant.Application` orquesta casos de uso y define puertos. No conoce HTTP, SQL Server ni implementaciones concretas.

### Contracts

`backend/Elevant.Contracts` define requests y responses públicos. No expone entidades EF; los errores siguen Problem Details.

### Infrastructure

`backend/Elevant.Infrastructure` aloja proveedores y adaptadores externos no persistentes. No contiene el DbContext ni migraciones.

### Persistence

`database/DevelopmentDB/Elevant.Persistence` implementa `ElevantDbContext`, Identity, configuraciones SQL Server y la cadena de migraciones. Los namespaces existentes se preservan para no reescribir el historial EF.

### DatabaseTool

`database/DevelopmentDB/Elevant.DatabaseTool` es un ejecutable one-shot para validar el nombre/marcador del destino y ejecutar el seed sintético únicamente en Development.

### Api

`backend/Elevant.Api` es el composition root y host HTTP: controllers, versionado, OpenAPI, CORS, Problem Details, health checks, rate limiting, forwarded headers y hubs. No migra ni siembra la base al arrancar.

## Políticas transversales

- Los errores inesperados se registran internamente y responden con 500 genérico.
- El versionado usa segmento de URL, comenzando en `/api/v1`.
- `/health` es liveness sin SQL y `/health/ready` incluye disponibilidad del contexto.
- Swagger se habilita en Development, opcionalmente en Testing y nunca en Production.
- Los proxies confiables se declaran explícitamente.
- Las abstracciones se agregan por necesidad; no se incorporan librerías especulativas.
