---
id: arquitectura-decisiones-restricciones-riesgos
title: "Decisiones, restricciones y riesgos"
type: decision
area: architecture
status: verified
maturity: evolving
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-16"
verified_commit: "f533cf2b20c1ded9b68fb10d6edcf2d622551ac4"
sources:
  - docs/adr/0001-use-monorepo.md
  - docs/adr/0002-use-dotnet-10.md
  - docs/adr/0003-use-modular-monolith.md
  - docs/adr/0004-centralize-external-api-access.md
  - docs/adr/0005-use-remote-development-api.md
  - docs/adr/0006-separate-development-and-production.md
  - docs/adr/0007-api-client-generation.md
  - docs/adr/0013-development-ssms-data-access.md
  - docs/adr/0014-bind-api-releases-to-openapi-fingerprint.md
  - .github/workflows/backend-ci.yml
  - .github/workflows/web-ci.yml
  - packages/api-client/openapi/source.json
  - packages/api-client/scripts/snapshot-utils.mjs
  - frontend/scripts/deployment/resolve-api-release.sh
  - scripts/release/path-ownership.sh
  - backend/tests/Elevant.ArchitectureTests/Architecture/ProjectDependencyTests.cs
  - backend/Elevant.Api/Extensions/ServiceCollectionExtensions.cs
  - backend/Elevant.Api/Extensions/ApplicationBuilderExtensions.cs
  - backend/Elevant.Application/DependencyInjection.cs
  - backend/Elevant.Domain/DomainEvents/IDomainEvent.cs
  - backend/Elevant.Infrastructure/Integrations/FlightAware/FlightAwareClient.cs
  - database/DevelopmentDB/Elevant.Persistence/Persistence/Configurations/PlatformConfiguration.cs
  - docs/architecture/backend-architecture.md
  - docs/architecture/modular-monolith.md
  - docs/architecture/overview.md
  - docs/architecture/system-overview.md
  - docs/security/database-access.md
tags:
  - arquitectura
  - decisiones
  - restricciones
  - riesgos
  - deuda-tecnica
---

# Decisiones, restricciones y riesgos

Esta nota resume decisiones aceptadas y las contrasta con el código vigente. Una ADR expresa intención; sólo el código y las pruebas demuestran cuánto está implementado. Los riesgos enumerados no significan que el scaffold sea defectuoso: muestran qué falta antes de convertir el modelo y los prototipos en un producto autorizado de extremo a extremo.

## Decisiones aceptadas y grado de materialización

| Decisión | Estado en el repositorio | Límite actual |
| --- | --- | --- |
| ADR-0001 · Monorepositorio | Implementada | Un solo repo contiene backend, tres clientes, paquete API, DB, docs y ops. Los límites aún dependen de reglas y revisión además de carpetas. |
| ADR-0002 · .NET 10 | Implementada | SDK, target, paquetes centrales y lockfiles están fijados; cada cambio debe seguir compilando/probando esa línea. |
| ADR-0003 · Monolito modular | Implementada | Un proceso API y grafo de proyectos acíclico. *Posterior al commit verificado (código de `39a85a46`):* los módulos Operations, Commercial, Finance, Identity e Integration tienen sus casos de uso. |
| ADR-0004 · APIs externas centralizadas | Frontera implementada | *Posterior al commit verificado:* el feed AeroDataBox ([ADR-0028](../../docs/adr/0028-aerodatabox-flight-feed-with-unit-budget.md)) y el tráfico OpenSky pasan por el servidor, apagados por defecto; FlightAware sigue sin transporte. |
| ADR-0005 · API remota de Development | Decisión arquitectónica aceptada | Los clientes tienen configuración para un origen remoto; esta nota no certifica el estado de un host vivo. |
| ADR-0006 · Development/Production separados | Guardas y límites de repo implementados | Development tiene tooling; Production sigue reservada y requiere diseño/rollout independiente. |
| ADR-0007 · Cliente TypeScript generado | Implementada | Snapshot, descriptor, Orval y wrappers existen. *Posterior al commit verificado:* el snapshot publica 400 operaciones y los tres clientes las consumen. |
| ADR-0014 · Release API ligada a fingerprint OpenAPI | Implementada en CI/CD | Descriptor, snapshot, Swagger y etiqueta OCI deben coincidir; la huella prueba igualdad canónica, no compatibilidad semántica ni una atestación externa. |

