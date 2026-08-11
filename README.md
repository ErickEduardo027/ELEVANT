# ELEVANT

Elevant es la plataforma privada de AVIAM para organizar la gestión de asistencia
en tierra: preoperación, planificación, operación en rampa, evidencias, validación
de OCC y procesos de facturación. Este monorepositorio reúne el backend y los
clientes web y móvil; los frontends disponen de prototipos funcionales con datos
simulados mientras se completa su integración con la API.

## Arquitectura

```text
Elevant Web interno ───────┐
Elevant Public Web ────────┼──> Elevant API ──> SQL Server
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
├── frontend/web/         Aplicación interna para Administración/OCC y departamentos
├── frontend/public-web/  Landing pública y portal demostrativo de aerolíneas
├── frontend/mobile-agent/ Prototipo Expo para agentes de rampa
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
- Node.js 20 o superior y el gestor indicado por cada aplicación frontend.

El workspace pnpm incluye `frontend/*` y `packages/*`. El `package.json` raíz
ofrece scripts para revisar secretos y mostrar el árbol; cada aplicación frontend
declara sus propios comandos de desarrollo, lint, pruebas y compilación.

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

Laisha debe leer `frontend/web/README.md` y mantener los módulos internos de
Administración/OCC y departamentos. La aplicación consumirá
`https://api-dev.elevant.com`; mientras la integración no esté disponible puede
trabajar con adaptadores mock sin ejecutar API ni SQL Server localmente.

## Web pública y portal de aerolíneas

`frontend/public-web` contiene la landing pública, el acceso local y el portal
demostrativo para aerolíneas. Usa Next.js y datos simulados; no autentica contra
Production ni transmite información operativa real. Sus rutas, credenciales demo
y comandos están documentados en `frontend/public-web/README.md`.

## Trabajo de Eliezer

Eliezer debe leer `frontend/mobile-agent/README.md` y mantener el prototipo Expo.
La APK se instalará en la tablet y consumirá la API remota de Development cuando
se complete la integración; no se aloja como una aplicación web en el VPS.

## Variables y secretos

Los archivos `.env.example`, incluido `backend/.env.example`, contienen solo
placeholders. Las variables principales
son `ConnectionStrings__ElevantDatabase`, `Cors__AllowedOrigins__0`,
`FlightAware__BaseUrl`, `FlightAware__ApiKey` y las opciones futuras de
autenticación. Los secretos reales se gestionarán en Dokploy y nunca se subirán a
Git.

## Ambientes

- Development (`Development`): `https://api-dev.elevant.com`, datos sintéticos,
  Swagger habilitado y base `ElevantDevelopmentDb`.
- Production (`main`): `https://api.elevant.example`, datos reales, Swagger no
  expuesto y base `ElevantProductionDb`.

Los ambientes no comparten bases, contraseñas, claves JWT, API keys, volúmenes,
uploads ni backups. Solo Erick aprueba despliegues a Production.

## Flujo de trabajo

Las ramas son `main`, `Development`, `feature/*`, `fix/*` y `hotfix/*`. OpenAPI es el
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

No están implementadas aún la autenticación real de los clientes, la sustitución
general de datos simulados por la API, las llamadas reales a FlightAware, el
cliente API generado ni el despliegue completo en Dokploy. Los prototipos no deben
interpretarse como integraciones productivas.

## Próximos pasos

1. Configurar usuarios reales en CODEOWNERS y proteger `main` y `Development`.
2. Publicar la API técnica en Development.
3. Acordar y publicar los contratos mediante OpenAPI.
4. Sustituir progresivamente los adaptadores mock de web y móvil.
5. Validar despliegues y observabilidad por ambiente antes de habilitar datos reales.
