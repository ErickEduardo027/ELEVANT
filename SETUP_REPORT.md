# Estado actual del repositorio ELEVANT

Última revisión estructural: 2026-08-31, zona horaria `America/La_Paz`.

Este documento reemplaza el reporte del scaffold inicial. Las reglas obligatorias
viven en `AGENTS.md` y la documentación detallada permanece bajo `docs` y
`ops/dokploy`; este archivo solo resume el estado verificable del monorepositorio.

## Estructura vigente

| Ruta | Responsabilidad |
| --- | --- |
| `backend` | Solución .NET plana, API única, dominio, aplicación, contratos, adaptadores y pruebas. |
| `database/DevelopmentDB` | EF Core, migraciones, DatabaseTool, Compose y operación certificada de SQL Server Development. |
| `database/ProductionDB` | Frontera futura reservada; contiene únicamente `.gitkeep`. |
| `frontend/private-web` | Aplicación interna AVIAM. |
| `frontend/public-web` | Sitio y portal público con acceso tenant-scoped mediante la API. |
| `frontend/mobile-agent` | Aplicación Expo/React Native para agentes de rampa. |
| `ops/dokploy` | Plantillas sin secretos y runbooks del plano de control privado. |

Los clientes nunca acceden directamente a SQL Server ni a proveedores externos.
Todos consumen la misma API versionada y la misma base lógica correspondiente al
ambiente.

## Solución .NET

`backend/Elevant.sln` contiene diez proyectos `net10.0`:

| Proyecto | Ubicación |
| --- | --- |
| `Elevant.Domain` | `backend/Elevant.Domain` |
| `Elevant.Application` | `backend/Elevant.Application` |
| `Elevant.Contracts` | `backend/Elevant.Contracts` |
| `Elevant.Infrastructure` | `backend/Elevant.Infrastructure` |
| `Elevant.Persistence` | `database/DevelopmentDB/Elevant.Persistence` |
| `Elevant.DatabaseTool` | `database/DevelopmentDB/Elevant.DatabaseTool` |
| `Elevant.Api` | `backend/Elevant.Api` |
| `Elevant.UnitTests` | `backend/tests/Elevant.UnitTests` |
| `Elevant.IntegrationTests` | `backend/tests/Elevant.IntegrationTests` |
| `Elevant.ArchitectureTests` | `backend/tests/Elevant.ArchitectureTests` |

La solución muestra los proyectos productivos directamente y agrupa únicamente
las pruebas bajo `tests`. Persistence sigue formando parte de la solución, pero
su fuente física está separada del backend para que DevelopmentDB y la futura
ProductionDB tengan límites explícitos.

## Validación de la reorganización

La revisión local posterior a la separación comprobó:

- restore bloqueado y build Release con cero errores y cero advertencias;
- 42 pruebas .NET aprobadas: 1 unitaria, 34 de integración y 7 de arquitectura;
- modelo EF sin cambios pendientes respecto de la última migración;
- 12 pruebas del manifiesto de release aprobadas localmente; las 2 pruebas de
  symlink se omiten en Windows cuando el usuario no posee ese privilegio y CI
  ejecuta las 14 en Linux;
- 15 pruebas del guard anti-publicación obsoleta aprobadas;
- suites del controlador CD y de `verify-runtime` aprobadas;
- workflows YAML válidos y búsqueda de secretos sin hallazgos;
- Compose certificados sin cambios, con hashes SHA-256
  `dd29e07fcf92b95b4f0d2b45ac7a288290f862068cbf9360a9c856a962a2a1ee`
  y `bd8fbded7339f87c71bb7e4058427581f58417602b8e37ebd0e90a0d1e79fd07`.

El daemon de Docker Desktop no está activo ni disponible en la máquina local.
GitHub Actions sigue siendo la autoridad para construir las imágenes y ejecutar
la certificación real con SQL Server 2022.

## Estado de Development

La base `ElevantDevelopmentDb` está instalada en el VPS privado y su entrega está
automatizada: un push certificado a `Development` publica imágenes y manifiesto
inmutables; el controlador del VPS realiza preflight, backup, migración, seed
sintético, verificación, backup posterior y restore-check antes de aceptar la
promoción. La reorganización fue promovida correctamente y SQL Server permaneció
saludable.

No se desplegaron la API ni los frontends como parte de esta reorganización.
`database/ProductionDB` continúa vacío y no existe autorización de despliegue o
migración de Production.

## Reglas que permanecen

- OpenAPI será el contrato cliente/servidor cuando existan endpoints reales.
- La API no migra ni siembra la base al arrancar.
- Development usa únicamente fixtures sintéticos, deterministas e idempotentes.
- Production aplicará en el futuro la misma cadena de migraciones, sin seed y con
  confirmación explícita para cualquier cambio de esquema.
- Credenciales, `.env`, backups, bases generadas y datos personales nunca se
  versionan.
- El siguiente bloque de producto es diseñar e implementar la API; los frontends
  se conectarán después mediante el contrato publicado.