Los ADR-0008 a ADR-0013 sobre empaquetado y operación de Development
pertenecen principalmente a CI/CD y Operaciones. ADR-0014 sí aparece aquí
porque separa identidad del contrato y procedencia de release. Ninguna de estas
decisiones se usa para inferir disponibilidad, despliegue o recuperación de un
runtime vivo.

## Restricciones no negociables

### Producto y confianza

- Los tres clientes deben consumir una única API, propietaria de una única base lógica por ambiente; posterior al commit verificado, solo quedan adaptadores heredados del prototipo en partes de Private Web.
- Ningún cliente consulta SQL Server ni un proveedor de aviación directamente.
- Tenant, estación, agente y permisos se derivan y validan en servidor; nunca se confía en un ID o rol del cliente. Posterior al commit verificado, ese enforcement HTTP existe en cada caso de uso.
- Los mocks, storage de navegador y outbox del dispositivo no son fuentes canónicas.

### Código

- Domain no depende de proyectos ELEVANT ni frameworks de infraestructura.
- Application sólo depende de Domain.
- Contracts no depende de otros proyectos ELEVANT y no expone entidades EF.
- Infrastructure depende de Application/Domain; Persistence depende de Domain.
- Api es composition root, no capa de reglas.
- DatabaseTool es one-shot y no entra en el request path.

### Datos y contratos

- EF Core migrations son la historia del esquema normal.
- API no migra ni siembra al arrancar.
- Migraciones no transportan DML de negocio; Development seed es explícito y Production no se siembra.
- OpenAPI gobierna el contrato cliente/servidor sólo para operaciones existentes.
- `source.json` identifica el contrato mediante versión, ruta y fingerprint;
  commit, run e imagen se obtienen del manifiesto OCI inmutable de la release.
- Cambios incompatibles requieren versión o rollout API-first coordinado; cliente y API pueden desplegarse de forma independiente.
- REST conserva la verdad; SignalR no constituye confirmación durable.

### Integraciones y secretos

- Un proveedor externo se encapsula detrás de un puerto neutral y adapter de Infrastructure.
- Credenciales, tokens y cadenas de conexión entran desde configuración privada y no se hornean en bundles o contratos.
- Errores y observabilidad no filtran secretos, bodies externos ni PII.

## Mecanismos de enforcement

| Regla | Enforcement actual | Cobertura |
| --- | --- | --- |
| Grafo de proyectos y ausencia de ciclos | `ProjectDependencyTests` | Automática y exacta a nivel de `ProjectReference`. |
| Modelo SQL, no-cascade y convenciones críticas | Pruebas de integración de Persistence | Automática para invariantes enumeradas; no para toda regla de negocio. |
| Destino de DB | Guard de ambiente/nombre/confirmación + marker | Automática en tooling/readiness. |
| Contrato HTTP | Pruebas HTTP de integración + snapshot OpenAPI | Automática; posterior al commit verificado cubre las operaciones de negocio además de `GetSystemPing`. |
| Unión contrato/release | Igualdad descriptor/snapshot/Swagger, etiqueta OCI, política de paths y resolver de linaje | Automática para identidad canónica y procedencia exacta; no juzga compatibilidad semántica. |
| Separación DTO/EF y controllers delgados | Reglas AGENTS + revisión | No hay analizador que impida toda violación dentro de Api. |
| Tenant/RBAC/station scope | Casos de uso, catálogo de permisos y pruebas SQL de aislamiento | Posterior al commit verificado: enforcement HTTP en cada caso de uso; la cobertura de pruebas negativas sigue siendo por caso. |
| Historial append-only | Tablas/eventos y algunas restricciones | No existe una garantía universal contra `UPDATE`/`DELETE`. |

