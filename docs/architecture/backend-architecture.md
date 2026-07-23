# Arquitectura del backend

El backend usa Clean Architecture dentro de un monolito modular. Toda la unidad
del servidor se encuentra en `backend`: solución y configuración .NET, proyectos,
pruebas, material de base de datos, infraestructura y scripts.

## Regla de dependencias

```text
Api ───────────────> Application ───────────────> Domain
 ├───────────────> Contracts
 └───────────────> Infrastructure ──────────────> Application
                                      └─────────> Domain
```

La flecha expresa una referencia de proyecto. Domain y Contracts no dependen de
ningún otro proyecto interno. Application solo conoce Domain. Infrastructure
implementa puertos de Application y puede conocer Domain. Api conoce Application,
Contracts e Infrastructure para componer el proceso. En consecuencia,
el núcleo nunca conoce ASP.NET Core, EF Core, SQL Server, Docker o proveedores.
Las pruebas de arquitectura impiden inversiones no autorizadas o ciclos.

## Proyectos productivos

### Domain

`backend/src/Elevant.Domain` contiene invariantes y abstracciones de dominio sin ASP.NET, EF Core o proveedores. El scaffold ofrece una entidad base genérica, eventos de dominio y una excepción base, pero no inventa entidades Elevant.

### Application

`backend/src/Elevant.Application` orquesta casos de uso y define puertos consumidos por estos. Trabaja con modelos internos y `CancellationToken`. No conoce códigos HTTP, SQL Server ni implementaciones concretas.

### Contracts

`backend/src/Elevant.Contracts` define requests y responses públicos, independientes del dominio y de la persistencia. La base incluye paginación y la respuesta de ping. Los errores siguen Problem Details en vez de un sobre propietario.

### Infrastructure

`backend/src/Elevant.Infrastructure` implementa `ElevantDbContext`, persistencia SQL Server e integraciones externas. El contexto aún no tiene `DbSet`. Las migraciones se alojan aquí y se ejecutan fuera del arranque.

### Api

`backend/src/Elevant.Api` es el composition root y host HTTP: controllers, versionado, OpenAPI, CORS, Problem Details, health checks, rate limiting, forwarded headers y hubs. Mantiene controllers delgados y no expone configuración sensible.

## Políticas transversales

- Los errores inesperados se registran internamente y responden con 500 genérico.
- El versionado usa segmento de URL, comenzando en `/api/v1`.
- `/health` es liveness sin SQL y `/health/ready` incluye disponibilidad del contexto.
- Swagger se habilita en Development, opcionalmente en Testing y nunca en Production.
- El rate limit se aplica a endpoints de API, no a health checks ni hubs.
- Los proxies confiables se declaran explícitamente; no se confía en cualquier header reenviado.

Las abstracciones se agregan por necesidad. El scaffold no incorpora mediator, mapper, scheduler o resiliencia HTTP antes de un caso real.
