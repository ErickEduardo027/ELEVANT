# Ambientes ELEVANT

Una sola API/base lógica sirve a AVIAM Web, Public Web y Mobile Agent dentro de cada ambiente. “Public Web” describe a sus usuarios; no significa que el ambiente Development deba estar abierto a Internet.

## Matriz

| Aspecto | Local | Development VPS | Production futura |
| --- | --- | --- | --- |
| Rama | feature actual | `Development` | commit promovido desde `main` |
| API | `http://127.0.0.1:8080` | `https://elevant-dev-api.<tailnet>.ts.net` | dominio público controlado |
| AVIAM Web | `http://localhost:5173` | `https://elevant-dev-aviam-web.<tailnet>.ts.net` | dominio interno/controlado |
| Public Web | `http://localhost:3000` | `https://elevant-dev-public-web.<tailnet>.ts.net` | dominio público controlado |
| Mobile | Expo/device | APK de pruebas conectada al tailnet | build de tienda con API pública |
| Base | `ElevantDevelopmentDb` local | `ElevantDevelopmentDb` | `ElevantProductionDb` |
| Datos | sintéticos | sintéticos/reconstruibles | reales autorizados |
| SQL edition | Developer | Developer | por decidir/licenciar |
| Swagger | habilitado | habilitado por config | deshabilitado |
| Backups | opcionales | nativos locales + restore-check | cifrados off-host + restore probado |

`<tailnet>` es un placeholder. Los nombres Tailscale se fijan al configurar el VPS; no se escriben valores inventados en builds.

## Development

- `ASPNETCORE_ENVIRONMENT=Development` y `ELEVANT_DATABASE_ENVIRONMENT=Development`.
- SQL Server 2022 Developer Edition: uso exclusivo de desarrollo/pruebas, sin usuarios ni datos reales.
- Base, volumen, credenciales, claves JWT, FlightAware y backups propios.
- Acceso HTTPS privado mediante Tailscale Services; Tailscale no reemplaza autenticación/RBAC/tenant.
- CORS de API permite solo los dos orígenes web Development y, si se necesitan, `http://localhost:5173`/`http://localhost:3000`.
- Aplicaciones nativas no dependen de CORS, pero sí de TLS y autenticación.
- No se habilitan uploads reales sin object storage y política de retención.

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

## Promoción

Se promueve el mismo artefacto inmutable probado, no se reconstruye para Production. Un release coordinado sigue `migración compatible -> API -> clientes`. Los cambios deben ser backward-compatible porque API, ambas webs y Mobile tienen ciclos independientes.

Prohibido:

- compartir base, login, JWT key, API key, volumen o backup;
- restaurar Production en Development;
- apuntar un build Development a Production;
- usar una URL Tailscale como endpoint de una app pública de tienda;
- convertir fixtures/backups del prototipo en datos reales.
