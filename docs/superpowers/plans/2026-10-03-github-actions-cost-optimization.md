# Optimización de minutos de GitHub Actions

## Spec y límites

El objetivo es reducir minutos facturables de CI/CD sin perder pruebas, certificación, seguridad ni identidad de artefactos. Se trabaja solo en workflows, scripts de clasificación y sus pruebas/documentación. No se toca el VPS ni se publica una release desde esta rama. El operador evaluará el primer cambio de producto posterior al merge. La rama parte de `Development` y preserva el checkout sucio original.

La clasificación distingue entradas de validación de entradas que realmente cambian un artefacto de release. Los cambios exclusivos de CI/documentación no publican DB, API ni webs. Un path desconocido dentro de un producto se trata conservadoramente como entrada de validación y release; un path desconocido fuera de productos exige revisión del clasificador. En PR se ejecutan las validaciones de los productos afectados, con un estado agregado estable. En Development, DB→API→web usa dependencias entre jobs; un web-only reutiliza una API certificada compatible sin polling de 30 minutos. Un fallo, cancelación o manifiesto incompatible impide publicar el consumidor. El escaneo de secretos permanece en cada PR/push relevante.

## Task 1: Clasificación verificable de cambios

**Files:** `scripts/release/path-ownership.sh`, `scripts/release/tests/test-path-ownership.sh`, `scripts/release/classify-changes.sh`, `scripts/release/tests/test-classify-changes.sh`.

**Produces:** flags separados para validar backend/web/ops y publicar DB/API/AVIAM/Public, con matrices por app; salida GitHub Output sin ambigüedad.

**Steps:**
1. Escribir fixtures RED para docs-only, CI-only, backend, migración EF, web individual, cliente compartido, ops, renombre y borrado.
2. Ejecutar las pruebas y constatar fallos por comportamiento ausente.
3. Implementar el clasificador; mantener guardas de linaje coherentes.
4. Ejecutar `bash scripts/release/tests/test-path-ownership.sh` y `bash scripts/release/tests/test-classify-changes.sh`.

**Expected:** ambas pruebas pasan y un cambio exclusivo de workflows produce cero releases.

## Task 2: Cadena Development sin runners en espera

**Files:** `.github/workflows/backend-ci.yml`, `.github/workflows/web-ci.yml`, `.github/workflows/development-delivery.yml`, pruebas de contrato de workflow.

**Consumes:** flags de Task 1. **Produces:** workflow coordinador que llama backend y web con `needs`, y pasa referencia API inmutable de la misma ejecución cuando corresponde.

**Steps:**
1. Escribir pruebas RED sobre triggers, DAG, propagación de manifiesto, matrices y no-publicación para CI-only.
2. Convertir backend/web en workflows reutilizables y mantener PR/main validation. Quitar sus pushes directos a Development para impedir duplicados.
3. Hacer que el build web use la referencia API explícita o resuelva una vez el alias compatible; eliminar el polling facturable. Mantener revalidación exacta de publisher, locks, SHA/run/attempt y alias-last.
4. Ejecutar pruebas, parser/actionlint y suites de despliegue.

**Expected:** un push backend+web usa DB→API→web, web-only no ejecuta backend pesado y CI-only no produce bundles.

## Task 3: Resto de workflows y costo por PR

**Files:** `.github/workflows/ops-config-ci.yml`, `.github/workflows/api-client-ci.yml`, `.github/workflows/mobile-ci.yml`, `.github/workflows/vault-ci.yml`, pruebas de contrato.

**Consumes:** clasificación de Task 1. **Produces:** operaciones pesadas solo cuando cambian sus inputs, escaneo universal independiente y validación de clientes sin jobs redundantes; Mobile/Vault conservan sus gates.

**Steps:**
1. Escribir pruebas RED de disparadores y protección del escaneo de secretos.
2. Separar escaneo universal de operaciones pesadas y seleccionar validaciones de cliente sin eliminar cobertura transversal.
3. Ejecutar pruebas de contrato, `npm run check`, `npm run vault:ci`.

**Expected:** docs/CI-only evita tests caros, pero siempre mantiene escaneo de secretos y chequeos relevantes.

## Task 4: Evidencia, documentación y cierre

**Files:** `Vault/07-entrega/*`, `docs/workflows/release-workflow.md`, `.github/BRANCH_PROTECTION.md`, este plan.

**Consumes:** workflows finales. **Produces:** explicación de clasificación, DAG, estados requeridos, forma de medir ahorro y fallback.

**Steps:**
1. Actualizar fuentes y notas Vault solo tras verificar cada afirmación; regenerar inventario.
2. Ejecutar pruebas enfocadas, validación de YAML/actionlint, `npm run vault:generate`, `npm run vault:check`, `npm run check`, y comparar diff sin secretos ni artefactos.
3. Revisión integral de rama y una pasada de correcciones RED→GREEN para hallazgos importantes.

**Expected:** CI local verde; ningún merge/despliegue realizado. El ahorro real se mide en al menos cinco ejecuciones comparables tras integrar la rama, no se declara como hecho antes.

## Review focus

Revisar especialmente: triggers duplicados o ausentes; jobs `needs` omitidos cuando otro queda `skipped`; permisos de `GITHUB_TOKEN` en workflows reutilizables; coincidencia SHA/run/attempt; web-only con API preexistente; fallo/cancelación/stale; `pull_request` de forks; publicación de CI-only; escaneo universal; matriz de una sola web; cambios renombrados o borrados; y compatibilidad con los guards de linaje.