## Riesgos priorizados

Posterior al commit verificado de esta nota, el código de `39a85a46` cerró R1,
R2, R4 y R5 y cambió R6; cada riesgo conserva su texto original y una línea
de estado con la evidencia.

### R1 · Autenticación y autorización ausentes — cerrado

En el commit verificado había tablas Identity y un esquema Bearer futuro, pero no pipeline de autenticación ni rutas protegidas. Incorporar endpoints de negocio antes de JWT/session, resolución de membresía, RBAC y scope de estación habría permitido depender sólo de privacidad de red o datos enviados por el cliente.

**Cierre verificable:** flujo de autenticación aprobado, handlers y middleware, policies por audiencia, pruebas cross-tenant/cross-station y OpenAPI seguro.

**Estado:** cerrado. JWT con refresh rotativo ([ADR-0021](../../docs/adr/0021-rotating-refresh-tokens.md)), política fallback autenticada, permisos por departamento y alcance de organización y estación resueltos en SQL, y 385 operaciones que declaran Bearer ([OpenAPI, HTTP y SignalR](openapi-http-y-signalr.md)).

### R2 · Modelo persistente sin casos de uso — cerrado

En el commit verificado, la base v1 representaba gran parte del dominio, mientras Application no contenía slices y OpenAPI sólo publicaba ping. Una tabla o enum podía parecer una capacidad terminada aunque no existiera workflow, transición, autorización o response pública.

**Cierre verificable:** implementar cada capacidad verticalmente y marcarla como disponible sólo cuando Domain/Application/API/tests/cliente estén conectados.

**Estado:** cerrado para las cuatro fases del ciclo. El [Mapa de capacidades](../02-producto/mapa-de-capacidades.md) cita la operación de cada fila y `npm run vault:check` rechaza una fila sin `operationId` publicado.

### R3 · Reglas de dominio concentradas en EF — riesgo de coherencia

Domain contiene entidades mayormente mutables, un marker de eventos y una excepción base; no contiene todavía comportamiento suficiente para demostrar todos los invariantes. SQL cubre foreign keys, índices y checks, pero no toda coherencia temporal, autorización o transición entre agregados.

**Cierre verificable:** reglas acordadas en aggregates/services/slices, pruebas unitarias y de integración, y constraints adicionales sólo cuando sean correctos para todos los flujos.

**Estado:** abierto y acotado. Posterior al commit verificado, muchas reglas viven en políticas puras de Application con pruebas unitarias, pero algunas coherencias entre agregados solo las exige el caso de uso ([brechas](../03-dominio/brechas-y-preguntas-abiertas.md)).

### R4 · Hubs mapeados sin seguridad ni contratos — cerrado

En el commit verificado los hubs estaban vacíos, sus rutas existían y no exigían autorización. Activarlos sin handshake autenticado, groups, scope, payload/version y estrategia de reconexión habría creado fuga o estado divergente.

**Cierre verificable:** contrato de eventos, authorization policies, tests de aislamiento y regla REST-after-reconnect.

**Estado:** cerrado. `/hubs/operations` y `/hubs/notifications` exigen Bearer y solo envían `ChangedV1` con un `eventId` al usuario destinatario; el cliente relee por REST bajo sus permisos. `/hubs/public-catalog` es anónimo y solo anuncia `CatalogChangedV1` sin datos. Un WebSocket de navegador exige un origen de la allowlist.

### R5 · Outbox, eventos e idempotencia sólo persistentes — cerrado

