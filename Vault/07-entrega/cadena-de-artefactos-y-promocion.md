---
id: entrega-cadena-artefactos-promocion
title: "Cadena de artefactos y promoción Development"
type: architecture
area: ci-cd
status: verified
maturity: stable
evidence: repo-verified
owner: equipo-elevant
last_verified: "2026-09-16"
verified_commit: "f533cf2b20c1ded9b68fb10d6edcf2d622551ac4"
sources:
  - .github/workflows/backend-ci.yml
  - .github/workflows/web-ci.yml
  - docs/workflows/release-workflow.md
  - docs/workflows/web-workflow.md
  - docs/adr/0014-bind-api-releases-to-openapi-fingerprint.md
  - docs/adr/0009-pull-based-database-development-cd.md
  - docs/adr/0010-package-development-database-release-as-oci-bundle-v1.md
  - docs/adr/0011-pull-based-api-development-cd.md
  - docs/adr/0012-pull-based-web-development-cd.md
  - ops/dokploy/database-cd/README.md
  - ops/dokploy/api-cd/README.md
  - ops/dokploy/web-cd/README.md
  - backend/scripts/deployment/Dockerfile.api-release-bundle
  - backend/scripts/deployment/certify-api-image.sh
  - frontend/scripts/deployment/resolve-api-release.sh
  - frontend/scripts/deployment/web_release_manifest.py
  - packages/api-client/openapi/source.json
  - packages/api-client/scripts/snapshot-utils.mjs
  - ops/dokploy/web-cd/openapi-tool.mjs
  - scripts/release/path-ownership.sh
tags:
  - entrega
  - artefactos
  - promocion
  - development
---

# Cadena de artefactos y promoción Development

La identidad de una entrega es su digest OCI y su manifiesto validado, no un
tag mutable. GitHub Actions construye y certifica fuera del VPS; el controlador
privado consulta GHCR y decide si el candidato puede sustituir la última
baseline saludable. No hay webhook de GitHub que despliegue dentro de Dokploy.

```mermaid
flowchart TB
    Merge[Push relevante a Development] --> Test[Checks del commit]
    Test --> Class{Clasificación}
    Class -->|DB-owned| DBI[db-ops + db-release]
    DBI --> DBB[Bundle DB: manifiesto + 2 Compose]
    DBB --> DBC[Database CD]
    Class -->|API-owned| APII[Imagen API]
    Contract[Snapshot + descriptor OpenAPI] --> APIGate{Swagger y huella exactos}
    APII --> APIGate
    APIGate --> APIB[Bundle API: manifiesto + Compose + etiqueta OCI]
    APIB --> APIC[API CD]
    APIB --> Resolve[Resolver API exacta]
    Contract --> Resolve
    Class -->|web/API-owned| Resolve
    Resolve --> WEBI[Imagen por web]
    WEBI --> WEBB[Bundle web: manifiesto + Compose]
    WEBB --> WEBC[Web CD: perfil independiente]
    DBC -->|DB compatible| APIC
    APIC -->|API exacta| WEBC
```

El diagrama resume relaciones, no promete que todo push produzca todos los
artefactos. La clasificación de [Workflows y estado](workflows-y-estado.md)
elige los carriles aplicables.

## 1. Base de datos: unidad certificada de tres payloads

Cuando una entrada DB-owned cambia, Backend CI valida esquema, seed,
operaciones y contenedores, publica dos imágenes inmutables (`db-ops` y
`db-release`) y después un bundle OCI v1 con:

- manifiesto cerrado: commit, run, imágenes, migraciones y fingerprints de
  modelo/seed;
- Compose de Database;
- Compose de Database Release.

CI extrae otra vez los tres payloads y exige igualdad byte a byte. Solo al
final mueve `development-certified`, alias de descubrimiento. Database CD
resuelve ese alias a digest, valida etiquetas, hashes, modelo Compose certificado
frente al Raw vivo y `runId` monótono. Bajo un lock común ejecuta backup previo,
migración, seed sintético de Development, verificación, backup posterior y
restore-check. Los backups programados y el restore-check comparten el lock y
la última imagen/Compose aceptados; no pertenecen a un candidato no aprobado.

El controlador no reescribe el Raw de Dokploy, red ni volúmenes. Si un Compose
certificado cambia semánticamente, se requiere reconciliación manual antes de
promover; una diferencia de formato o comentario puede ser equivalente.

## 2. API: base compatible antes de imagen nueva

