# Almacenamiento móvil

`mobile-session.ts` conserva la sesión como dos sobres enlazados por una
revisión aleatoria:

- el bearer y la revisión viven únicamente en `expo-secure-store` con accesibilidad
  `WHEN_UNLOCKED_THIS_DEVICE_ONLY`;
- AsyncStorage contiene actor/expiración no secretos con la misma revisión y
  cachés de lectura versionadas por `accountId` y revisión;
- las actualizaciones y eliminaciones comparan la revisión de sesión para que
  una respuesta tardía no pueda modificar una cuenta que ya cambió;
- expiración, logout y rechazo `401/403` limpian la sesión y la caché actual;
- login/logout también purgan checklist, estado de vuelo, outbox y chat
  prototípicos no namespaced para que no crucen cuentas.

AsyncStorage sigue siendo caché, nunca frontera de autorización ni fuente
canónica. Antes de almacenar nuevas clases de datos reales deben definirse
esquema, migración, retención y limpieza.
