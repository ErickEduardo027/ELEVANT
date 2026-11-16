# Rollback de despliegue

Este procedimiento se completa con datos específicos de cada liberación. No
autoriza ejecutar cambios en Production sin una aprobación separada. Para
Development, los controladores DB, API y Web conservan estado, locks y una
baseline certificada; este resumen no sustituye sus runbooks
([DB](../../ops/dokploy/database-cd/README.md),
[API](../../ops/dokploy/api-cd/README.md),
[Web](../../ops/dokploy/web-cd/README.md)).

El bootstrap del VPS, firewall, Tailscale y Traefik tiene checkpoints propios en
[`dokploy-configuration.md`](dokploy-configuration.md). Su rollback temporizado se
prueba antes de desplegar DB; no use un rollback de aplicación para modificar
reglas de host o volúmenes SQL.

## Antes del despliegue

- Registrar los digests, manifiestos y hashes de Compose de la baseline anterior
  y del candidato, sin copiar secretos.
- Confirmar backup recuperable cuando exista cambio de datos.
- Clasificar la migración como compatible hacia atrás o irreversible.
- Definir señales de aborto: health, errores, latencia y validaciones funcionales.

## Aplicación

Si el esquema sigue siendo compatible, aislar solo el perfil afectado y comprobar
el resultado del controlador. Una promoción API o Web que falla después de
iniciar el despliegue restaura el **par certificado anterior de imagen y
Compose/hash**, y repite el health y smoke propios del servicio. No basta con
seleccionar manualmente una etiqueta o imagen anterior en Dokploy: se perdería
la verificación del Compose y del estado aceptado. Si el rollback falla, el
perfil queda pausado; el operador debe diagnosticarlo según su runbook antes de
reanudar o reintentar. No ejecutar `docker compose down`, eliminar redes ni
recrear SQL para revertir una API o una web. Conservar evidencia saneada del
artefacto fallido y verificar que los demás workloads no cambiaron.

## Base de datos

Una migración DB promovida no se revierte automáticamente cuando falla una API
posterior. No ejecutar migraciones descendentes ni restaurar SQL por un rollback
de aplicación. Si el cambio de esquema no es compatible, detener escrituras
afectadas y aprobar un procedimiento específico para esa migración. Restaurar un
backup es la última medida y exige validar pérdida de datos respecto del RPO
acordado; nunca se hace con `docker compose down` ni borrando volúmenes.

## Cierre

Registrar causa, impacto, acciones ejecutadas y estado final. Rotar credenciales si
hubo exposición y crear tareas de corrección antes de reintentar la liberación.
