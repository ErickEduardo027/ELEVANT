# Rollback de despliegue

Este procedimiento se completa con datos específicos de cada liberación. No
autoriza ejecutar cambios en Production sin la aprobación de Erick.

El bootstrap del VPS, firewall, Tailscale y Traefik tiene checkpoints propios en
[`dokploy-configuration.md`](dokploy-configuration.md). Su rollback temporizado se
prueba antes de desplegar DB; no use un rollback de aplicación para modificar
reglas de host o volúmenes SQL.

## Antes del despliegue

- Registrar la imagen o digest anterior y la nueva.
- Confirmar backup recuperable cuando exista cambio de datos.
- Clasificar la migración como compatible hacia atrás o irreversible.
- Definir señales de aborto: health, errores, latencia y validaciones funcionales.

## Aplicación

Si el esquema sigue siendo compatible, detener la promoción y volver a desplegar la
imagen anterior mediante Dokploy. Verificar `/health`, `/health/ready`, ping, logs y
un smoke test. No borrar el artefacto fallido hasta conservar evidencia sanitizada.

## Base de datos

No ejecutar automáticamente una migración descendente. Si el cambio no es
compatible, detener escrituras afectadas y aplicar el procedimiento revisado para
esa migración. Restaurar un backup es la última medida y exige validar pérdida de
datos respecto del RPO acordado.

## Cierre

Registrar causa, impacto, acciones ejecutadas y estado final. Rotar credenciales si
hubo exposición y crear tareas de corrección antes de reintentar la liberación.