En el commit verificado existían `outbox_messages`, `MobileCommandReceipt` y una colección base de domain events, sin dispatcher, handler de comandos Mobile ni dispatch de eventos.

**Cierre verificable:** transacción de escritura + captura de evento, worker reanudable, retry/dead-letter/telemetría, handler idempotente y pruebas de duplicado/fallo.

**Estado:** cerrado. Cada comando escribe su pista en el outbox dentro de su transacción; el [despachador](../../backend/Elevant.Api/Hubs/AccountChangeDispatchWorker.cs) la proyecta al feed por cursor y otro worker envía el correo. Los recibos de la tableta repiten el resultado por clave. El despachador está apagado por defecto y encendido en Development; sin él, el feed se reconcilia por sondeo.

### R6 · FlightAware sin contrato operativo — reemplazado por AeroDataBox

En el commit verificado no estaban confirmados producto contratado, cuotas, campos, auth, licencia, timeouts ni degradación, y no había adapter registrado.

**Cierre verificable:** requisitos y proveedor confirmados, adapter probado contra simulador, secrets por ambiente y políticas de resiliencia observables.

**Estado:** el feed de pago es AeroDataBox, con presupuesto de unidades por día y por mes, simulador para pruebas y clave solo por configuración secreta ([ADR-0028](../../docs/adr/0028-aerodatabox-flight-feed-with-unit-budget.md)). FlightAware sigue como frontera futura sin adaptador.

### R7 · Dependencias cartográficas demo — preparación para Production pendiente

Private Web usa styles/tiles públicos y CSP explícita. Su disponibilidad, términos, privacidad y capacidad no constituyen una selección productiva.

**Cierre verificable:** proveedor/licencia aprobados, URLs por ambiente, límites/fallback y revisión CSP/privacidad.

### R8 · Production sólo es frontera — no confundir diseño con plataforma

La separación y guardas están diseñadas, pero `database/ProductionDB` no contiene implementación. Ninguna nota de arquitectura autoriza crear o desplegar Production.

**Cierre verificable:** plan explícito separado, threat model, identidades/redes/secrets/backups propios, release compatible y aceptación operacional.

### R9 · Acceso humano Development omite reglas API — aceptado con límite

CRUD por SSMS sobre datos sintéticos es una excepción deliberada. Puede producir estados que un futuro caso de uso rechazaría; SQL sólo conserva sus constraints físicos.

**Control actual:** cuentas individuales y no DDL; mantener datos sintéticos y usar la anomalía para fortalecer validaciones, nunca para inferir un comportamiento Production.

## Discrepancias documentales reconciliadas

La documentación inicial del scaffold quedó atrás cuando se incorporaron los
clientes ejecutables, el modelo v1 y las cinco migraciones. En esta
reconciliación, [Arquitectura general](../../docs/architecture/overview.md) y
[Visión del sistema](../../docs/architecture/system-overview.md) ya distinguen
ese estado del flujo de negocio aún pendiente. Los resúmenes de
[monolito modular](../../docs/architecture/modular-monolith.md) y
[reglas de dependencia](../../docs/architecture/dependency-rules.md) incluyen
ahora Persistence y DatabaseTool.

Ésa fue una corrección documental, no la implementación de autenticación,
handlers o integraciones externas, que llegaron después. Para describir comportamiento actual, la
precedencia sigue siendo código, migraciones, OpenAPI y pruebas; el grafo exacto
se comprueba en los `.csproj` y `ProjectDependencyTests`.

## Decisiones todavía desconocidas

