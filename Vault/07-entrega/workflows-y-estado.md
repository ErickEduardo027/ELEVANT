---
id: entrega-workflows-estado
title: "Workflows activos y estado de CI/CD"
type: reference
area: ci-cd
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-12"
verified_commit: "c2a060179983a13b7e5a0dd45cba1a1fd2e54e8a"
sources:
  - .github/workflows/backend-ci.yml
  - .github/workflows/web-ci.yml
  - .github/workflows/api-client-ci.yml
  - .github/workflows/ops-config-ci.yml
  - .github/workflows/vault-ci.yml
  - .github/workflows/mobile-ci.yml.template
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
Los cinco archivos `.yml` siguientes son workflows activos. El archivo móvil
terminado en `.yml.template` **no** lo es.

| Workflow | Cuándo corre | Validación principal | Publicación automática |
| --- | --- | --- | --- |
| [Backend CI](../../.github/workflows/backend-ci.yml) | PR/push a `main` o `Development` con rutas backend/DB/controlador API y tooling .NET | restore bloqueado, build, tests, SQL 2022, modelo/migraciones, OpenAPI, Compose e imágenes | solo push relevante a `Development`: DB y/o API según clasificación |
| [Web clients CI and Development delivery](../../.github/workflows/web-ci.yml) | PR/push a esas ramas con rutas de ambas webs, cliente API o tooling web | clasifica aplicaciones; la matriz fija construye y certifica **ambas** webs | solo push web-owned a `Development`: publica el perfil AVIAM y/o Public clasificado |
| [API client CI](../../.github/workflows/api-client-ci.yml) | PR/push a esas ramas con contrato, API o costuras seleccionadas de tres clientes | compila API del commit, compara Swagger/snapshot, valida generado y consumo Private/Public/Mobile | ninguna |
| [Operations configuration CI](../../.github/workflows/ops-config-ci.yml) | todo PR/push a `main` o `Development` | artefactos operativos sin secretos, sintaxis, modelos y tests | ninguna |
| [Vault CI](../../.github/workflows/vault-ci.yml) | todo PR/push a `main` o `Development` | metadata, enlaces, evidencia, Mermaid, Canvas/Base, privacidad e inventario sin reescribirlo | ninguna |
| [Mobile CI template](../../.github/workflows/mobile-ci.yml.template) | no se ejecuta como workflow | diseño de validación de fuente | ninguna; APK firmada tampoco |

Los filtros `paths` de backend, web y cliente API son diferentes: que uno no
aparezca en un PR puede ser correcto. Operations y Vault no tienen filtro de
rutas. Los jobs de publicación de backend/web además comprueban evento `push`,
ref `Development`, clasificación de entradas y éxito previo; no publican por
el solo hecho de abrir un PR ni por un push a `main`.

## Clasificación que evita entregas innecesarias

- Backend distingue entradas **DB-owned** y **API-owned**. Un cambio exclusivo
  de API/contratos no produce automáticamente una nueva entrega DB; una entrada
  de Persistence puede afectar ambos carriles.
- Web distingue `aviam-web` y `public-web` para **publicación**. CI construye y
  certifica ambos perfiles en su matriz fija incluso si cambia uno solo;
  cambiar un cliente puede publicar sólo ese perfil, mientras el paquete API
  compartido o tooling común puede clasificar ambos.
- API client CI valida contrato y seams, pero no es un cuarto servicio del VPS.

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
