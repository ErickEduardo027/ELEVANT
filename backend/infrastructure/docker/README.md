# Docker y Compose

El contexto de construcción es `backend/`, que contiene la solución, la configuración central de .NET, el Dockerfile y todos los proyectos de Clean Architecture. El Dockerfile restaura esos archivos en una capa separada, publica solo `Elevant.Api` y ejecuta la imagen final de ASP.NET como el usuario no privilegiado incluido en la imagen oficial de .NET 10.

No se instala `curl` ni se declara un `HEALTHCHECK` dentro de la imagen. En despliegues, Dokploy debe consultar `GET /health` por el puerto interno `8080`.

## Desarrollo local

1. Copiar `backend/.env.example` a un archivo local ignorado, por ejemplo `backend/.env.local`.
2. Cambiar `MSSQL_SA_PASSWORD` por una contraseña local fuerte que cumpla la política de SQL Server.
3. Validar y arrancar:

```powershell
docker compose --env-file backend/.env.local -f backend/infrastructure/docker/compose.local.yml config --quiet
docker compose --env-file backend/.env.local -f backend/infrastructure/docker/compose.local.yml up --build
```

La API queda ligada por defecto a `127.0.0.1:8080` y SQL Server a `127.0.0.1:1433`. Cambiar `API_PORT` o `MSSQL_PORT` evita conflictos locales. El volumen `elevant-sql-local-data` persiste hasta que el operador lo elimine explícitamente.

## Plantillas remotas

Los archivos `compose.testing.yml.example` y `compose.production.yml.example` son deliberadamente inactivos. Cada stack debe recibir su propio archivo de variables seguro y valores distintos para `MSSQL_SA_PASSWORD`, `ELEVANT_DATABASE_CONNECTION_STRING` y `CORS_ALLOWED_ORIGIN`.

```powershell
docker compose --env-file C:\secure\elevant-testing.env -f backend/infrastructure/docker/compose.testing.yml.example config --quiet
docker compose --env-file C:\secure\elevant-production.env -f backend/infrastructure/docker/compose.production.yml.example config --quiet
```

Ninguna plantilla remota publica SQL Server. Production usa SQL Server Express por defecto; `MSSQL_PID` solo debe cambiarse cuando exista una licencia válida para la edición elegida. El login `sa` queda reservado al arranque, health check y administración. Antes de desplegar la API debe provisionarse un login de aplicación con privilegios mínimos y guardar su cadena completa como `ELEVANT_DATABASE_CONNECTION_STRING`. No ejecutar `docker compose config` sin `--quiet` con secretos reales, porque la salida renderizada incluye variables interpoladas.

## Variables

| Variable | Uso |
|---|---|
| `MSSQL_IMAGE` | Imagen SQL Server 2022 aprobada. |
| `MSSQL_SA_PASSWORD` | Secreto independiente por ambiente; nunca se registra. |
| `ELEVANT_DB_NAME` | Nombre independiente de la base. |
| `ELEVANT_DATABASE_CONNECTION_STRING` | Cadena secreta de la API con un login de privilegios mínimos; obligatoria remotamente. |
| `MSSQL_PORT` | Puerto local ligado a loopback; no se usa remotamente. |
| `API_PORT` | Puerto local de la API. |
| `ASPNETCORE_ENVIRONMENT` | `Development`, `Testing` o `Production`. |
| `CORS_ALLOWED_ORIGIN` | Origen HTTPS exacto de la aplicación cliente. |
| `MSSQL_PID` | Edición de SQL opcional; Production usa `Express` por defecto. |

En desarrollo local la API puede usar `sa` como excepción controlada y aislada en loopback. En ambientes remotos la cadena se entrega completa desde el almacén de secretos de Dokploy y nunca se escribe en un archivo versionado. Las plantillas remotas fijan `ASPNETCORE_ENVIRONMENT` a `Testing` o `Production` para evitar que un archivo de variables equivocado active comportamiento de desarrollo.
