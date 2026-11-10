---
id: aplicaciones-api-compartida
title: "API compartida"
type: architecture
area: backend
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-11-10"
verified_commit: "39a85a46ae089239e22edce448a4d77771680b46"
sources:
  - global.json
  - Directory.Build.props
  - Directory.Packages.props
  - backend/AGENTS.md
  - backend/README.md
  - backend/Elevant.Api/appsettings.json
  - backend/Elevant.Api/appsettings.Development.json
  - backend/Elevant.Api/appsettings.Production.json
  - backend/Elevant.Api/Extensions/ApplicationBuilderExtensions.cs
  - backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs
  - backend/Elevant.Api/Controllers/SystemController.cs
  - backend/Elevant.Api/Controllers/AuthenticationController.cs
  - backend/Elevant.Api/Controllers/GovernanceResults.cs
  - backend/Elevant.Api/Controllers/FinanceResults.cs
  - backend/Elevant.Api/Controllers/OperationalPresenceController.cs
  - backend/Elevant.Application/Operations/OperationalPresence.cs
  - backend/Elevant.Api/Hubs/AccountChangeDispatchWorker.cs
  - backend/Elevant.Api/Hubs/HubOriginGuard.cs
  - backend/Elevant.Api/Hubs/PublicCatalogHub.cs
  - backend/Elevant.Api/Hubs/README.md
  - database/DevelopmentDB/Elevant.Persistence/Operations/MasterDataCommand.cs
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

`Elevant.Api` es la única puerta a reglas, datos e integraciones para Private
Web, Public Web y Mobile Agent. En el commit verificado publica 400
operaciones de negocio y técnicas en OpenAPI v1, con autenticación JWT y una
política que exige sesión salvo en las operaciones declaradas anónimas. Esta
nota describe el código; no acredita qué versión corre en el VPS.

## Ficha de frontera

| Dimensión | Estado verificado |
| --- | --- |
| Consumidores | Los tres clientes del repositorio, por HTTPS y con el cliente compartido `@elevant/api-client`. |
| Responsabilidad | Casos de uso, autorización por departamento, organización y estación, persistencia y adaptadores externos. |
| Forma | Monolito modular .NET 10 con capas probadas por pruebas de arquitectura. |
| Contrato | 400 operaciones en 349 rutas del [snapshot](../../packages/api-client/openapi/elevant-v1.json); la tabla de abajo las reparte por prefijo. |
| Escrituras | `Idempotency-Key` UUID en la cabecera, o `requestId` en el cuerpo en los módulos que ya lo publicaban; versión esperada (`rowversion` en Base64, `If-Match` o `expectedVersion`); Problem Details con un `code` estable. |
| Tiempo real | Tres hubs SignalR que solo anuncian cambios; el cliente relee por REST. |
| Fuera de alcance | Production, proveedor fiscal real, pasarela de tarjeta real y conciliación bancaria. |

## Stack actual

- SDK .NET 10 fijado en `global.json` y target común en `Directory.Build.props`.
- ASP.NET Core con controllers, versionado por segmento de URL y JSON camelCase.
- Swashbuckle para OpenAPI v1; Swagger se expone en Development y, con
  `Swagger:Enabled`, en Testing, nunca en Production.
- EF Core SQL Server a través del proyecto Persistence compartido.
- JWT Bearer HMAC-SHA256 de tipo `at+jwt`: cada petición comprueba además el
  sello de seguridad vigente de la cuenta en SQL.
- SignalR, almacenamiento S3 privado (`AWSSDK.S3`), PDF con PDFsharp, hojas
  OpenXML y correo por SMTP.
- xUnit v3 para pruebas unitarias, de arquitectura e integración con SQL Server.

## Capas y responsabilidades

| Proyecto | Responsabilidad | Restricción principal |
| --- | --- | --- |
| `Elevant.Domain` | Entidades, enums, catálogo de permisos y reglas puras. | Sin dependencia de framework. |
| `Elevant.Application` | Casos de uso y puertos por módulo: Operations, Commercial, Finance, Identity e Integration. | Sin infraestructura. |
| `Elevant.Contracts` | Requests y responses HTTP. | Nunca expone entidades EF. |
| `Elevant.Infrastructure` | Adaptadores de proveedores, PDF, correo y pasarela. | Detrás de puertos de Application. |
| `Elevant.Persistence` | EF Core, stores, migraciones y seed de Development. | Vive en `database/DevelopmentDB`. |
| `Elevant.Api` | Composition root: controllers, hubs, workers y OpenAPI. | No contiene reglas de dominio ni ejecuta migraciones o seeds al arrancar. |

