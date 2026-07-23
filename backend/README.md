# Backend de ELEVANT

Esta carpeta contiene de forma autónoma la solución backend de Elevant: código productivo, pruebas, configuración .NET, Docker, SQL Server, infraestructura y scripts operativos. Los clientes web y móvil nunca acceden directamente a SQL Server ni a FlightAware.

## Clean Architecture

```text
src/
├── Elevant.Domain          Núcleo de dominio y reglas independientes
├── Elevant.Application     Casos de uso, abstracciones y vertical slices
├── Elevant.Contracts       Contratos públicos de la API
├── Elevant.Infrastructure  EF Core, SQL Server e integraciones
└── Elevant.Api             Host HTTP, controladores, SignalR y composición

tests/
├── Elevant.UnitTests
├── Elevant.IntegrationTests
└── Elevant.ArchitectureTests
```

Las dependencias internas permitidas son:

```text
Domain          -> ninguna
Application     -> Domain
Contracts       -> ninguna dependencia de Api o Infrastructure
Infrastructure  -> Application + Domain
Api             -> Application + Contracts + Infrastructure
```

`Elevant.Domain` permanece aislado de frameworks. `Elevant.Application/Features` alojará los casos de uso futuros mediante vertical slices. `Elevant.Api` es el composition root y no contiene reglas de negocio. Las pruebas de arquitectura verifican automáticamente este grafo y la ausencia de ciclos.

## Comandos principales

Ejecutar desde `ELEVANT/backend`:

```powershell
dotnet tool restore
dotnet restore Elevant.sln --locked-mode
dotnet build Elevant.sln --configuration Release --no-restore
dotnet test Elevant.sln --configuration Release --no-build
```

También puede ejecutarse la secuencia completa con:

```powershell
./scripts/restore-build-test.ps1
```

## Entorno local

```powershell
Copy-Item .env.example .env
# Reemplazar todos los placeholders antes de continuar.
docker compose --env-file .env -f infrastructure/docker/compose.local.yml up --build
```

SQL Server se publica únicamente en `127.0.0.1` para desarrollo local. Testing y Production no publican el puerto 1433. Las migraciones se crean y aplican mediante los scripts controlados de esta carpeta; nunca se ejecutan automáticamente durante el arranque de producción.

## Límites actuales

Esta base no implementa todavía autenticación completa, usuarios, vuelos, contratos, operaciones, facturación ni llamadas reales a FlightAware. REST será la fuente de verdad; SignalR se limita a notificaciones y actualizaciones servidor-cliente.
