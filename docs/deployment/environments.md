# Ambientes

Elevant separa Local, Testing y Production. Separar no significa cambiar solo una variable: cada ambiente conserva identidad, red, datos, credenciales y almacenamiento propios.

## Testing

- Rama: `develop`.
- API: `https://api-test.elevant.example`.
- Web: `https://test.elevant.example`.
- Base: `ElevantTestingDb`.
- Usa datos ficticios o controlados, logs más detallados y Swagger habilitable.
- La APK de pruebas y el frontend local o desplegado consumen este ambiente.
- Mantiene secretos, volumen, uploads y backups exclusivos.

## Production

- Rama: `main`.
- API: `https://api.elevant.example`.
- Web: `https://app.elevant.example`.
- Base: `ElevantProductionDb`.
- Usa datos reales, logs restringidos y Swagger deshabilitado o protegido fuera de
  la aplicación.
- Mantiene backups, secretos y volúmenes exclusivos.
- Solo Erick puede aprobar y ejecutar despliegues de Production.

| Aspecto | Local | Testing | Production |
| --- | --- | --- | --- |
| Propósito | Desarrollo individual | Integración y aceptación | Operación real |
| API | Equipo o Compose local | Dominio de pruebas | Dominio productivo |
| SQL Server | Contenedor/instancia local | Base y usuario exclusivos | Base y usuario exclusivos |
| Datos | Sintéticos | Sintéticos | Reales autorizados |
| Swagger | Habilitado en Development | Solo por configuración | Deshabilitado |
| Secretos | Almacén local ignorado | Gestor de plataforma | Gestor de plataforma |
| Backups | Opcionales/desechables | Independientes | Externos, cifrados y verificados |

## Promoción

Se promueve el mismo artefacto inmutable entre ambientes. La configuración entra en despliegue y no se reconstruye la imagen para cambiar un endpoint o secreto. Antes de Production se validan migraciones, compatibilidad de clientes, salud, logs, rollback y backup cuando corresponda.

## Aislamiento obligatorio

- No compartir base de datos, contraseñas, claves JWT ni API key de FlightAware.
- No montar el mismo volumen entre ambientes.
- No restaurar datos reales en Testing.
- No compartir directorios de uploads ni backups.
- No permitir que una aplicación de Testing llame accidentalmente a Production.
- Etiquetar observabilidad y alertas con el ambiente real.

Los placeholders `*.elevant.example` son ejemplos reservados para documentación; deben reemplazarse por dominios controlados antes de desplegar.
