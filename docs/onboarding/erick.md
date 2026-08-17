# Onboarding backend/operación

Esta guía no concede accesos. Lea `AGENTS.md`, `backend/AGENTS.md`, arquitectura DB v1, migraciones y Dokploy.

## Primer recorrido

1. Restaurar herramientas/locks, compilar y ejecutar toda la solución.
2. Revisar las cinco migraciones y snapshot; ejecutar tests SQL reales.
3. Entender marcador de ambiente, doble guarda Production y seed Development.
4. Validar Compose local/database/release con secretos sintéticos.
5. Revisar identidades DBA/migrator/app/seeder/health/backup.
6. Entender ciclos separados SQL, DB release, API y webs.

## Responsabilidades

- proteger dependencias Clean Architecture y contratos OpenAPI;
- revisar migraciones/SQL idempotente/expand-contract;
- impedir seed/cascadas/acceso cross-tenant indebido;
- mantener API fuera de credenciales elevadas;
- operar backup/restore, GHCR digest, Tailscale y Dokploy sin revelar secretos;
- no desplegar Production antes de licencia, backup off-host y autorización.

Debe poder explicar por qué API no migra al arrancar, por qué Production queda vacía, cómo falla un target cruzado y cómo recuperar Development sin sobrescribir el origen.
