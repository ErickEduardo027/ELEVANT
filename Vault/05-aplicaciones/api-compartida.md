---
id: aplicaciones-api-compartida
title: "API compartida"
type: architecture
area: backend
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "c2a060179983a13b7e5a0dd45cba1a1fd2e54e8a"
sources:
  - global.json
  - Directory.Build.props
  - Directory.Packages.props
  - backend/AGENTS.md
  - backend/README.md
  - backend/Elevant.Api/appsettings.json
  - backend/Elevant.Api/appsettings.Production.json
  - backend/Elevant.Api/Controllers/V1/SystemController.cs
  - backend/Elevant.Api/Extensions/ApplicationBuilderExtensions.cs
  - backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs
  - backend/Elevant.Api/Hubs/README.md
  - packages/api-client/openapi/elevant-v1.json
  - docs/api/openapi-contract.md
tags:
  - aplicaciones
  - backend
  - api
  - dotnet
  - openapi
---

# API compartida

`Elevant.Api` es la única puerta de aplicación a reglas, datos e integraciones para Private Web, Public Web y Mobile Agent. El host existe y está probado como scaffold técnico; no implementa todavía autenticación ni casos de uso de negocio.

## Ficha de frontera

| Dimensión | Estado verificado |
| --- | --- |
| Consumidores | Los tres clientes del repositorio mediante HTTPS y el contrato versionado. |
| Responsabilidad objetivo | Alojar casos de uso, autorización, tenant/station scope, persistencia y adaptadores externos; esa capacidad de negocio aún no está implementada de extremo a extremo. |
| Forma | Monolito modular .NET 10 con capas explícitas. |
| Contrato actual | Health/readiness técnicos y `GET /api/v1/system/ping`; OpenAPI contiene solo el ping como operación pública de aplicación. |
| Tiempo real | Dos hubs SignalR vacíos/reservados; los eventos listados son futuros y no estables. |
| Madurez | Infraestructura funcional con dominio/persistencia amplios, pero superficie funcional mínima. |

## Stack actual

- SDK y target .NET 10 fijados desde `global.json` y `Directory.Build.props`.
- ASP.NET Core con controllers, API versioning por segmento de URL y JSON camelCase.
- Swashbuckle/OpenAPI v1 para contrato y Swagger en ambientes permitidos.
- EF Core SQL Server a través del proyecto Persistence compartido.
- SignalR para puntos de conexión reservados.
- Problem Details, health checks, CORS, rate limiting y forwarded headers configurables.
- xUnit para pruebas unitarias, de arquitectura e integración.

## Capas y responsabilidades

| Proyecto | Responsabilidad | Restricción principal |
| --- | --- | --- |
| `Elevant.Domain` | Entidades, enums y reglas puras. | Sin dependencia de framework. |
| `Elevant.Application` | Casos de uso y puertos. | Organizar features como vertical slices; no infraestructura. |
| `Elevant.Contracts` | Requests/responses HTTP públicos. | No exponer entidades EF ni inferir DTOs de fixtures. |
| `Elevant.Infrastructure` | Adaptadores externos no persistentes. | Proveedores quedan detrás de puertos de Application. |
| `Elevant.Persistence` | EF Core, SQL Server, mappings y migraciones. | Vive en `database/DevelopmentDB`; no en la ruta de clientes. |
| `Elevant.Api` | Composition root, middleware y transporte HTTP/SignalR. | No contiene reglas de dominio ni ejecuta migraciones/seeds al arrancar. |

## Superficie HTTP actual

| Ruta | Estado | Qué demuestra |
| --- | --- | --- |
| `/health` | Actual | El proceso HTTP responde; no consulta dependencias. |
| `/health/ready` | Actual | Verifica SQL, catálogo esperado y marcador del ambiente mediante el health check registrado. |
| `/api/v1/system/ping` | Actual y contractual | Operación pública v1 con respuesta técnica y errores documentados. |
| `/swagger/v1/swagger.json` | Actual en Development/Testing configurado | Documento OpenAPI que alimenta el cliente generado. No se expone en Production. |
| `/hubs/operations` | Reservada | Punto SignalR vacío; no existen eventos funcionales publicados. |
| `/hubs/notifications` | Reservada | Punto SignalR vacío; no existen eventos funcionales publicados. |

