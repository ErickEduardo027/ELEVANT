---
id: desarrollo-depuracion-local
title: "Depuración local segura"
type: runbook
area: development
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "29600f562e82092b4341ff4c1696171037b51593"
sources:
  - docs/workflows/local-development.md
  - backend/README.md
  - database/DevelopmentDB/README.md
  - frontend/private-web/README.md
  - frontend/public-web/README.md
  - frontend/mobile-agent/README.md
  - packages/api-client/README.md
tags:
  - desarrollo
  - depuracion
  - troubleshooting
  - local
---

# Depuración local segura

Este runbook diagnostica el checkout y el stack local. No contiene comandos del
VPS ni autoriza tocar Development compartido. La regla es observar primero,
reproducir con el comando propietario y conservar evidencia sanitizada.

## 1. Identificar el estado sin mutarlo

```powershell
git status --short --branch
git diff --stat
dotnet --version
node --version
npm --version
docker version
docker compose version
```

Confirma después el subárbol afectado y su `AGENTS.md`, README, manifest y lock.
No instales una versión “parecida” para ocultar una incompatibilidad: usa
`global.json` y las restricciones de Node del repositorio.

## 2. Observar el stack local

Con el `.env` local ya preparado:

```powershell
$localCompose = Join-Path 'database/DevelopmentDB' `
  ('compose' + '.' + 'local.yml')

docker compose `
  --env-file database/DevelopmentDB/.env `
  -f $localCompose `
  ps

docker compose `
  --env-file database/DevelopmentDB/.env `
  -f $localCompose `
  logs --no-color --tail 100 sqlserver provisioner migrator seeder-development api
```

No uses `docker compose config` sin `--quiet`: el render puede expandir valores
del archivo de entorno. Antes de compartir logs, elimina tokens, passwords,
cadenas de conexión, correos o datos de personas.

Comprueba por separado proceso y dependencias:

```powershell
curl.exe -fsS http://127.0.0.1:8080/health
curl.exe -fsS http://127.0.0.1:8080/health/ready
```

`/health` puede estar verde mientras `/health/ready` falla si SQL o la
migración todavía no están listos. No conviertas readiness en un probe solo de
proceso para ocultarlo.

## 3. Tabla de síntomas

| Síntoma | Comprobación | Resolución no destructiva |
| --- | --- | --- |
| restore locked falla | manifiesto y lock cambiaron juntos | restaura el lock correcto o corrige dependencias; no quites `--locked-mode` |
| build backend falla tras cambio EF | modelo, migración y snapshot | ejecuta build y pending-model; genera migración con el script |
| SQL sano pero API no ready | logs de provisioner/migrator/seeder-development/API en orden | corrige la primera etapa fallida y vuelve a iniciar el stack |
| seed falla al repetir | invariantes/idempotencia del seeder | corrige el seeder; no limpia tablas a mano para lograr verde |
| puerto local ocupado | `Get-NetTCPConnection -LocalPort 8080 -ErrorAction SilentlyContinue` | identifica el dueño y selecciona el flujo aprobado; no mates procesos desconocidos |
| Private Web rechaza build | ambas `NEXT_PUBLIC_*_API_URL` y `NEXT_PUBLIC_HR_DEMO_MODE`, mismo origen HTTPS DNS sin ruta | usa un origen `.test` local válido y vuelve a ejecutar el validator |
| Public Web rechaza tipos | documentación Next instalada y salida de `next typegen` | `npm ci`, luego `npm run typecheck`; corrige fuente, no `.next` |
| Mobile abre pero no alcanza API | origen alcanzable desde dispositivo y conectividad | recuerda que `localhost` es la tablet/emulador; usa una ruta local autorizada |
| Mobile falla con API client | resolución Metro y bundle seam | ejecuta `lint`, `typecheck` y `test:api-client-bundle` |
| `check:openapi` deriva | API local y snapshot del mismo commit | revisa Swagger real; regenera solo si el contrato cambió intencionalmente |
| Vault check deriva | frontmatter, links, sources e inventario | corrige notas y ejecuta `vault:generate`; no edites `_generated` |

## 4. Reducir el problema

1. Reproduce con el script exacto del manifest, no con una invocación abreviada.
2. Ejecuta la prueba más pequeña que falla y registra comando + exit code.
3. Compara contra el último commit sin descartar cambios ajenos.
4. Si el error cruza fronteras, prueba en orden DB → API → OpenAPI → cliente.
5. Tras corregir, vuelve a ejecutar la suite completa del subárbol.

Para frontend, inspecciona Network/Console sin pegar respuestas con datos reales
en issues. Para backend, conserva status code, Problem Details sanitizado y un
correlation identifier si existe; no agregues payloads sensibles a logs.

## 5. Acciones que este runbook excluye

- borrar volúmenes, bases, migraciones, locks o artefactos de otros autores;
- `git reset --hard`, force-push o reescritura de historia compartida;
- desactivar TLS, autorización, aislamiento tenant o validadores;
- reutilizar secrets de Development/VPS en local;
- conectarse directamente a SQL desde un cliente;
- desplegar para comprobar un cambio que todavía falla localmente.

Si la única salida parece destructiva, detente. Entrega el comando, error
sanitizado, commit, subárbol y acciones ya intentadas según la
[plantilla de handoff](definition-of-done-y-handoff.md#handoff-reproducible).
