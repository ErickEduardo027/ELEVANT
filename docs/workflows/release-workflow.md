# Flujo de liberación

## Preparación

- CI verde en el commit exacto y referencias de imagen por digest.
- contratos/migraciones revisados y drift cero;
- variables/secretos disponibles sin imprimirlos;
- backup verificado si el ambiente contiene datos no reconstruibles;
- compatibilidad, señales de aborto y rollback definidos;
- responsable/ventana operativa acordados.

## Orden

1. verificar nombre/marcador del target;
2. ejecutar bundle de migraciones con login migrator;
3. ejecutar seed solo en Development con login seeder;
4. desplegar API compatible y validar `/health`, `/health/ready` y ping;
5. desplegar AVIAM Web/Public Web; distribuir Mobile por su canal;
6. observar errores, latencia y flujo crítico.

SQL Server y sus volúmenes nunca participan del auto-deploy de API/web. En Development, un push validado publica imágenes GHCR, pero la configuración inicial de Dokploy es una acción separada. Los cambios destructivos usan expand/contract en releases distintos.

## Fallo

Detenga la promoción. Revertir imagen no revierte esquema. No edite `__EFMigrationsHistory`, no ejecute `Down` improvisado y no restaure sobre la base origen. Siga `docs/deployment/rollback.md` y preserve evidencia sanitizada.
