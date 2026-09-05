# Ambientes ELEVANT

Una sola API/base lógica sirve a AVIAM Web, Public Web y Mobile Agent dentro de cada ambiente. “Public Web” describe a sus usuarios; no significa que el ambiente Development deba estar abierto a Internet.

## Matriz

| Aspecto | Local | Development VPS | Production futura |
| --- | --- | --- | --- |
| Rama | feature actual | `Development` | commit promovido desde `main` |
| API | `http://127.0.0.1:8080` | `ELEVANT_DEV_API_ORIGIN` | dominio público controlado |
| AVIAM Web | `http://localhost:5173` | `ELEVANT_DEV_AVIAM_WEB_ORIGIN` | dominio interno/controlado |
| Public Web | `http://localhost:3000` | `ELEVANT_DEV_PUBLIC_WEB_ORIGIN` | dominio público controlado |
| Mobile | Expo/device | APK de pruebas conectada al tailnet | build de tienda con API pública |
| Base | `ElevantDevelopmentDb` local | `ElevantDevelopmentDb` | `ElevantProductionDb` |
| Datos | sintéticos | sintéticos/reconstruibles | reales autorizados |
| SQL edition | Developer | Developer | por decidir/licenciar |
| Swagger | habilitado | habilitado por config | deshabilitado |
| Backups | opcionales | nativos locales + restore-check | cifrados off-host + restore probado |
| Entrega web | proceso local | imágenes + bundles OCI certificados; pull desde VPS | por diseñar |

Los nombres vivos de Tailscale se fijan en la consola del operador y en las
variables de repositorio autorizadas; no se copian a plantillas ni se inventan
valores durante un build.

## Development

- `ASPNETCORE_ENVIRONMENT=Development` y `ELEVANT_DATABASE_ENVIRONMENT=Development`.
- SQL Server 2022 Developer Edition: uso exclusivo de desarrollo/pruebas, sin usuarios ni datos reales.
- Base, volumen, credenciales, claves JWT, FlightAware y backups propios.
- Acceso HTTPS privado mediante Tailscale Services; Tailscale no reemplaza autenticación/RBAC/tenant.
- GitHub Actions recibe los tres orígenes exactos mediante
  `ELEVANT_DEV_API_ORIGIN`, `ELEVANT_DEV_AVIAM_WEB_ORIGIN` y
  `ELEVANT_DEV_PUBLIC_WEB_ORIGIN`. Son configuración pública de build, no
  secretos, y deben ser HTTPS sin `/` final.
- CORS de API permite exactamente los dos orígenes HTTPS web Development,
  configurados sin `/` final mediante `ELEVANT_API_PRIVATE_WEB_ORIGIN` y
  `ELEVANT_API_PUBLIC_WEB_ORIGIN`, además de
  `http://localhost:5173`/`http://localhost:3000` para desarrollo local.
- Aplicaciones nativas no dependen de CORS, pero sí de TLS y autenticación.
- No se habilitan uploads reales sin object storage y política de retención.

DB, API, AVIAM Web y Public Web tienen carriles de entrega independientes. Las
dos webs se publican como imágenes y bundles OCI distintos y se promueven por
pull desde el VPS solo después de comprobar la entrega API exacta. Sus recursos
Dokploy usan Compose Raw con AutoDeploy desactivado; no compilan desde GitHub en
el host y nunca se conectan a la red SQL.

El rollout web inicial es un preview técnico. Algunas pantallas todavía esperan
operaciones del prototipo que la API real no ofrece; esas llamadas deben fallar
contra la API Development, nunca desviarse al localhost del navegador o a un
backend prototipo. La instalación de los dos runtimes y su CD en el VPS es una
operación manual posterior a la revisión de los artefactos del repositorio.

## Production

Production no se despliega en el VPS Development ni se define copiando su Compose. Requiere otra instancia/host, licencia SQL válida, secretos, volúmenes, backup externo, dominio y observabilidad independientes.

`ElevantProductionDb` aplica las mismas migraciones y queda sin filas de negocio. Solo existen el marcador técnico de ambiente y el historial de EF hasta que los usuarios autorizados creen información por la API. No existe servicio/comando seeder.

Antes de habilitar Production se decide como mínimo:

- SQL Server Standard con licencia o Express aceptando explícitamente sus límites;
- dominio/TLS y distribución de Mobile en tiendas;
- RPO, RTO, cifrado y destino off-host;
- política de privacidad/retención;
- autenticación, autorización tenant y auditoría completas;
- prueba de carga, restore y rollback.

Los backups de Production usan credenciales distintas de la API y de la
administración ordinaria de SQL Server. Cada fallo tiene un responsable, las
restauraciones se ensayan periódicamente en un ambiente aislado y se conserva
evidencia del resultado y del tiempo empleado. La rotación nunca elimina la
última copia verificada.

## Promoción

Se promueve el mismo artefacto inmutable probado, no se reconstruye para Production. Un release coordinado sigue `migración compatible -> API -> clientes`. Los cambios deben ser backward-compatible porque API, ambas webs y Mobile tienen ciclos independientes.

Prohibido:

- compartir base, login, JWT key, API key, volumen o backup;
- restaurar Production en Development;
- apuntar un build Development a Production;
- usar una URL Tailscale como endpoint de una app pública de tienda;
- convertir fixtures/backups del prototipo en datos reales.
