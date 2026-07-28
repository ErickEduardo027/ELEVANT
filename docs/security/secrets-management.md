# Gestión de secretos

Un secreto es cualquier valor que permite acceso o firma: contraseñas, cadenas de conexión, tokens, claves de FlightAware, certificados y claves de APK. No se almacena en Git, imágenes, ejemplos de ambiente, OpenAPI, logs, capturas o documentación.

## Por ambiente

- Local: user-secrets de .NET o archivo local ignorado y protegido.
- Development: gestor de secretos/variables protegidas de la plataforma.
- Production: secretos de plataforma con acceso mínimo y auditoría.
- CI: secretos del proveedor, limitados a jobs y ramas requeridos.

Los `.env.example` contienen únicamente nombres y placeholders no válidos. Las variables `NEXT_PUBLIC_*`, `PUBLIC_*` y `EXPO_PUBLIC_*` son públicas por diseño y jamás contienen credenciales.

## Ciclo de vida

Asignar propietario funcional, propósito, ambientes, consumidores y fecha de revisión. Rotar al cambiar personal autorizado, ante exposición, según política del proveedor y periódicamente cuando corresponda. Diseñar la rotación para aceptar brevemente dos credenciales si el proveedor lo permite.

## Exposición

Si un secreto aparece en un commit, log o mensaje:

1. revocarlo o rotarlo inmediatamente;
2. limitar acceso al artefacto expuesto;
3. revisar usos y actividad;
4. notificar por el canal de incidentes;
5. limpiar el historial solo después de revocar, coordinando al equipo;
6. documentar causa y control preventivo sin repetir el valor.

Ocultar el texto en Git no vuelve segura una credencial que ya fue publicada.
