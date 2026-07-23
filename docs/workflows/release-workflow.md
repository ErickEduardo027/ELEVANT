# Flujo de liberación

## Preparación

- CI verde en el commit exacto.
- Contratos y migraciones revisados.
- configuración y secretos cargados en el ambiente de destino;
- backup reciente verificado si el cambio afecta datos;
- health checks, observabilidad y rollback definidos;
- ventana y responsable operativo acordados.

## Orden orientativo

Para un cambio compatible: preparar infraestructura, aplicar migraciones compatibles mediante una acción controlada, desplegar API, verificar salud y smoke tests, y después liberar clientes. Los cambios destructivos de esquema se dividen en expandir, migrar y contraer en versiones diferentes.

## Verificación

Comprobar `/health`, `/health/ready`, logs sin datos sensibles, endpoint de ping, métricas disponibles y un flujo crítico. Si falla un criterio, detener promoción y ejecutar rollback; no improvisar cambios manuales sobre Production sin registro.

