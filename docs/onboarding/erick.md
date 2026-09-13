# Onboarding backend/operación

Esta guía no concede accesos. Lea [`AGENTS.md`](../../AGENTS.md),
[`backend/AGENTS.md`](../../backend/AGENTS.md),
[`database/AGENTS.md`](../../database/AGENTS.md), la
[arquitectura DB v1](../architecture/database-v1.md), las migraciones y los
runbooks revisados de [`ops/dokploy`](../../ops/dokploy/README.md). Para
orientación transversal, comience por el [Vault](../../Vault/README.md).

## Primer recorrido

1. Restaurar herramientas/locks, compilar y ejecutar toda la solución.
2. Revisar las cinco migraciones y snapshot; ejecutar tests SQL reales.
3. Entender marcador de ambiente, doble guarda Production y seed Development.
4. Validar Compose local/database/release con secretos sintéticos.
5. Revisar identidades DBA/migrator/app/seeder/health/backup.
6. Entender ciclos separados SQL, DB release, API y webs, y distinguirlos del
   diseño diferido de entrega Mobile.

## Responsabilidades

- proteger dependencias Clean Architecture y contratos OpenAPI;
- revisar migraciones/SQL idempotente/expand-contract;
- impedir seed/cascadas/acceso cross-tenant indebido;
- mantener API fuera de credenciales elevadas;
- operar backup/restore, GHCR digest, Tailscale y Dokploy sin revelar secretos;
- no desplegar Production antes de licencia, backup off-host y autorización.

Debe poder explicar por qué API no migra al arrancar, por qué Production queda vacía, cómo falla un target cruzado y cómo recuperar Development sin sobrescribir el origen.

Una promoción observada requiere evidencia del run y del controlador; que el
workflow exista o que CI esté verde no demuestra el estado vivo del VPS.
Consulte [CI/CD](../../Vault/07-entrega/README.md) y
[Operaciones](../../Vault/09-operaciones/README.md) antes de atribuir una
entrega a un commit.
