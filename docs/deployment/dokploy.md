# Despliegue con Dokploy

Esta guía describe la preparación; el scaffold no crea servidores, dominios ni despliegues reales.

## Prerrequisitos

- host endurecido y actualizado;
- DNS bajo control del equipo;
- Dokploy instalado y con acceso administrativo protegido;
- repositorio o registro de imágenes autorizado;
- red/volumen SQL Server separados por ambiente;
- secretos disponibles fuera de Git;
- destino externo para backups;
- plan de migración y rollback.

## API

Construir con `backend/Dockerfile` usando `backend` como contexto. El backend es
autónomo y la imagen no necesita archivos de `frontend`, `packages` o `docs`. El
contenedor escucha en el puerto 8080 y se ejecuta con usuario no root. Dokploy
publica HTTPS mediante el proxy y sondea `GET /health`; no hace falta instalar
`curl` dentro de la imagen solo para un `HEALTHCHECK`.

Configurar, como mínimo, ambiente ASP.NET, cadena de conexión, orígenes CORS explícitos, red externa del proxy, CIDR confiable para forwarded headers y cualquier opción de proveedor habilitada. La cadena y las claves se crean como secretos de plataforma, no como variables en un archivo versionado. Dokploy Development usa `ASPNETCORE_ENVIRONMENT=Testing` y `Swagger__Enabled=true`.

`/health/ready` sirve para verificar dependencias durante promoción o diagnóstico. No debe usarse como liveness si una caída temporal de SQL provocaría reinicios en bucle.

## SQL Server

SQL Server vive en una red privada y no publica 1433 en Internet. Utiliza volumen persistente exclusivo, contraseña de ambiente y una imagen/edición cuya licencia y recursos estén confirmados. Development puede usar `sa` temporalmente para el arranque inicial; antes de Production la API debe usar una identidad de permisos mínimos y la cuenta administrativa debe reservarse para operación.

Compose local no es una plantilla remota. Development y Production tienen servicios, volúmenes, secretos y backups separados. Comparten migraciones y esquema, nunca datos ni almacenamiento.

## Migraciones y liberación

1. Confirmar backup recuperable y compatibilidad.
2. Ejecutar migración como tarea controlada con el script y autorización apropiada.
3. Desplegar la imagen fijada por digest o versión inmutable.
4. Verificar health, readiness, ping, logs y un smoke test.
5. Observar errores/latencia y promover clientes solo cuando corresponda.

La API nunca migra al arrancar. Si falla, detener la promoción y seguir el rollback documentado; no ejecutar comandos improvisados desde la consola del contenedor.

## Proxy y seguridad

Aceptar forwarded headers únicamente desde proxies/redes conocidos. Forzar HTTPS en el borde, mantener certificados renovados y limitar el panel Dokploy por red o autenticación fuerte. Swagger permanece deshabilitado en Production y SQL Server no recibe un dominio público.

## Development

1. Conectar el repositorio y seleccionar exactamente la rama `Development`.
2. Usar `backend/infrastructure/docker/compose.development.yml`.
3. Crear las variables descritas en `backend/.env.example` en el almacén de Dokploy.
4. Obtener el nombre y CIDR reales de la red del proxy; no confiar en rangos amplios por conveniencia.
5. Enrutar el dominio al servicio `api`, puerto interno `8080`, con sonda `/health`.
6. Desplegar y confirmar que `db-init` finaliza con código cero.
7. Validar `/health/ready`, `/api/v1/system/ping`, `/swagger` y el origen CORS del frontend.

Variables mínimas del stack:

| Variable | Valor esperado |
|---|---|
| `MSSQL_SA_PASSWORD` | Secreto fuerte y exclusivo de Development. |
| `ELEVANT_DATABASE_CONNECTION_STRING` | Conexión a `sqlserver:1433/ElevantDevelopmentDb`. |
| `CORS_ALLOWED_ORIGIN_0..3` | Orígenes web explícitos; no incluir el dominio de la API por defecto. |
| `DOKPLOY_NETWORK_NAME` | Nombre real de la red compartida con el proxy. |
| `FORWARDED_HEADERS_KNOWN_NETWORK_0` | CIDR real y confiable de esa red. |

La URL esperada es `https://api-dev.elevant.com`. Web y móvil consumen `/api/v1`; Swagger queda en
`/swagger`. La aplicación móvil nativa normalmente no está sujeta a CORS.
