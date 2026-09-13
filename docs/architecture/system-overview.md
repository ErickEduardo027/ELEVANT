# Visión del sistema

ELEVANT tiene tres aplicaciones cliente y una API .NET compartida. El esquema SQL
de Development está versionado y su despliegue se opera por un carril separado de
la API. Esta página distingue los límites de arquitectura del comportamiento que
ya puede probarse; el [mapa vigente del Vault](../../Vault/04-arquitectura/sistema-y-fronteras-de-confianza.md)
amplía la evidencia.

## Mapa de contexto

- `frontend/private-web` es la aplicación interna AVIAM en Vite/React.
- `frontend/public-web` es el sitio y portal público en Next.js/React.
- `frontend/mobile-agent` es la aplicación nativa Expo/React Native. Su
  integración de negocio con la API y su entrega APK todavía no están completas.
- `backend/Elevant.Api` es la única frontera prevista para reglas, datos e
  integraciones de los tres clientes. Hoy sólo publica un endpoint HTTP
  versionado de diagnóstico, health/readiness y dos hubs SignalR vacíos.
- SQL Server 2022 almacena el esquema compartido por ambiente. EF Core y sus
  migraciones viven en `database/DevelopmentDB/Elevant.Persistence`; la API no
  migra ni siembra al iniciar.
- FlightAware es una integración futura: existe un puerto en Application y un
  shell de configuración, pero no un adaptador funcional ni tráfico real.
- Development tiene plantillas y controladores de entrega bajo `ops/dokploy`.
  Production continúa como frontera futura, no como un segundo despliegue
  demostrado por este repositorio.

## Protocolos y confianza

Los clientes deben consumir el contrato HTTP versionado de la API y, cuando
existan eventos de negocio, podrán usar SignalR como aviso complementario. REST
seguirá siendo la fuente de verdad después de una reconexión. La presencia de
los hubs no implica que ya haya mensajes, autenticación o autorización de
negocio. Los clientes no se conectan a SQL Server ni a proveedores externos de
aviación; el acceso humano controlado a SQL de Development es una excepción
operativa, no una ruta de aplicación.

## Estado y fuentes actuales

La forma física del esquema está en las [migraciones EF](../../database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations)
y el [inventario v1](../database/schema-v1.md). Los endpoints reales se comprueban
en [OpenAPI](../api/openapi-contract.md) y en el
[host API](../../backend/Elevant.Api/Extensions/ApplicationBuilderExtensions.cs).
Para el estado de cada cliente, consulta el
[índice de aplicaciones](../../Vault/05-aplicaciones/README.md); para CI/CD y
operación, los [índices de entrega](../../Vault/07-entrega/README.md) y
[operaciones](../../Vault/09-operaciones/README.md).

Las prioridades de calidad siguen siendo separación de ambientes, cambios de
esquema revisados, contratos versionados, secretos fuera de Git e imágenes,
errores sin datos sensibles y compatibilidad con clientes móviles intermitentes.
