# ELEVANT

ELEVANT es la plataforma de AVIAM para planificar y controlar asistencia en tierra. Este monorepositorio contiene tres experiencias de usuario que consumen una sola API y una sola base lógica por ambiente:

```text
AVIAM Web interno ───────┐
Portal público/clientes ─┼── HTTPS ──> Elevant.Api ──> SQL Server
Mobile Agent nativo ─────┘                  │
                                            └──> proveedores externos autorizados
```

| Aplicación | Usuarios | Tecnología actual |
| --- | --- | --- |
| `frontend/private-web` | Personal interno de AVIAM: OCC, administración y departamentos | Next.js 16, React 19 |
| `frontend/public-web` | Visitantes y clientes/aerolíneas con aislamiento por organización y estación | Next.js 16, React 19 |
| `frontend/mobile-agent` | Agentes de rampa en tablet Android/iOS | Expo 54, React Native |
| `backend` | API compartida, dominio, aplicación e infraestructura | .NET 10 |
| `database/DevelopmentDB` | Persistencia, migraciones y operación de Development | EF Core 10, SQL Server 2022 |
| `database/ProductionDB` | Límite futuro reservado; todavía no desplegado | Vacío |

Ningún cliente accede directamente a SQL Server ni a FlightAware. La autorización de tenant, rol, estación y agente siempre se resuelve en la API; los mocks y `localStorage` no son fronteras de seguridad.

## Estado de la primera base de datos

La v1 de persistencia modela plataforma, identidad, catálogos, personal, habilitaciones, contratos versionados, turnarounds/vuelos, operación en rampa, checklists, incidencias, revisión OCC, idempotencia móvil y auditoría. Las migraciones viven en `database/DevelopmentDB/Elevant.Persistence/Persistence/Migrations`.

Development y Production son bases físicas distintas:

- `ElevantDevelopmentDb`: mismas migraciones y fixtures sintéticos mediante un seeder separado e idempotente.
- `ElevantProductionDb`: mismas migraciones, cero datos de negocio iniciales y ningún comando de seed.

Cada tarea comprueba el nombre físico, el ambiente declarado y un marcador inmutable dentro de la base. Production requiere una segunda confirmación explícita. Facturación documental, chat/notificaciones y archivos/evidencias quedan diferidos hasta cerrar sus reglas y el almacenamiento de objetos.

Lea [database-v1.md](docs/architecture/database-v1.md) y [schema-v1.md](docs/database/schema-v1.md) antes de modificar el modelo.

## Inicio rápido

Backend sin Docker:

```powershell
dotnet tool restore
dotnet restore backend/Elevant.sln --locked-mode
dotnet build backend/Elevant.sln --configuration Release --no-restore
dotnet test backend/Elevant.sln --configuration Release --no-build
```

Entorno local completo con SQL Server, bootstrap, migraciones, seed y API:

```powershell
Copy-Item database/DevelopmentDB/.env.example database/DevelopmentDB/.env
# Sustituir todos los valores REPLACE_ME.
docker compose --env-file database/DevelopmentDB/.env -f database/DevelopmentDB/compose.local.yml up --build
```

La API queda ligada a `http://127.0.0.1:8080` y SQL Server a `127.0.0.1:1433`. El puerto SQL solo existe para desarrollo local. El Compose remoto nunca publica 1433.

Cada frontend se instala y valida dentro de su propia carpeta con npm y su `package-lock.json`; consulte su README. Mobile se compila como APK/app nativa y no se aloja como sitio web en el VPS.

## Ramas y despliegue

- `Development` es la rama de integración.
- `main` representa Production cuando su promoción esté habilitada.

No se fusiona ni despliega automáticamente una rama feature. Tras revisión y
merge manual en `Development`, CI valida SQL Server 2022, el esquema, upgrades,
ausencia de seed en Production y la imagen API. Los cambios de base publican
`elevant-db-ops`, `elevant-db-release` y su bundle certificado; los cambios del
backend publican la API y su propio bundle certificado. GitHub no inicia una
conexión hacia Dokploy.

En el diseño del VPS de Development, SQL Server/volúmenes, migraciones y API
conservan recursos separados. Tras completar el handoff manual de la API, los
controladores privados consultarán GHCR y mantendrán el orden
`migración compatible -> API`; AVIAM Web y Public Web serán deployables
posteriores y la tablet consumirá esa misma API. La arquitectura está en
[dokploy.md](docs/deployment/dokploy.md) y el bootstrap manual con checkpoints
en [Configuración de Dokploy](docs/deployment/dokploy-configuration.md).

## Guía para personas y agentes

- Lea [AGENTS.md](AGENTS.md) y el archivo más cercano dentro del árbol antes de editar.
- OpenAPI será el contrato entre API y clientes; las entidades EF no se exponen por HTTP.
- Los datos de `backend-prototipo`, los backups JSON y las credenciales demo son material descartable: no se convierten en seed ni se promueven.
- Secretos, backups SQL, binarios subidos, bases runtime y artefactos de firma nunca se versionan.

Documentación principal:

- [Backend](backend/README.md)
- [Bases de datos](database/README.md)
- [Frontends](frontend/README.md)
- [Migraciones](docs/database/migrations.md)
- [Ambientes](docs/deployment/environments.md)
- [Arquitectura](docs/architecture/system-overview.md)
- [Contribución](CONTRIBUTING.md)

## Todavía no implementado

El esquema v1 y su operación están preparados, pero los casos de uso HTTP de negocio, autenticación completa de clientes, sustitución general de mocks, integración real con FlightAware, facturación final, notificaciones/chat y almacenamiento de evidencias siguen pendientes. No trate una pantalla prototipo como una integración productiva.
