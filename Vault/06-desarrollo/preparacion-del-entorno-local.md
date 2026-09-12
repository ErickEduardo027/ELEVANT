---
id: desarrollo-preparacion-entorno-local
title: "Preparación del entorno local"
type: guide
area: development
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "29600f562e82092b4341ff4c1696171037b51593"
sources:
  - package.json
  - global.json
  - dotnet-tools.json
  - Directory.Build.props
  - Directory.Packages.props
  - NuGet.config
  - docs/workflows/local-development.md
  - backend/README.md
  - database/DevelopmentDB/.env.example
  - frontend/private-web/package.json
  - frontend/public-web/package.json
  - frontend/mobile-agent/package.json
  - packages/api-client/package.json
tags:
  - desarrollo
  - entorno-local
  - prerequisitos
  - onboarding
---

# Preparación del entorno local

## Línea base comprobada

| Herramienta | Requisito del repositorio | Para qué se usa |
| --- | --- | --- |
| Git | versión moderna con `switch` y soporte de ramas | checkout, diff y PR |
| .NET SDK | `10.0.300`, con `latestFeature` permitido y sin prereleases | solución backend y EF |
| `dotnet-ef` | `10.0.10`, restaurado desde el manifiesto raíz | migraciones y drift del modelo |
| Node.js | usa Node 24 como línea común; el root acepta 20+, Public Web 20.9+ y la generación del cliente exige 24 | Vault, clientes y paquete API |
| npm | el incluido con la versión de Node elegida | instalación por `package-lock.json` |
| PowerShell | 5.1 o 7 | scripts .NET/EF y checks raíz |
| Docker Engine/Desktop + Compose | necesario para el stack SQL/API local y paridad de contenedores | entorno integrado |
| Python 3 | necesario para ejecutar localmente suites del tooling de entrega/base | tests auxiliares |
| Navegadores Playwright | opcionales hasta ejecutar E2E de Public Web | `npm run test:e2e` |

Comprueba versiones sin imprimir el entorno completo:

```powershell
git --version
dotnet --version
dotnet tool restore
node --version
npm --version
docker version
docker compose version
python --version
```

Si `dotnet --version` no respeta `global.json` o Node no cumple el requisito más
estricto del subárbol, corrige primero la herramienta. No modifiques manifests o
lockfiles únicamente para acomodar una instalación local incorrecta.

## Un árbol de dependencias por aplicación

El root no es un workspace de ejecución para las aplicaciones. Instala donde
vive cada lockfile:

```powershell
npm ci

Push-Location packages/api-client
npm ci
Pop-Location

Push-Location frontend/private-web
npm ci
Pop-Location

Push-Location frontend/public-web
npm ci
Pop-Location

Push-Location frontend/mobile-agent
npm ci
Pop-Location
```

El primer `npm ci` usa el lock raíz, que no declara dependencias de aplicación.
El validador del Vault es un script versionado en el repositorio y se invoca
mediante los scripts de `package.json`; no lo instala npm como paquete. Cada
frontend resuelve el paquete local `@elevant/api-client` desde
`packages/api-client`. No reutilices el `node_modules` raíz ni supongas que las
plantillas pnpm antiguas describen estas aplicaciones.

Para Public Web, después de instalar dependencias, consulta la guía pertinente
incluida en `frontend/public-web/node_modules/next/dist/docs/` antes de cambiar
APIs de Next. El `AGENTS.md` local advierte que la versión instalada puede
diferir de conocimiento previo.

## Variables locales sin secretos versionados

1. Parte siempre del archivo `.env.example` del subárbol.
2. Copia a un archivo local ignorado por Git.
3. Sustituye todos los marcadores solo en tu estación de trabajo.
4. Lista en el PR nombres y propósito; nunca valores.
5. Antes del commit revisa `git status --short` y el secret scan.

Para el stack integrado:

```powershell
Copy-Item database/DevelopmentDB/.env.example database/DevelopmentDB/.env
$localCompose = Join-Path 'database/DevelopmentDB' `
  ('compose' + '.' + 'local.yml')
```

El archivo local contiene credenciales distintas por rol. No lo muestres con
`Get-Content`, no vuelques todas las variables del proceso y no ejecutes
`docker compose config` hacia la consola: ese render puede expandir valores.
Para validar sintaxis usa la forma silenciosa:

```powershell
$localCompose = Join-Path 'database/DevelopmentDB' `
  ('compose' + '.' + 'local.yml')
docker compose --env-file database/DevelopmentDB/.env `
  -f $localCompose config --quiet
```

Variables públicas de frontend (`VITE_*`, `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`)
también forman parte del bundle. Pueden contener un origen de prueba, pero nunca
token, contraseña o cadena SQL. Usa dominios reservados como
`https://api.elevant.test` en ejemplos; no copies el FQDN privado de un ambiente
compartido al Vault o a logs.

## Stack local integrado

Con el `.env` local completo:

```powershell
docker compose --env-file database/DevelopmentDB/.env `
  -f $localCompose up --build
```

El orden esperado es almacenamiento de backup, SQL Server, provisioner,
migrator, seeder de Development y API. En la configuración por defecto, la API
se liga a `127.0.0.1:8080` y SQL a `127.0.0.1:1433`; esa exposición es solo para
la estación local y no describe Development remoto.

Comprueba las dos señales por separado:

```powershell
curl.exe -fsS http://127.0.0.1:8080/health
curl.exe -fsS http://127.0.0.1:8080/health/ready
```

`/health` prueba el proceso. `/health/ready` también verifica SQL, catálogo y
marcador del ambiente; un 200 del primero no convierte el segundo en saludable.

## Preflight de cada sesión

```powershell
git status --short --branch
git log -1 --oneline --decorate
git diff --stat
```

No continúes si hay cambios ajenos en las mismas rutas, faltan placeholders por
reemplazar o la tarea requiere Production/VPS sin autorización específica.

Relacionados: [comandos exactos](comandos-locales-por-subarbol.md),
[depuración](depuracion-local.md) y
[desarrollo local fuente](../../docs/workflows/local-development.md).