## Superficie HTTP por prefijo

| Prefijo `/api/v1/…` | Operaciones | Qué sirve |
| --- | --- | --- |
| `finance` | 97 | Tarifarios, paquetes, reglas de cierre, «Por facturar», emisión, facturas, cobros, notas, charters, CxP, gastos, reportes e Inicio. |
| `governance` | 64 | Usuarios, perfiles y validaciones por departamento, clientes, aerolíneas, estaciones, correo y auditoría de Superadministración. |
| `occ` | 63 | Planificación, posiciones, cobertura, feed de vuelos, tráfico, datos maestros, revisión, incidencias, documentos, tabletas y reportes. |
| `human-resources` | 47 | Empleados, puestos, requisiciones, habilitaciones, carnets, turnos, disponibilidad, asistencia, agentes de rampa y reportes. |
| `contracts` y `contract-versions` | 37 | Solicitudes comerciales, catálogo, borradores, enmiendas, permisos, documentos, firmas, vigencia y ciclo de vida. |
| `airline/portal`, `airline/contract-drafts` y `airline/permits` | 30 | Portal de la aerolínea: arranque, operaciones, contratos, borradores, permisos, usuarios, facturas, cartera y tarjeta. |
| `ramp` | 23 | Tableta: operaciones asignadas, hitos, servicios, cargos, checklist, documentos, incidencias, charter, entrega y agenda. |
| `auth` | 10 | Sesión, código por correo, refresh, cierre, contraseña, activación y restablecimiento. |
| `chat` | 8 | Conversaciones de la operación y presencia. |
| `service-closures` | 4 | Clausura de servicios del catálogo. |
| `operations` | 3 | Borradores de asistencia de OCC y del agente. |
| `public` | 3 | Catálogo público y solicitudes públicas. |
| `media`, `mobile`, `notifications` y `department-notifications` | 8 | Medios privados, vínculo de la tableta y notificaciones. |
| `changes`, `commercial` y `system` | 3 | Feed de cambios por cursor, opciones de afiliación y `GET /api/v1/system/ping`. |

Son anónimas solo las operaciones de sesión, activación y restablecimiento de
cuenta, el catálogo y las solicitudes públicas, los medios publicados, las
opciones de afiliación y el ping. Fuera de OpenAPI quedan `/health`, que no
consulta dependencias, `/health/ready`, que verifica SQL, catálogo y marcador
del ambiente, y `/swagger/v1/swagger.json` donde está permitido.

## Contrato con los clientes

El [snapshot](../../packages/api-client/openapi/elevant-v1.json) es la fuente
del cliente TypeScript: Orval genera los tipos y una capa manual valida cada
respuesta y convierte los fallos en errores con el `code` de Problem Details.
Un endpoint nuevo actualiza implementación, snapshot, salida generada,
validadores y consumidores afectados; los clientes nunca importan tipos EF.
Una respuesta que lee la APK desplegada no gana claves nuevas: sus validadores
rechazan las desconocidas.

## Escrituras, versiones y errores

- **Idempotencia.** El mismo cuerpo con la misma clave devuelve el resultado
  original sin repetir auditoría, correos ni avisos; otra clave con el mismo
  cuerpo es otro intento, y la misma clave con otro cuerpo responde 409
  `idempotency_conflict`. Los comandos nuevos de Finanzas usan
  [`MasterDataCommand`](../../database/DevelopmentDB/Elevant.Persistence/Operations/MasterDataCommand.cs):
  recibo, trabajo y commit en una transacción serializable.
- **Versión esperada.** Una versión vieja responde 409 `version_conflict` y
  el cliente relee antes de formar otro intento.
- **Problem Details.** Las salidas 4xx y 5xx llevan `Extensions["code"]`
  ([GovernanceResults](../../backend/Elevant.Api/Controllers/GovernanceResults.cs));
  una ruta de Finanzas retirada que un cliente viejo aún llama responde 410
  `legacy_finance_route_retired` ([FinanceResults](../../backend/Elevant.Api/Controllers/FinanceResults.cs)).
  Una excepción inesperada produce un 500 genérico con `traceId`, sin texto
  interno.

## Tiempo real