| Pregunta | Estado | Evidencia necesaria para cerrarla |
| --- | --- | --- |
| ¿Qué proveedor/flujo de identidad se usará? | Desconocido | ADR de identidad, threat model y contrato probado. |
| ¿Cómo se traducirán roles, memberships y station scopes a policies? | Desconocido | Matriz de autorización y tests negativos por audiencia. |
| ¿Cuál es el primer slice de negocio y su rollout compatible? | Desconocido | Prioridad de producto, endpoint OpenAPI y plan API-first. |
| ¿Qué reglas de transición deben vivir en Domain vs Application vs SQL? | Parcial | Casos de uso y matrices de estado aprobadas. |
| ¿Cómo se publicarán outbox/domain events? | Desconocido | Diseño de worker, entrega, retries y observabilidad. |
| ¿Qué SLA/plan/licencia se contratará para datos de vuelos y mapas? | Desconocido | Decisión de proveedor y contratos vigentes. |
| ¿Qué object storage, retención y autorización se usarán? | Diferido | Diseño de evidencia binaria y privacidad. |
| ¿Cuándo extraer un servicio del monolito? | Sin necesidad demostrada | Métricas de escala, ownership, regulación o aislamiento de fallos. |

Posterior al commit verificado de esta nota (código de `39a85a46`):

- **Identidad:** cuentas ASP.NET Identity propias con JWT y refresh rotativo
  ([ADR-0021](../../docs/adr/0021-rotating-refresh-tokens.md)) y código por
  correo en el portal ([ADR-0022](../../docs/adr/0022-portal-email-verification.md)).
- **Roles y políticas:** catálogo de permisos por departamento, módulo y acción
  ([ADR-0015](../../docs/adr/0015-department-user-governance.md),
  [ADR-0019](../../docs/adr/0019-menu-option-permissions-and-department-notifications.md)).
- **Primer slice y rollout:** las cuatro fases del ciclo, entregadas por
  bloques con expand/contract.
- **Outbox:** pista en la transacción, despachador al feed por cursor y worker
  de correo.
- **Datos de vuelos:** AeroDataBox con presupuesto de unidades
  ([ADR-0028](../../docs/adr/0028-aerodatabox-flight-feed-with-unit-budget.md));
  el proveedor de mapas sigue sin decidir.
- **Object storage:** bucket S3 privado con metadatos y hash en SQL
  ([medios](medios-comerciales-privados.md)); la retención sigue abierta.

## Regla de decisión futura

```mermaid
flowchart TD
    NEED[Necesidad o riesgo comprobado]
    SOURCE[Fuentes ejecutables y constraints]
    OPTIONS[Alternativas y consecuencias]
    ADR[ADR o contrato aprobado]
    IMPL[Implementación compatible]
    TEST[Pruebas y evidencia]
    VAULT[Actualizar Vault]

    NEED --> SOURCE --> OPTIONS --> ADR --> IMPL --> TEST --> VAULT
```

No se crean microservicios, adapters genéricos, tablas, eventos o abstracciones “por si acaso”. Una extracción sólo se justifica con evidencia de escala distinta, ciclo independiente sostenido, ownership claro, regulación o aislamiento imposible de resolver en el monolito.

## Verificación

- Lee cada ADR como decisión y después busca su enforcement en código/tests.
- Usa [ProjectDependencyTests](../../backend/tests/Elevant.ArchitectureTests/Architecture/ProjectDependencyTests.cs) para el grafo real.
- Revisa la composición de API y busca autenticación/policies antes de afirmar seguridad.
- Busca workers, handlers y implementaciones concretas antes de afirmar outbox, idempotencia o proveedores activos.
- Contrasta cualquier documento antiguo con las migraciones y el snapshot OpenAPI del commit.

Esta nota no reemplaza un threat model, ADR futuro o plan de rollout.

## Relacionados

- [Índice de Arquitectura](README.md)
- [Backend .NET, capas y dependencias](backend-dotnet-capas-y-dependencias.md)
- [Datos, EF Core, migraciones y persistencia](datos-ef-migraciones-y-persistencia.md)
- [OpenAPI, HTTP y SignalR](openapi-http-y-signalr.md)
- [Integraciones externas](integraciones-externas.md)
- [Brechas de dominio](../03-dominio/brechas-y-preguntas-abiertas.md)
