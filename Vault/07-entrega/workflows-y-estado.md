---
id: entrega-workflows-estado
title: "Workflows activos y estado de CI/CD"
type: reference
area: ci-cd
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-10-03"
verified_commit: "913fb3d5eedc7de9444eac15836d9cdd9a89706f"
sources:
  - .github/workflows/pull-request-ci.yml
  - .github/workflows/development-delivery.yml
  - .github/workflows/backend-ci.yml
  - .github/workflows/web-ci.yml
  - .github/workflows/api-client-ci.yml
  - .github/workflows/ops-config-ci.yml
  - .github/workflows/vault-ci.yml
  - .github/workflows/mobile-ci.yml
  - .github/workflows/secret-scan.yml
  - scripts/release/classify-changes.sh
  - .github/BRANCH_PROTECTION.md
  - docs/workflows/release-workflow.md
tags:
  - entrega
  - workflows
  - ci
  - estado
---

# Workflows activos y estado de CI/CD

GitHub Actions distingue validación de PR y publicación después de un push.
Los nueve archivos `.yml` siguientes son workflows activos. Los coordinadores
evitan ejecuciones duplicadas de Backend/Web en `Development` y de los carriles
por separado en PR. Mobile valida fuente y empaquetado Metro, pero no construye
ni distribuye una APK firmada.

| Workflow | Cuándo corre | Validación principal | Publicación automática |
| --- | --- | --- | --- |
| [Pull request CI](../../.github/workflows/pull-request-ci.yml) | todo PR a `main` o `Development` | clasifica rutas, llama los carriles aplicables y exige el gate final estable | ninguna |
| [Development delivery](../../.github/workflows/development-delivery.yml) | push a `Development` con rutas de backend, DB, web o tooling de release | ordena Backend antes de Web y pasa la referencia API inmutable del mismo run | delega la publicación a los carriles aplicables |
| [Backend CI](../../.github/workflows/backend-ci.yml) | llamado por coordinadores; push relevante a `main` | restore bloqueado, build, tests, SQL 2022, modelo/migraciones, OpenAPI, Compose e imágenes | solo push relevante a `Development`: DB y/o API según clasificación |
| [Web clients CI and Development delivery](../../.github/workflows/web-ci.yml) | llamado por coordinadores; push relevante a `main` | clasifica aplicaciones; valida y certifica solo los perfiles afectados | solo push web-owned a `Development`: publica AVIAM y/o Public clasificado |
| [API client CI](../../.github/workflows/api-client-ci.yml) | llamado por PR; push relevante a `main` o `Development` | compila API del commit, compara Swagger/snapshot, valida generado y consumo del cliente compartido | ninguna |
| [Operations configuration CI](../../.github/workflows/ops-config-ci.yml) | llamado por PR con rutas operativas; push relevante a `main` o `Development` | artefactos operativos sin secretos, sintaxis, modelos y tests | ninguna |
| [Vault CI](../../.github/workflows/vault-ci.yml) | llamado por todo PR; todo push a `main` o `Development` | metadata, enlaces, evidencia, Mermaid, Canvas/Base, privacidad e inventario sin reescribirlo | ninguna |
| [Mobile Agent CI](../../.github/workflows/mobile-ci.yml) | llamado por PR con rutas Mobile/cliente compartido; push relevante a `main` o `Development` | instalación bloqueada, lint, tipos, smoke del cliente compartido y export Android con Metro | ninguna; no crea ni distribuye una APK |
| [Repository secret scan](../../.github/workflows/secret-scan.yml) | llamado por todo PR; todo push a `main` o `Development` | secretos y contratos de clasificación/cobertura de workflows | ninguna |

En PR el clasificador selecciona los carriles según inputs de validación; que
uno se omita puede ser correcto, pero el gate final falla si se omite uno
requerido. Vault y el escaneo de secretos nunca se filtran por rutas. Los jobs
de publicación de backend/web además comprueban evento `push`,
ref `Development`, clasificación de entradas y éxito previo; no publican por
el solo hecho de abrir un PR ni por un push a `main`.

## Clasificación que evita entregas innecesarias

- Backend distingue entradas **DB-owned** y **API-owned**. Algunos cambios de
  API/contratos también son DB-owned porque el bundle EF compila el proyecto
  de arranque. Una entrada de Persistence puede afectar ambos carriles.
- Web distingue `aviam-web` y `public-web` para **validación y publicación**;
  cambiar una sola aplicación ya no construye la otra. El paquete API
  compartido o tooling común puede clasificar ambas.
- API client CI valida contrato y costuras compartidas, pero no es un cuarto
  servicio del VPS ni repite los tests completos de cada aplicación.
- Un cambio exclusivo de workflows o documentación no publica imágenes. Una
  entrada API nueva pasa a Web CI por dependencia `needs` y referencia inmutable;
  un cambio solo web reutiliza una API certificada compatible sin polling largo.

La clasificación es la del YAML, no una regla informal sobre nombres de PR.
Puede cambiar cuando cambie el workflow; revisa el diff de rutas y el resumen
del run exacto.

## Qué significa un check verde

Un PR verde demuestra que los jobs aplicables terminaron bien para un commit y
un entorno de CI. No prueba que se fusionó, que se publicó un digest, que el
controlador lo aceptó, ni que el runtime actual sigue saludable. Después del
merge, un run de push puede fallar por dependencias, registro, gate de
compatibilidad o infraestructura aun si el PR pasó. Consulta
[Gates, fallos y no-op](gates-fallos-y-no-op.md).

Un PR sin conflictos solo permite combinar texto; no fuerza CI verde. Además,
la [protección de ramas documentada](../../.github/BRANCH_PROTECTION.md)
advierte que el plan actual del repositorio privado no impone técnicamente PR
obligatorio. La revisión humana es norma de equipo, pero un colaborador con
permiso write podría hacer push directo a `Development` y disparar publicación
tras los gates.

## Cómo verificar una ejecución concreta

Para responder “¿pasó mi cambio?”, revisa en GitHub Actions el workflow, SHA,
evento, jobs aplicables y conclusión del run. Para responder “¿se desplegó?”,
añade digest publicado y el estado aceptado del controlador/perfil del host,
con evidencia saneada y fechada. Un alias mutable no es la identidad de la
entrega; el digest sí.

La [cadena de artefactos](cadena-de-artefactos-y-promocion.md) explica qué
relación debe coincidir entre DB, API y webs. El [Mobile Agent](mobile-apk-ci-cd.md)
tiene una frontera separada y todavía diferida.