| Hub | Quién se conecta | Qué recibe |
| --- | --- | --- |
| `/hubs/operations` | Cuentas autenticadas | `ChangedV1` con un `eventId` para los recursos operativos y de Finanzas. |
| `/hubs/notifications` | Cuentas autenticadas | `ChangedV1` con un `eventId` para las notificaciones. |
| `/hubs/public-catalog` | Cualquiera | `CatalogChangedV1` sin datos, cuando cambia el catálogo publicado. |

El aviso no lleva contenido: el cliente pide `GET /api/v1/changes` con su
cursor y después relee el recurso con sus permisos vigentes. El despachador
que proyecta el outbox y emite `ChangedV1`
([worker](../../backend/Elevant.Api/Hubs/AccountChangeDispatchWorker.cs)) se
enciende con `Realtime:AccountChangeDispatcherEnabled`, que es `false` por
defecto y `true` en `appsettings.Development.json`. Un navegador solo abre un
WebSocket desde un origen de la allowlist
([guarda de origen](../../backend/Elevant.Api/Hubs/HubOriginGuard.cs)). La
lista de «eventos futuros» del [README de hubs](../../backend/Elevant.Api/Hubs/README.md)
está desfasada frente a ese código. Detalle en el
[feed de cambios](../04-arquitectura/feed-de-cambios-operativos.md).

## Configuración segura

| Grupo | Propósito | Regla |
| --- | --- | --- |
| Connection string y ambiente | Conectar al catálogo físico correcto. | Valor fuera de Git; identidad de aplicación de privilegio mínimo. |
| `Authentication:*` | Emisor, audiencia, clave de firma y duración del access token. | La API no arranca sin una clave válida; nunca se versiona. |
| CORS | Orígenes exactos de las dos webs. | Mobile nativo no depende de CORS; CORS no autentica. |
| Rate limiting | Ventana fija por dirección de la conexión, con un límite menor para crear sesiones. | Protección técnica, no autorización. |
| `CardPayments:Mode` | Pasarela de tarjeta. | `Disabled` por defecto; `Simulated` solo arranca en Development, Test o Testing. |
| `AeroDataBox:*` y `OpenSky:*` | Proveedores de vuelos y tráfico. | Apagados por defecto; la clave solo llega por configuración secreta. |
| SMTP y almacenamiento S3 | Correo y bytes privados. | Secretos fuera de Git. |

Los archivos `appsettings*.json` y `.env.example` contienen forma y
placeholders seguros. No copies valores reales a documentación, logs ni
imágenes.

## Presencia operativa

El [controlador](../../backend/Elevant.Api/Controllers/OperationalPresenceController.cs)
lee la presencia de las operaciones que el lector ya puede ver y actualiza el
lease del propio sujeto JWT. El [registro](../../backend/Elevant.Application/Operations/OperationalPresence.cs)
vive en memoria: 90 s de expiración, 5 min de actividad y 24 h de retención,
más el estado elegido por la propia cuenta y un mensaje de hasta 80
caracteres. Se pierde al reiniciar la API y presupone una sola instancia.

## Validación local

Los comandos de restauración, compilación, pruebas y deriva del modelo EF
viven en [CLAUDE.md](../../CLAUDE.md) y en el [README del backend](../../backend/README.md).
Las pruebas SQL usan una instancia real cuando está configurada; si no, CI es
la autoridad.

## Brechas reales

- Production no existe: necesita su propio plan.
- El e-CF y la pasarela de tarjeta son simulaciones; no hay proveedor fiscal
  ni pasarela reales.
- No hay conciliación bancaria ni obtención automática de tasas.
- Algunos comandos aceptan todavía la `Idempotency-Key` opcional, a la espera
  del paso «contract» ([brechas](../03-dominio/brechas-y-preguntas-abiertas.md)).

## Fuentes y relaciones

- [README del backend](../../backend/README.md) y [contrato OpenAPI](../../docs/api/openapi-contract.md)
- [Composición de servicios](../../backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs) y [pipeline](../../backend/Elevant.Api/Extensions/ApplicationBuilderExtensions.cs)
- [OpenAPI, HTTP y SignalR](../04-arquitectura/openapi-http-y-signalr.md)
- [DevelopmentDB compartida](developmentdb-compartida.md)
- [Fronteras de clientes](../02-producto/fronteras-de-clientes.md)
- [Mapa de aplicaciones](README.md)
