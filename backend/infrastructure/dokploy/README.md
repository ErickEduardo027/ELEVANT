# Despliegue con Dokploy

El objetivo inicial es un servidor KVM 2 administrado por el equipo. Las capacidades comerciales de ese plan pueden cambiar: antes de desplegar se deben verificar CPU, RAM, disco, límites de I/O y soporte de virtualización del proveedor. No se presupone que un único tamaño sea suficiente para la carga final.

## Separación requerida

Crear dos proyectos o stacks Dokploy distintos: `elevant-testing` y `elevant-production`. Cada uno necesita dominio, variables, contraseña SQL, base, red y volumen propios. No montar el mismo directorio para SQL, uploads o backups en ambos stacks.

Las variables sensibles se cargan en el almacén de variables de Dokploy; no se pegan en Compose ni en logs. `MSSQL_SA_PASSWORD`, dominios y futuros tokens deben ser distintos entre ambientes.

## Configuración del servicio

1. Conectar el repositorio privado y seleccionar la rama autorizada del ambiente.
2. Construir con `backend/` como contexto y `Dockerfile` como ruta relativa, o importar la plantilla Compose del ambiente tras una revisión.
3. Publicar únicamente la API mediante el proxy; el contenedor escucha en `8080`.
4. Configurar el dominio HTTPS y la sonda `GET /health`.
5. Mantener SQL Server solo en la red interna `data`, sin puerto de host.
6. Validar `GET /health` y `GET /health/ready` después de desplegar. La primera comprueba vida del proceso; la segunda incluye dependencias.

## Migraciones y reversión

El despliegue no ejecuta migraciones. Una migración debe revisarse, respaldarse y aplicarse mediante `backend/scripts/update-database.ps1` con el ambiente explícito. Production exige `-AllowProduction` y la frase de confirmación exacta.

Antes de una versión con cambios incompatibles, preparar una estrategia expand/contract o ventana de mantenimiento. Revertir la imagen no revierte el esquema; la reversión de datos se decide y prueba por separado.
