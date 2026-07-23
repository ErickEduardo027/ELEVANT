# Reporte de configuración inicial de Elevant

## Datos de ejecución

- Fecha de cierre: 2026-07-18 15:40:17 -04:00.
- Zona horaria: America/La_Paz.
- Carpeta de trabajo: `C:\Users\Erick Eduardo\Desktop\ELEVANT`.
- Rama Git inicial: `main`.
- Estado Git: repositorio inicializado, sin commits, sin remotes y sin push.
- Alcance: scaffold profesional del monorepositorio; no se desplegaron recursos externos ni se implementaron módulos de negocio.

## Resumen

Se creó la base completa del monorepositorio privado Elevant con una única solución .NET, API centralizada, límites de arquitectura, proyectos de pruebas, espacios neutrales para web y móvil, infraestructura Docker/Dokploy documentada, automatización de CI y documentación operativa en español.

El backend usa `net10.0` y compila en Release sin advertencias. Las nueve pruebas pasan. No se detectaron secretos y los tres archivos Compose son sintácticamente válidos. Web y móvil quedan preparados para consumir la API remota de Testing sin ejecutar el backend ni SQL Server localmente.

La carpeta maestra se denomina `ELEVANT`. El backend es autónomo bajo `backend/`: allí se encuentran la solución, proyectos, pruebas, configuración .NET, base de datos, infraestructura, Docker y scripts operativos. Las aplicaciones consumidoras están agrupadas bajo `frontend/web` y `frontend/mobile-agent`. La raíz conserva únicamente elementos compartidos como CI, documentación global, paquetes y herramientas del repositorio.

## Compatibilidad con .NET 10

Se mantiene .NET 10; no existe una razón técnica para bajar a .NET 9:

