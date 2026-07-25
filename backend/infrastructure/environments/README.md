# Ambientes

| Propiedad | Local | Development | Production |
|---|---|---|---|
| Compose | activo | activo para Dokploy | plantilla `.example` |
| SQL en host | `127.0.0.1` | no publicado | no publicado |
| Swagger | habilitado | configurable/habilitado | deshabilitado |
| Datos | sintéticos | sintéticos o controlados | reales y restringidos |
| Secretos | archivo local ignorado | almacén Dokploy propio | almacén Dokploy propio |
| Volumen SQL | local | `elevant-sql-development-data` | exclusivo de Production |

No copiar bases, credenciales, uploads ni backups de Production a Development. Ambos ambientes comparten migraciones y estructura de esquema, nunca datos. Los fallos que dependan de datos se reproducen con conjuntos sintéticos controlados y con caducidad definida. La API de Dokploy Development ejecuta internamente el ambiente ASP.NET Core `Testing`.
