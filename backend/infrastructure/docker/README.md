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

## Stacks remotos

`compose.development.yml` es el stack activo para Dokploy Development. Usa
`ASPNETCORE_ENVIRONMENT=Testing`, crea `ElevantDevelopmentDb` de forma idempotente
y mantiene SQL Server en una red interna. `compose.production.yml.example` sigue
inactivo hasta preparar Production. Cada stack recibe variables y secretos propios.

```powershell
docker compose --env-file C:\secure\elevant-development.env -f backend/infrastructure/docker/compose.development.yml config --quiet
docker compose --env-file C:\secure\elevant-production.env -f backend/infrastructure/docker/compose.production.yml.example config --quiet
```

Ningún stack remoto publica SQL Server. Development usa Developer Edition y puede
usar `sa` temporalmente para simplificar el arranque inicial; debe migrarse a un
login de aplicación con privilegios mínimos. Production usa SQL Server Express por
defecto y no se modifica en esta fase. No ejecutar `docker compose config` sin
`--quiet` con secretos reales, porque la salida renderizada incluye variables interpoladas.

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
| `CORS_ALLOWED_ORIGIN_0..3` | Orígenes exactos de aplicaciones web; los valores vacíos se ignoran. |
| `MSSQL_PID` | Edición de SQL opcional; Production usa `Express` por defecto. |
| `DOKPLOY_NETWORK_NAME` | Red externa compartida con el proxy de Dokploy. |
| `FORWARDED_HEADERS_KNOWN_NETWORK_0` | CIDR exacto de la red confiable del proxy. |

En local y temporalmente en Dokploy Development la API puede usar `sa` como
excepción controlada. La cadena se entrega desde el almacén de secretos de Dokploy
y nunca se escribe en un archivo versionado. Development fija
`ASPNETCORE_ENVIRONMENT=Testing`; Production fija `Production`.