- .NET 10 es una versión LTS activa. .NET 9 es STS y tiene una ventana de soporte menor, según la [política oficial de soporte de .NET](https://dotnet.microsoft.com/en-us/platform/support/policy).
- EF Core 10 es LTS, requiere .NET 10 y está alineado con el TFM elegido, según la [documentación oficial de EF Core 10](https://learn.microsoft.com/en-us/ef/core/what-is-new/ef-core-10.0/whatsnew).
- `backend/global.json` solicita el SDK estable `10.0.300` con `rollForward: latestFeature`; en esta máquina seleccionó `10.0.302`.
- El runtime seleccionado fue `10.0.10`. Aunque existe un SDK RC antiguo instalado globalmente en la máquina, el repositorio no lo selecciona ni contiene referencias preview.
- EF Core, ASP.NET Core Testing y Microsoft.Extensions usan la línea estable `10.0.10`.
- Swashbuckle `10.2.3` publica destino `net10.0`, y Asp.Versioning `10.0.0` restauró y compiló correctamente.
- Restore, build Release y las pruebas de API, integración y arquitectura comprobaron la compatibilidad real del conjunto.

La decisión debe reevaluarse únicamente si el entorno definitivo de Dokploy no puede ejecutar imágenes .NET 10, condición que no se observó en la configuración creada.

## Estructura creada

- `frontend/web`: estructura neutral para Laisha, sin elegir Next.js ni Astro.
- `frontend/mobile-agent`: estructura neutral para Eliezer, sin ejecutar `create-expo-app`.
- `backend/src`: cinco proyectos productivos organizados mediante Clean Architecture.
- `backend/tests`: pruebas unitarias, de integración y de arquitectura.
- `backend/database`: documentación, administración, backup, diagnóstico, recovery, seeds y datos de prueba.
- `backend/infrastructure`: Docker, Dokploy, proxy, monitoreo, backups y ambientes.
- `backend/scripts`: utilidades PowerShell de restore, build, migraciones, base de datos y despliegue.
- `packages`: cliente API futuro y configuraciones compartidas pendientes.
- `docs`: arquitectura, workflows, API, base de datos, despliegue, seguridad, onboarding y ADR.
- `scripts`: utilidades compartidas de setup y repositorio.
- `.github`: CI de backend, plantillas inactivas de web/móvil, issues, PR y CODEOWNERS de ejemplo.

El cierre contiene 248 archivos no ignorados. El árbol real, excluyendo `.git`, `bin`, `obj`, `node_modules` y `TestResults`, está en `docs/architecture/generated-repository-tree.md`.

## Proyectos creados

| Proyecto | Tipo | TFM |
|---|---|---|
| `Elevant.Domain` | Class Library | `net10.0` |
| `Elevant.Application` | Class Library | `net10.0` |
| `Elevant.Contracts` | Class Library | `net10.0` |
| `Elevant.Infrastructure` | Class Library | `net10.0` |
| `Elevant.Api` | ASP.NET Core Web API | `net10.0` |
| `Elevant.UnitTests` | xUnit v3 | `net10.0` |
| `Elevant.IntegrationTests` | xUnit v3 | `net10.0` |
| `Elevant.ArchitectureTests` | xUnit v3 | `net10.0` |

Los ocho proyectos están incluidos en `backend/Elevant.sln` y cada uno dispone de `packages.lock.json`. Las pruebas de arquitectura validan el grafo exacto de referencias, las prohibiciones solicitadas y la ausencia de ciclos.

## Paquetes centralizados

| Paquete | Versión |
|---|---:|
| Asp.Versioning.Mvc | 10.0.0 |
| Asp.Versioning.Mvc.ApiExplorer | 10.0.0 |
| Microsoft.AspNetCore.Mvc.Testing | 10.0.10 |
| Microsoft.EntityFrameworkCore.Design | 10.0.10 |
| Microsoft.EntityFrameworkCore.SqlServer | 10.0.10 |
| Microsoft.Extensions.Configuration.Abstractions | 10.0.10 |
| Microsoft.Extensions.DependencyInjection.Abstractions | 10.0.10 |
| Microsoft.Extensions.Diagnostics.HealthChecks.EntityFrameworkCore | 10.0.10 |
| Microsoft.Extensions.Options.ConfigurationExtensions | 10.0.10 |
| Microsoft.NET.Test.Sdk | 18.8.1 |
| Swashbuckle.AspNetCore | 10.2.3 |
| xunit.v3 | 3.2.2 |
| xunit.runner.visualstudio | 3.1.5 |

La herramienta local `dotnet-ef` está fijada en `10.0.10` mediante `backend/dotnet-tools.json`. No se añadieron MediatR, FluentValidation, AutoMapper, Serilog, Hangfire ni Quartz.

## Backend implementado

- Clean Architecture, monolito modular y Application preparada para vertical slices.
- Grafo permitido: Domain no depende de otros proyectos; Application depende solo de Domain; Contracts permanece independiente; Infrastructure depende de Application y Domain; Api compone Application, Contracts e Infrastructure.
- Abstracciones mínimas de Domain y Application; no existen entidades de negocio definitivas.
- `ElevantDbContext` para SQL Server sin `DbSet` de negocio, migraciones iniciales ni migración automática al arrancar.
- Límite FlightAware neutral, sin API key, sin endpoints inventados y sin llamadas HTTP externas.
- API versionada con controladores, Swagger/OpenAPI, Problem Details, manejador global, CORS, rate limiting, forwarded headers y redirección HTTPS configurable.
- SignalR con hubs vacíos `/hubs/operations` y `/hubs/notifications`; REST permanece como fuente de verdad.
- Endpoints técnicos `GET /api/v1/system/ping`, `GET /health` y `GET /health/ready`.

## Comandos y resultados

Los comandos .NET de esta tabla se ejecutaron desde `ELEVANT/backend`.

| Comando o comprobación | Resultado |
|---|---|
| `dotnet --info` | Correcto; SDK estable 10.0.302 y runtime 10.0.10 seleccionados por `global.json`. |
| `dotnet restore Elevant.sln` | Correcto; 8/8 proyectos restaurados. |
| `dotnet restore Elevant.sln --locked-mode` | Correcto; las ocho resoluciones coinciden con sus locks. |
| `dotnet build Elevant.sln --configuration Release --no-restore` | Correcto; 0 errores y 0 advertencias. |
| `dotnet test Elevant.sln --configuration Release --no-build` | Correcto; 9 aprobadas, 0 fallidas, 0 omitidas. |
| Pruebas unitarias | 1/1 aprobada. |
| Pruebas de integración | 3/3 aprobadas, incluido ping con `WebApplicationFactory`. |
| Pruebas de arquitectura | 5/5 aprobadas. |
| `backend/scripts/restore-build-test.ps1` | Correcto con restore bloqueado, build y tests. |
| `scripts/setup/verify-prerequisites.ps1` | Correcto para Git, .NET, Docker Compose, Node y Corepack. |
| Parseo de los seis scripts PowerShell | Correcto en Windows PowerShell 5.1. |
| `docker compose ... compose.local.yml config --quiet` | Correcto. |
| `docker compose ... compose.testing.yml.example config --quiet` | Correcto; SQL Server no publica puerto. |
| `docker compose ... compose.production.yml.example config --quiet` | Correcto; SQL Server no publica puerto. |
| `scripts/repository/check-secrets.ps1` | Correcto; sin hallazgos. |
| actionlint 1.7.12 | Workflow activo y dos plantillas YAML válidos. |
| Solución, referencias y locks | 8 proyectos, 8 locks, sin ciclos. |
| Búsqueda de migraciones y patrones prohibidos | 0 migraciones de negocio; sin `NotImplementedException`, `Database.Migrate` ni claves reales. |

Detalle de pruebas:

- `Elevant.UnitTests`: 1 aprobada.
- `Elevant.IntegrationTests`: 3 aprobadas.
- `Elevant.ArchitectureTests`: 5 aprobadas.

La suite de integración también serializa Swagger v1 y verifica el esquema Bearer, por lo que OpenAPI/Swashbuckle 10 quedó comprobado en runtime.

Durante la primera reorganización de carpetas, las pruebas de arquitectura detectaron una ruta anterior construida por segmentos dentro de `ProjectDependencyTests`. Cinco pruebas fallaron por `DirectoryNotFoundException`; se actualizó el localizador para resolver `backend/Elevant.sln` y `backend/src`, se recompiló con 0 advertencias y se repitió la suite con 9/9 pruebas aprobadas. No quedó el error oculto ni pendiente.

## Docker y SQL Server

- `backend/Dockerfile` usa `backend/` como contexto, restaura con locks, publica Release, usa SDK/runtime .NET 10, escucha en 8080 y ejecuta con el usuario no root de la imagen.
- Compose local contiene API, SQL Server, volumen persistente, health check, red interna y liga SQL a `127.0.0.1`.
- Testing y Production reciben una cadena de conexión de aplicación de mínimo privilegio y nunca publican el puerto 1433.
- Las migraciones deben ejecutarse explícitamente mediante scripts y proceso controlado; no se aplican al inicio de producción.

## Seguridad y secretos

- No hay claves reales de FlightAware, contraseñas reales, claves JWT, certificados ni archivos `.env` versionables.
- FlightAware solo existe tras la abstracción del backend y su `ApiKey` permanece vacía en configuración.
- Las variables públicas web/móvil contienen únicamente URLs placeholder y se documenta que son extraíbles.
- Testing y Production no comparten bases, credenciales, claves, volúmenes, uploads ni backups.
- Testing admite exclusivamente datos sintéticos o controlados; no se restauran backups de Production.
- SQL Server solo puede ser consumido por la API.

## Advertencias y tareas no ejecutadas

1. Docker Desktop estaba instalado pero su daemon no estaba activo. Por ello no fue posible construir la imagen ni arrancar contenedores para probarlos en ejecución. La expansión y validación sintáctica de los tres Compose sí pasó.
2. `pnpm` no está instalado globalmente. Node 24.18.0 y Corepack 0.35.0 están disponibles; no se necesita pnpm hasta que web o móvil se inicialicen y se elija una versión de package manager.
3. La máquina conserva un SDK `10.0.100-rc.1` antiguo. `backend/global.json` selecciona de forma comprobada el SDK estable 10.0.302, por lo que no afecta al repositorio.
4. No se realizó despliegue real, migración, generación de cliente API, inicialización web/móvil, commit, push, creación de ramas ni configuración de remote, conforme a las restricciones.
5. Las CI de web y móvil son plantillas `.template` y permanecerán inactivas hasta que cada aplicación tenga comandos reales.

## Placeholders que deben reemplazarse

- `.github/CODEOWNERS.template`: sustituir `@REPLACE_ERICK`, `@REPLACE_LAISHA` y `@REPLACE_ELIEZER`, luego renombrar a `CODEOWNERS`.
- `backend/.env.example` y `backend/src/Elevant.Api/.env.example`: contraseña local, cadenas de conexión, CORS, autenticación y FlightAware desde almacenes seguros.
- `frontend/web/.env.example` y `frontend/mobile-agent/.env.example`: cambiar dominios `.example` por los endpoints reales del ambiente.
- Plantillas Testing/Production y documentación Dokploy: nombres de proyectos, dominios, redes, volúmenes y secretos reales.
- `Authentication__Issuer`, `Authentication__Audience` y `Authentication__SigningKey`: definir únicamente al implementar autenticación.
- `FlightAware__ApiKey`: secreto exclusivo del backend, separado por ambiente.
- `LICENSE.md`: definir licencia propietaria/condiciones internas antes de distribuir; el repositorio se declara privado.

## Decisiones tomadas

- Monorepositorio privado con una sola solución .NET.
- .NET 10 LTS en lugar de .NET 9 STS.
- Monolito modular, Clean Architecture y vertical slices futuras.
- SQL Server pertenece exclusivamente a la API.
- OpenAPI será el contrato oficial compartido.
- Acceso externo, incluida FlightAware, centralizado en el backend.
- Testing en `develop` y Production en `main`, con aislamiento total.
- Cliente TypeScript generado pendiente de ADR; Kiota, NSwag y Orval continúan como alternativas.
- Pruebas de arquitectura implementadas sin incorporar una dependencia adicional innecesaria.

## Próximos pasos recomendados

1. Reemplazar CODEOWNERS y configurar protecciones de `main` y `develop` con CI obligatorio.
2. Encender Docker Desktop y ejecutar un build y smoke test del stack local.
3. Crear secretos independientes de Testing en Dokploy y desplegar primero desde `develop`.
4. Exportar y revisar `openapi.json` del endpoint técnico antes de elegir el generador del cliente.
5. Permitir que Laisha inicialice el framework web elegido en una PR independiente.
6. Permitir que Eliezer inicialice Expo/Expo Router en una PR independiente.
7. Diseñar autenticación, autorización y primer vertical slice mediante ADR/contrato antes de implementar negocio.
8. Definir estrategia de backup externo y ejecutar una restauración de prueba antes de Production.

## Estado final

La base solicitada está creada, restaurable, compilable, probada y documentada. La única validación técnica pendiente es ejecutar realmente la imagen y los contenedores cuando el daemon de Docker esté disponible; no existe un error conocido de código o configuración que obligue a usar .NET 9.
