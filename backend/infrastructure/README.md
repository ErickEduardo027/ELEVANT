# Infraestructura de Elevant

Esta área contiene plantillas operativas; no crea recursos externos ni despliega automáticamente. El backend se empaqueta desde `backend/Dockerfile` usando `backend/` como contexto de construcción y escucha HTTP en el puerto interno `8080`.

## Principios

- Development y Production son stacks independientes: base, contraseña, red, volumen y configuración no se comparten.
- SQL Server pertenece exclusivamente a la API. Web, móvil y servicios externos nunca se conectan a la base.
- El puerto `1433` no se publica en Development ni Production. En local solo se liga a `127.0.0.1` para herramientas del desarrollador.
- TLS termina en el proxy administrado por Dokploy. La API recibe encabezados reenviados únicamente desde proxies o redes configurados.
- Las migraciones se crean y aplican con acciones manuales; el arranque de la API y Compose no modifican el esquema.
- Credenciales, copias de seguridad, archivos `.env`, uploads y claves viven fuera de Git.

## Directorios

- `docker`: imagen reproducible y stacks Compose.
- `dokploy`: procedimiento de despliegue para Development y Production.
- `reverse-proxy`: límites de confianza, TLS y rutas públicas.
- `monitoring`: salud, logs y alertas mínimas.
- `backups`: política de copias externas y pruebas de restauración.
- `database`: propiedad y operación de SQL Server.
- `environments`: separación de ambientes y variables.
