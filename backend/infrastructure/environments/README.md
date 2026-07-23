# Ambientes

| Propiedad | Local | Testing | Production |
|---|---|---|---|
| Compose | activo | plantilla `.example` | plantilla `.example` |
| SQL en host | `127.0.0.1` | no publicado | no publicado |
| Swagger | habilitado | configurable/habilitado | deshabilitado |
| Datos | sintéticos | sintéticos o controlados | reales y restringidos |
| Secretos | archivo local ignorado | almacén Dokploy propio | almacén Dokploy propio |
| Volumen SQL | local | exclusivo de Testing | exclusivo de Production |

No copiar bases, credenciales, uploads ni backups de Production a Testing. Los fallos que dependan de datos se reproducen con conjuntos sintéticos controlados y con caducidad definida.
