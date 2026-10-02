# Operaciones Dokploy Development

Este directorio contiene plantillas revisables para preparar el VPS Development. No es un instalador y no ejecuta cambios remotos. La guía canónica es [`docs/deployment/dokploy-configuration.md`](../../docs/deployment/dokploy-configuration.md).

## Frontera operativa

- El operador ejecuta cada cambio manualmente y valida el checkpoint antes de continuar.
- Ningún archivo contiene credenciales, auth keys, PAT, connection strings, direcciones personales o valores recuperados del servidor.
- SQL Server, Dokploy, monitoreo y los puertos de Docker/Swarm nunca se publican a Internet.
- Tailscale protege la conectividad; JWT, RBAC y tenant scope siguen siendo responsabilidad de ELEVANT.
- Un fallo de validación detiene la secuencia. No se improvisan bypasses de firewall, tags mutables o eliminación de volúmenes.

## Contenido

| Ruta | Propósito |
| --- | --- |
| `preflight/` | Inventario read-only y saneado para validar cada checkpoint |
| `firewall/` | Tabla nft `inet elevant_firewall` idempotente, rollback exacto y unidad systemd |
| `host/` | Parches Ubuntu/Docker, swap y reboot con gates de recuperación |
| `tailscale/` | Política deny-by-default y enrolamiento seguro del host |
| `ssh/` | Drop-in key-only, verificación efectiva y rollback acotado |
| `traefik/` | Reconciliación manual y rollback a partir del contrato auditado |
| `observability/` | Compose privado de Beszel y contrato de alertas |
| `sql-tools-gateway/` | Gateway TCP privado, sin credenciales, entre Tailscale Services y SQL Development |
| `database-cd/` | Controlador pull-based, bundle OCI v1, cache Compose, lock y estado persistente para promover la DB Development |
| `api-cd/` | Controlador pull-based de API, gate DB, rollback de imagen/Compose y estado persistente |
| `web-cd/` | Controlador genérico con perfiles/estados separados para AVIAM Web y Public Web, gate API exacto y rollback por aplicación |
| `media-storage/` | Compose y configuración de ejemplo del almacén S3 privado; instalación pendiente del operador |

Las fuentes Compose certificadas de SQL permanecen en
`database/DevelopmentDB` y cada entrega incluye sus bytes exactos en el
bundle OCI. `database-cd` los valida, cachea por hash y compara semánticamente
con los Raw vivos; no posee el esquema, secretos ni volúmenes. Separar estos
artefactos evita que una actualización del control plane cambie el ciclo de
vida de la base.

El acceso humano de herramientas SQL usa un recurso Raw independiente. HAProxy
publica solo `127.0.0.1:11433`; usa `elevant-dev-data` exclusivamente para el
backend SQL y la bridge dedicada `elevant-dev-sql-tools-runtime` para
materializar el loopback del host. No termina TLS ni almacena credenciales.
Tailscale anuncia ese listener como
`svc:elevant-dev-sql-tools:1433`; el `1433` de SQL Server continúa sin
publicarse en el host o Internet y cada persona se autentica con una identidad
SQL propia.

Las fuentes Compose web permanecen junto a cada aplicación. GitHub Actions
construye y certifica fuera del VPS una imagen y un bundle OCI independientes
para `aviam-web` y `public-web`. `web-cd` usa el alias
`development-certified` solo para resolver un digest, exige la entrega API
exacta y cambia exclusivamente la variable de imagen del recurso Raw
correspondiente. Los dos recursos mantienen AutoDeploy y Domain desactivados,
publican solo loopback (`18081`/`18082`), no usan la red SQL y se exponen
únicamente mediante Tailscale Serve con Funnel apagado.

La instalación, baseline, adopción y activación de schedules continúan siendo
acciones manuales. El rollout web no está implícito por agregar este directorio
al repositorio. Sus jobs se escalonan a 30 y 45 segundos del minuto, pero los
locks compartidos son la exclusión autoritativa frente a Database/API CD. Mobile
Agent no forma parte de estos runtimes.

## Validación mínima

Antes de entregar un cambio:

```powershell
git diff --check
git grep -n -I -E 'REPLACE_ME_WITH_REAL|tskey-|ghp_|github_pat_' -- ops/dokploy docs/deployment
```

Ejecute además las validaciones específicas de cada subdirectorio. Los
placeholders documentados como `REPLACE_*` no deben sustituirse dentro del
repositorio. Las variables de repositorio que aportan los orígenes web guardan
sus valores en GitHub; las plantillas solo nombran el contrato.
