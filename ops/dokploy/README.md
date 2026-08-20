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

Los Compose certificados de SQL permanecen en `backend/infrastructure/docker`. Separar estos artefactos evita que una actualización del control plane cambie el ciclo de vida de la base.

## Validación mínima

Antes de entregar un cambio:

```powershell
git diff --check
git grep -n -I -E 'REPLACE_ME_WITH_REAL|tskey-|ghp_|github_pat_' -- ops/dokploy docs/deployment
```

Ejecute además las validaciones específicas de cada subdirectorio. Los placeholders documentados como `REPLACE_*` no deben sustituirse dentro del repositorio.
