# Ambientes

Elevant separa Local, Development y Production. Separar no significa cambiar solo una variable: cada ambiente conserva identidad, red, datos, credenciales y almacenamiento propios.

## Development

- Rama: `Development`.
- API: `https://api-dev.elevant.com`.
- Web futura: `https://web-dev.elevant.example`.
- Base: `ElevantDevelopmentDb`.
- Usa datos sintéticos o controlados, logs operativos y Swagger habilitado.
- La APK de pruebas y el frontend local o desplegado consumen este ambiente.
- Mantiene secretos, volumen, uploads y backups exclusivos.
- El stack se llama Development, pero la API usa internamente
  `ASPNETCORE_ENVIRONMENT=Testing` para no activar el modo local permisivo.

## Production

- Rama: `main`.
- API: `https://api.elevant.example`.
- Web: `https://app.elevant.example`.
- Base: `ElevantProductionDb`.
- Usa datos reales, logs restringidos y Swagger deshabilitado o protegido fuera de
  la aplicación.
- Mantiene backups, secretos y volúmenes exclusivos.
- Solo Erick puede aprobar y ejecutar despliegues de Production.

| Aspecto | Local | Development | Production |
| --- | --- | --- | --- |
| Propósito | Desarrollo individual | Integración y aceptación | Operación real |
| API | Equipo o Compose local | Dominio de desarrollo remoto | Dominio productivo |
| SQL Server | Contenedor/instancia local | Base y usuario exclusivos | Base y usuario exclusivos |
| Datos | Sintéticos | Sintéticos | Reales autorizados |
| Swagger | Habilitado | Habilitado por configuración | Deshabilitado |
| Secretos | Almacén local ignorado | Gestor de plataforma | Gestor de plataforma |
| Backups | Opcionales/desechables | Independientes | Externos, cifrados y verificados |

## Promoción

Development se construye actualmente desde la rama `Development`. Antes de habilitar Production se publicará una imagen versionada e inmutable para promover exactamente el artefacto validado, sin reconstruirlo para cambiar configuración o secretos. También se validarán migraciones, compatibilidad de clientes, salud, logs, rollback y backups.

## Aislamiento obligatorio

- No compartir base de datos, contraseñas, claves JWT ni API key de FlightAware.
- No montar el mismo volumen entre ambientes.
- No restaurar datos reales en Development.
- No compartir directorios de uploads ni backups.
- No permitir que una aplicación de Development llame accidentalmente a Production.
- Etiquetar observabilidad y alertas con el ambiente real.

Los placeholders `*.elevant.example` son ejemplos reservados para documentación; deben reemplazarse por dominios controlados antes de desplegar.
