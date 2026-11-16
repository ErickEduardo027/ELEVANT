# ADR-0009: CD pull-based para la base Development

## Estado

Accepted — 2026-08-23. Solo aplica a la base sintética de Development;
Production, API y clientes quedan fuera de esta decisión.

El empaquetado de solo `/manifest.json` y la comparación de Compose descritos
en esta decisión fueron sustituidos por el bundle OCI v1 de
[ADR-0010](0010-package-development-database-release-as-oci-bundle-v1.md). El
modelo pull-based y la secuencia de promoción permanecen vigentes.

## Contexto

DB v1 ya corre en el VPS privado de Development con SQL Server, migraciones EF,
seed idempotente, backups y restore-check. El equipo necesita que un cambio de
esquema o seed validado en `Development` llegue al ambiente compartido sin
copiar digests manualmente en Dokploy.

El VPS no debe exponer Dokploy, SSH, SQL ni Docker a GitHub. El repositorio es
privado y usa GitHub Free, por lo que Actions/GHCR están disponibles pero no se
puede imponer branch protection. El equipo acepta temporalmente que cualquier
colaborador con permiso de escritura pueda disparar la entrega con un push
directo a `Development`.

## Decisión

- CI continúa construyendo y certificando `elevant-db-ops` y
  `elevant-db-release` fuera del VPS.
- Solo un push a `Development` que afecte el producto de base publica una
  entrega. Un cambio exclusivo de API no promueve esquema/seed.
- Los workflows de push usan una identidad de concurrencia por commit; un push
  posterior que no sea DB-owned no cancela una entrega DB válida. La publicación
  del manifiesto se serializa y un run antiguo se niega a mover el alias si una
  revisión posterior cambió entradas DB-owned.
- Las dos imágenes se publican y se fijan por digest. Después se publica un
  tercer artefacto OCI privado con el manifiesto de entrega y se mueve el alias
  de descubrimiento `development-certified`. Publicar el manifiesto es el
  último paso; una ejecución incompleta no queda anunciada como candidata.
- Un controlador instalado manualmente en el plano privado de Dokploy consulta
  ese alias. El alias solo sirve para descubrir el digest del manifiesto; el
  controlador ejecuta exclusivamente referencias `@sha256:` contenidas y
  validadas en el manifiesto.
- Cada promoción obtiene un lock único y ejecuta, en orden: backup con el
  artefacto operativo aceptado, migración, seed Development, verificación con
  el artefacto candidato, backup posterior y restore-check.
- Los jobs programados de backup y restore-check usan el mismo controlador y
  lock. Nunca se solapan con una promoción.
- El estado aceptado/fallido se escribe atómicamente en almacenamiento
  persistente. Una promoción que ya creó su intento y falla no se reintenta
  automáticamente; requiere una entrega corregida con otro digest o un retry
  manual explícito. Los errores de descubrimiento/extracción/validación anteriores
  al intento pueden evaluarse otra vez por el poll, siempre antes de ejecutar SQL.
- Tras adoptar la v1, el controlador exige que el `runId` avance respecto del
  último manifiesto aceptado. Un rerun antiguo que repunte el alias se ignora sin
  ejecutar SQL.
- No se ejecuta `Down`, no se edita `__EFMigrationsHistory`, no se restaura
  automáticamente sobre la base origen y no se recrean SQL, red o volúmenes.
- El resultado queda visible en los logs/jobs de Dokploy y, si el operador
  instala un token fino dedicado, como commit status de GitHub. El token vive
  solo en un archivo root-only del VPS y dispone únicamente de Metadata read y
  Commit statuses write.

## Contrato del manifiesto

La versión inicial contiene:

- versión del esquema y ambiente exacto `Development`;
- repositorio, ref, commit, run, intento y URL del workflow;
- referencias inmutables de las imágenes ops/release;
- SHA-256 de ambos Compose;
- cadena y fingerprint de migraciones, snapshot del modelo y seed;
- instante de publicación UTC.

CI valida el JSON antes de empaquetarlo. El controlador vuelve a validar tipos,
valores permitidos, repositorio/ref esperados, digests, hashes de Compose y
labels OCI antes de ejecutar una etapa.

## Consecuencias

- GitHub nunca inicia una conexión al VPS; el host privado tira de GHCR.
- Un redeploy de API/web no toca SQL y un cambio de base no despliega clientes.
- Las credenciales SQL y GHCR de lectura permanecen en Dokploy/VPS.
- El primer despliegue e instalación del controlador siguen siendo manuales y
  checkpoint por checkpoint.
- Las migraciones, el modelo, el seed y las herramientas DB siguen el carril
  automático normal. Un cambio del propio Compose, red, volúmenes, permisos o
  controlador se detiene por drift y requiere reconciliación operativa manual;
  el CD no reescribe infraestructura Raw del VPS.
- La protección por digest y los gates reducen el riesgo, pero no sustituyen la
  revisión obligatoria que falta en GitHub Free. Al disponer de Pro/Team se
  habilitará branch protection sin rediseñar esta entrega.
- Los digests y labels prueban consistencia, no procedencia criptográfica. Un
  actor que obtuviera escritura tanto en el repositorio/workflow como en GHCR
  aún podría fabricar una entrega coherente. Al habilitar branch protection se
  añadirá también attestation/firma verificable de GitHub Actions antes de
  considerar este patrón para datos no descartables.
- Production necesita una decisión separada, sin seed y con controles de
  aprobación, licencia, backup off-host y recuperación propios.

Guías operativas:
[`docs/deployment/dokploy-configuration.md`](../deployment/dokploy-configuration.md)
y [`ops/dokploy/database-cd/README.md`](../../ops/dokploy/database-cd/README.md).
