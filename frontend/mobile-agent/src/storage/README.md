# Almacenamiento móvil

`mobile-session.ts` conserva la sesión como dos sobres enlazados por una
revisión aleatoria:

- el bearer, el refresh token y la revisión viven únicamente en
  `expo-secure-store` con accesibilidad `WHEN_UNLOCKED_THIS_DEVICE_ONLY` (sobre
  v2, que mide menos de 2048 bytes; el sobre v1 de la APK anterior se sigue
  leyendo, sin refresh token);
- AsyncStorage contiene actor/expiración no secretos, y hasta cuándo renueva el
  refresh token, con la misma revisión y cachés de lectura versionadas por
  `accountId` y revisión;
- las actualizaciones y eliminaciones comparan la revisión de sesión para que
  una respuesta tardía no pueda modificar una cuenta que ya cambió;
- `replaceStoredMobileCredentialIfCurrent` guarda la credencial de una
  renovación (S3, ADR-0046) bajo el candado y con la misma revisión: escribe
  primero SecureStore y después la metadata, no borra cachés y solo reemplaza
  la credencial que renovó, de la misma cuenta;
- la sesión queda vencida, según el reloj de ELEVANT, cuando vence el access
  token y no hay un refresh token vigente; mientras lo hay, sigue activa;
- expiración, logout y rechazo `401/403` limpian la sesión y la caché actual;
  un rechazo de una credencial anterior no borra la que la renovó;
- la expiración y el rechazo dejan el marcador no secreto
  `elevant:mobile:ended-session:v1` (N5) con la cuenta, la causa y la hora del
  fin. `writeRampChecklistDraftForAccount` escribe el borrador del checklist
  para la cuenta que fijó la pantalla mientras su sesión está activa o, sin
  sesión, durante 2 horas desde ese fin (D-N5). El logout y un inicio de sesión
  confirmado borran el marcador; un intento fallido no;
- login/logout también purgan checklist, estado de vuelo, outbox y chat
  prototípicos no namespaced para que no crucen cuentas.

AsyncStorage sigue siendo caché, nunca frontera de autorización ni fuente
canónica. Antes de almacenar nuevas clases de datos reales deben definirse
esquema, migración, retención y limpieza.
