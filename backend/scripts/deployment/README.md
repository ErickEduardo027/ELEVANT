# Development API release tooling

These helpers are the secret-free CI boundary for the shared ELEVANT API. They
do not contact the VPS and never deploy an application directly.

`api_release_manifest.py` creates the strict schema-v1 document consumed by the
private API CD controller. It binds one API image digest and the reviewed API
Compose bytes to the exact certified database release that must already be
compatible. The database dependency records both its immutable bundle reference
and its migration/model fingerprints.

The OCI delivery bundle is built with `Dockerfile.api-release-bundle` and has
exactly these reviewed payloads:

```text
/manifest.json
/compose/compose.development.api.yml
```

The mutable `development-certified` tag is discovery-only. CI validates the
bundle again after pulling it by digest and moves that tag only after every
other publication step and a final stale-run guard succeed.

`resolve-database-release.sh` resolves a database alias to an immutable digest,
validates the database bundle and waits for its checked-out migration, model,
seed and Compose fingerprints to match. An immutable but incompatible input
fails immediately; a discovery alias is polled for at most 30 minutes.

`certify-api-image.sh` validates the exact image transferred between CI jobs. It
checks OCI provenance, the non-root runtime, liveness, unavailable-database
readiness behavior, ping, OpenAPI, exact positive/negative CORS preflights, and
the invariant that API startup does not invoke migrations.

`guard-api-publication.sh` fetches the current `Development` tip immediately
before a mutable alias is moved. It rejects divergent history and any newer
change that affects the API image, API release contract, or Development database
provenance. Immutable artifacts already pushed by a superseded run are harmless
and remain addressable by digest.

GHCR does not offer an atomic compare-and-swap spanning a Git ref and an OCI
tag. A minimal window therefore remains between the final check and the alias
push. The guard, serialized publication and controller `runId` ordering prevent
persistent regressions, but an older run's alias could be visible transiently
if a new push lands in those exact milliseconds. Immutable digests, not the
alias, remain the audit and rollback identity.

Run the deterministic local tests from the repository root:

```bash
python3 -m unittest discover -s backend/tests/scripts -p 'test_*.py' -v
bash backend/tests/scripts/test_guard_api_publication.sh
```
