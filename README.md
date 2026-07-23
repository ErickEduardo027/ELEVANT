# ELEVANT

Elevant es la plataforma privada de AVIAM para organizar la futura gestión de
asistencia en tierra: preoperación, planificación, operación en rampa, evidencias,
validación de OCC y procesos de facturación. Este repositorio contiene únicamente
la base técnica inicial; los módulos de negocio todavía no están implementados.

## Arquitectura

```text
Elevant Web ───────────────┐
                           ├──> Elevant API ──> SQL Server
Elevant Mobile Agent ──────┘          │
                                      └──> FlightAware AeroAPI (futuro)
```

REST será la fuente de verdad. SignalR se reservará para notificaciones y cambios
en tiempo real. Solo la API podrá acceder a SQL Server y a FlightAware.

El backend es un monolito modular en .NET 10 organizado con Clean Architecture.
`Domain` permanece independiente; `Application` depende de Domain;
`Infrastructure` implementa los puertos de Application; y `Api` actúa como host y
composition root. Las funcionalidades futuras se organizarán mediante vertical
slices dentro de Application sin romper esas dependencias.

## Responsables

| Área | Responsable |
|---|---|
| API, SQL Server, Docker, Dokploy, seguridad y despliegues | Erick |
| Aplicación web | Laisha |
| Elevant Mobile Agent | Eliezer |

## Estructura resumida

```text
ELEVANT/
├── backend/              Unidad autónoma del servidor
│   ├── Elevant.sln       Solución .NET del backend
│   ├── src/              Domain, Application, Contracts, Infrastructure y Api
│   ├── tests/            Pruebas unitarias, de integración y arquitectura
│   ├── database/         Documentación y utilidades de SQL Server
│   ├── infrastructure/   Docker, Dokploy, proxy, monitoreo y backups
│   └── scripts/          Build, migraciones y automatización del backend
├── frontend/web/         Base neutral de la aplicación web
├── frontend/mobile-agent/ Base neutral de Elevant Mobile Agent
├── packages/             Cliente API y configuración compartida futura
├── docs/                 Arquitectura, API, seguridad y onboarding
├── scripts/              Verificación y utilidades globales del repositorio
└── .github/              CI y plantillas de colaboración
```

La carpeta maestra del repositorio es `ELEVANT`. Todo lo que pertenece al servidor
—incluidos solución, configuración .NET, código, pruebas, base de datos,
infraestructura, Docker y scripts operativos— se concentra en `backend`. Los
clientes web y móvil se concentran en `frontend`.

## Requisitos

- .NET SDK 10 estable, según `backend/global.json`.
- Git.
- Docker Desktop con Docker Compose para el entorno local completo.
- PowerShell 5.1 o PowerShell 7 para los scripts.
- Node.js 20 o superior y pnpm, solo cuando se inicialicen web o móvil.

El workspace pnpm incluye `frontend/*` y `packages/*`. Por ahora `package.json` solo
ofrece scripts reales para revisar secretos y mostrar el árbol. `format` y `lint`
se añadirán cuando web o móvil seleccionen herramientas concretas; no existen
scripts simulados que terminen correctamente sin validar nada.

Compruebe el equipo con:

```powershell
./scripts/setup/verify-prerequisites.ps1
```

## Inicio rápido del backend

Restaurar, compilar y probar sin iniciar SQL Server:

```powershell
Push-Location backend
dotnet tool restore
./scripts/restore-build-test.ps1
Pop-Location
```

Para ejecutar la API directamente, copie los placeholders, defina una contraseña
local segura y cargue las variables en su sesión. ASP.NET Core no lee archivos
`.env` automáticamente.

## API y SQL Server con Docker

```powershell
Copy-Item backend/.env.example backend/.env
# Edite backend/.env y reemplace todos los valores REPLACE_ antes de continuar.
docker compose --env-file backend/.env -f backend/infrastructure/docker/compose.local.yml up --build
```

La API queda disponible en `http://localhost:8080`, con ping en
`/api/v1/system/ping`. SQL Server se liga únicamente a `127.0.0.1`. La base vacía y
futuras migraciones se aplican mediante el proceso controlado documentado en
`docs/database/migrations.md`; nunca se aplican automáticamente al arrancar.

## Trabajo de Laisha

Laisha debe leer `frontend/web/README.md`, elegir posteriormente Next.js, Astro u otra
tecnología en una PR independiente y consumir
`https://api-test.elevant.example`. Puede trabajar con mocks sin ejecutar API ni
SQL Server localmente.

## Trabajo de Eliezer

Eliezer debe leer `frontend/mobile-agent/README.md` e inicializar Expo en una PR
independiente. La APK se instalará en la tablet y consumirá la API remota de
Testing; no se aloja como una aplicación web en el VPS.

## Variables y secretos

Los archivos `.env.example`, incluido `backend/.env.example`, contienen solo
placeholders. Las variables principales
son `ConnectionStrings__ElevantDatabase`, `Cors__AllowedOrigins__0`,
`FlightAware__BaseUrl`, `FlightAware__ApiKey` y las opciones futuras de
autenticación. Los secretos reales se gestionarán en Dokploy y nunca se subirán a
Git.

## Ambientes

- Testing (`develop`): `https://api-test.elevant.example`, datos controlados,
  Swagger habilitable y base `ElevantTestingDb`.
- Production (`main`): `https://api.elevant.example`, datos reales, Swagger no
  expuesto y base `ElevantProductionDb`.

Los ambientes no comparten bases, contraseñas, claves JWT, API keys, volúmenes,
uploads ni backups. Solo Erick aprueba despliegues a Production.

## Flujo de trabajo

Las ramas son `main`, `develop`, `feature/*`, `fix/*` y `hotfix/*`. OpenAPI es el
contrato oficial entre backend, web y móvil. Consulte `CONTRIBUTING.md` y
`docs/workflows/team-collaboration.md` antes de abrir una PR.

## Documentación principal

- `docs/architecture/system-overview.md`
- `docs/architecture/backend-architecture.md`
- `docs/api/openapi-contract.md`
- `docs/deployment/environments.md`
- `docs/security/secrets-management.md`
- `docs/onboarding/`
- `SETUP_REPORT.md`

## No implementado todavía

No existen aún autenticación, usuarios, vuelos, contratos, asignaciones, operación
en rampa, incidencias, facturación, llamadas reales a FlightAware, cliente API
generado, aplicación web, proyecto Expo ni despliegue en Dokploy.

## Próximos pasos

1. Configurar usuarios reales en CODEOWNERS y proteger `main` y `develop`.
2. Publicar la API técnica en Testing.
3. Acordar el primer contrato mediante OpenAPI.
4. Inicializar web y móvil en Pull Requests independientes.
5. Diseñar el primer módulo y su modelo de datos con un ADR específico.