Backend CI certifica la imagen API y compara el Swagger compilado del commit
con el snapshot OpenAPI. Solo después publica imagen y bundle OCI v1 con
manifiesto y Compose exacto. El manifiesto fija la entrega DB requerida y las
huellas de migraciones y modelo. Sin cambiar ese manifiesto v1, el bundle añade
la etiqueta inmutable `io.elevant.api-release.openapi-sha256`, que debe coincidir
con el descriptor y el snapshot versionados.

API CD acepta la DB requerida exacta o una posterior con ambas huellas
idénticas; una DB anterior o de esquema distinto difiere la API. Una vez
compatible, despliega la imagen por digest y comprueba proceso, readiness,
ping y Swagger. Una API-only puede usar la DB compatible ya aceptada. Cuando
Persistence y API cambian juntos, el job de publicación API depende del éxito
del job DB del mismo run, y el controlador vuelve a comprobar la compatibilidad
en el host.

## 3. Webs: dos ciclos, dependencia API exacta

Web CI clasifica `aviam-web` y `public-web` por separado para la publicación.
Su matriz fija construye y certifica **ambas** webs cuando se dispara el
workflow; cada perfil clasificado publica un bundle OCI v1 propio con manifiesto
cerrado + Compose exacto, vuelve a verificar los payloads y mueve su alias al
final. El bundle fija digest de la imagen web, hash Compose, fingerprint de
configuración, bundle API, `runId`, imagen API y hash canónico OpenAPI usados en
el build.

Antes del build, el resolver exige igualdad entre descriptor, snapshot y etiqueta
del bundle API. `source.json` identifica el contrato; commit, run e imagen API
se derivan del manifiesto inmutable resuelto y se conservan en el manifiesto web
v1. Una referencia inmutable incompatible falla inmediatamente. Si el alias de
descubrimiento todavía apunta a una release anterior sin la etiqueta requerida,
con otra huella o anterior a un input API pendiente, se espera la release nueva.

Un mismo `web-cd` tiene dos perfiles con estado, cache y rollback separados.
Antes de mutar uno exige que **esa API exacta** siga aceptada y viva: estado
`succeeded/complete`, bundle/run/imagen iguales y Swagger con el mismo hash.
No adivina que una API más reciente sea compatible. Un candidato web para una
API distinta se difiere sin consumir el intento; una nueva certificación web
puede fijar la API vigente.

Las webs son previews técnicos independientes: una shell/health saludable no
prueba que la API ya tenga los endpoints de autenticación y negocio de los
prototipos. Ninguna web entra a la red SQL ni mueve el otro perfil.

## Coordinación de fuente y publicación

`scripts/release/path-ownership.sh` es la política común de inputs que producen
API y de cambios que invalidan cada publicación web. Esos paths disparan Backend
CI y Web CI, y los guards rechazan que un run antiguo mueva un alias después de
un cambio relevante. El resolver exige `ELEVANT_SOURCE_COMMIT == HEAD`; una API
anterior solo es reutilizable si pertenece a la misma historia y el diff hasta
ese checkout no contiene ningún input API.

Las publicaciones API, AVIAM y Public comparten el grupo
`development-api-web-release-publication` con `queue: max`. Se ejecutan de una
en una sin sustituir jobs pendientes. Bajo esa exclusión, cada web vuelve a
resolver tanto su digest API transferido como el alias vigente y exige igualdad
byte a byte antes de publicar. Esto cierra la carrera entre certificar una web y
mover el alias API sin cambiar los esquemas v1 ni relajar el gate exacto del VPS.

Límite conocido: un rerun manual de Backend CI para el mismo commit puede crear
otra tupla exacta de run/imagen/bundle sin un push que dispare Web CI. Una web en
curso rechaza el alias cambiado; si se necesita fijar la nueva tupla, se
rerunea Web CI para ese commit.

## Orden y concurrencia

La jerarquía de locks es `database → API → web común → perfil web`. Los polls
se escalonan por minuto (DB al inicio, API a +15 s, AVIAM a +30 s, Public a
+45 s), pero los locks —no las esperas— impiden operaciones concurrentes.
SQL Server y sus volúmenes tienen ciclo de vida separado; promover API o web
no los recrea.

Esa jerarquía pertenece al host. En GitHub, la cola común descrita arriba
serializa la publicación de artefactos API/web; no sustituye los locks ni los
checks de los controladores privados.

Los controladores requieren instalación, adopción de baseline y schedules
habilitados por el operador. Para el procedimiento exacto usa los runbooks
de [Database CD](../../ops/dokploy/database-cd/README.md),
[API CD](../../ops/dokploy/api-cd/README.md) y
[Web CD](../../ops/dokploy/web-cd/README.md); esta nota no sustituye ninguno.
