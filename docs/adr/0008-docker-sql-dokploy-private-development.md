# ADR-0008: SQL Server Docker y Development privado en Dokploy

## Estado

Accepted — 2026-08-17 para preparar Development. El rechazo de un Service SQL
fue modificado únicamente para el acceso humano controlado por
[ADR-0013](0013-development-ssms-data-access.md). Production queda fuera de
alcance.

## Contexto

ELEVANT necesita SQL Server 2022, pero Dokploy no ofrece MSSQL como base administrada. El KVM 2 alojará inicialmente base, API y las dos webs; Mobile será nativo. Aún no existe dominio propio y no se debe exponer SQL/panel/ambiente de pruebas a Internet.

## Decisión

- Ejecutar SQL Server oficial Linux en Docker Compose con tag CU + digest, named volume y red internal.
- Separar ciclo manual de SQL/volúmenes del release migrator/seeder y de API/webs.
- Usar Developer Edition exclusivamente para Development sintético.
- Construir/probar imágenes en CI y consumir GHCR por digest; no compilar en el VPS.
- Aplicar migraciones con bundle EF one-shot, nunca al arrancar API.
- Ejecutar seed solo en Development con login/marker propios.
- Usar Tailscale Services + Serve HTTPS para API, AVIAM Web, Public Web y Dokploy, todos con hostnames separados y loopback targets.
- No usar Funnel, self-signed, 1433 público o anuncio de toda la subnet Docker.
- Mobile se distribuye como APK; accede por HTTPS/Tailscale y no es un servicio Dokploy.

## Consecuencias

- un redeploy de aplicación no recrea SQL;
- se necesitan GHCR, tailnet/grants, firewall proveedor y operación de backup;
- los tres clientes mantienen una sola API/base, pero deployments independientes;
- sin backup off-host Development debe seguir completamente reconstruible;
- Production requerirá otra instancia, licencia SQL válida, dominios y continuidad antes de datos reales.

Guía ejecutable: `docs/deployment/dokploy.md`.