La presencia de entidades de dominio, tablas o hubs no crea por sí sola endpoints de vuelos, contratos, usuarios, mobile o finanzas.

## Contrato con los clientes

`packages/api-client/openapi/elevant-v1.json` es el snapshot canónico para TypeScript y en el commit verificado solo contiene `/api/v1/system/ping`. Orval genera `@elevant/api-client`, compartido por las tres aplicaciones. Un endpoint nuevo debe actualizar implementación, OpenAPI, snapshot, salida generada y consumidores afectados; los clientes nunca importan tipos EF.

REST conserva la autoridad del estado. Los eventos SignalR futuros pueden avisar de un cambio, pero después de reconectar el cliente vuelve a consultar REST y tolera duplicados/desorden.

## Configuración segura

| Grupo | Propósito | Regla |
| --- | --- | --- |
| Connection string + ambiente | Conectar al único catálogo físico correcto. | Valor fuera de Git; identidad de aplicación de privilegio mínimo, nunca `sa`/migrator. |
| CORS | Autorizar orígenes exactos de las dos webs. | Mobile nativo no depende de CORS; CORS tampoco autentica. |
| Forwarded headers | Interpretar proxy conocido. | Solo habilitar con proxy/red explícitamente confiable. |
| Rate limiting | Límite fijo por origen de conexión. | Protección técnica, no reemplaza cuotas o autorización de negocio. |
| Swagger | Diagnóstico/contrato en Development y Testing. | Desactivado en Production. |
| Integraciones/autenticación | Espacios de configuración reservados. | Secretos fuera de Git; su presencia en settings no prueba implementación. |

Los archivos `.env.example` y `appsettings*.json` contienen forma y placeholders seguros. No copies valores reales a documentación, logs ni imágenes.

## Desarrollo local y validación

Desde la raíz:

```powershell
dotnet tool restore
dotnet restore backend/Elevant.sln --locked-mode
dotnet build backend/Elevant.sln --configuration Release --no-restore
dotnet test backend/Elevant.sln --configuration Release --no-build
dotnet ef migrations has-pending-model-changes `
  --project database/DevelopmentDB/Elevant.Persistence `
  --startup-project backend/Elevant.Api `
  --context ElevantDbContext `
  --configuration Release `
  --no-build
```

También existe `backend/scripts/restore-build-test.ps1` como envoltorio. Las pruebas SQL usan una variable de conexión de test o LocalDB cuando aplica; CI es autoridad para la ruta con SQL Server en contenedor.

## Cobertura de pruebas actual

- arquitectura de dependencias entre proyectos;
- entidades base del dominio;
- ping, diagnósticos y health probes;
- target guard y readiness del catálogo;
- modelo EF, política de migraciones y migraciones sobre SQL Server;
- manifiesto y guard de publicación de la imagen API.

No existen pruebas de autenticación ni endpoints de negocio porque esas capacidades todavía no están implementadas.

## Brechas y desconocidos

- **Brecha actual:** falta autenticación, emisión/validación de sesión y políticas de autorización.
- **Brecha actual:** no hay vertical slices ni controllers de negocio aprobados.
- **Brecha actual:** hubs no publican eventos y no constituyen contrato.
- **Brecha actual:** el adaptador FlightAware está reservado, sin `HttpClient` ni implementación registrada.
- **Brecha actual:** object storage para evidencias no está diseñado.
- **Desconocido:** orden de endpoints, proveedor de identidad y alcance de la primera versión funcional; deben decidirse por necesidad de producto y contrato.

## Fuentes y relaciones

- [README del backend](../../backend/README.md)
- [Contrato OpenAPI](../../docs/api/openapi-contract.md)
- [Cliente API compartido](../../packages/api-client/README.md)
- [DevelopmentDB compartida](developmentdb-compartida.md)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [Mapa de aplicaciones](README.md)
