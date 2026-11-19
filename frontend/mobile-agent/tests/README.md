# Pruebas móviles

`api-client.metro-smoke.ts` verifica que Metro pueda incluir la fábrica móvil y
las operaciones compartidas `createSession`, `getCurrentSession`,
`refreshSession`, `endSession`, `getRampAssignedOperations`,
`registerMobileDevice` y `releaseMobileDevice`. El export Android completo cubre
además la resolución nativa de SecureStore.

`mobile-session.test.js` ejecuta con Jest/Expo las invariantes de seguridad del
almacenamiento local: el token nunca entra en AsyncStorage, el valor cifrado se
mantiene compacto, los cambios de autorización rotan la revisión, logout/cambio
de cuenta bloquea escrituras tardías y cualquier pareja inconsistente falla en
cerrado. Desde S3 también comprueba el sobre v2 con el refresh token, que se
sigue leyendo el v1, que un access token vencido con el refresh vigente no
borra nada y que reemplazar la credencial conserva la revisión y las cachés.
Desde N5 termina la sesión por la vía del refresh (sobre v1, refresh vencido o
`401` al renovar) y comprueba el marcador de fin: la cuenta sigue escribiendo su
borrador y otra cuenta activa no, al volver a entrar recupera las respuestas, el
cierre de sesión a propósito y la ventana de 2 horas lo rechazan y un intento
fallido no borra el marcador.

`ramp-operation-checklist-draft.test.js` recorre el servicio del borrador del
checklist con el almacenamiento y la sesión reales y un doble de ELEVANT (N5):
`kept-until-sign-in` tras el fin de la sesión, la carrera con el fin de la
sesión, `storage_unavailable` solo ante un fallo del almacenamiento y la cola
que sigue exigiendo sesión. `checklist-screen.test.js` monta la pantalla real:
las respuestas marcadas después del fin vuelven, 21/21, al montarla de nuevo
tras volver a entrar.

`mobile-session-renewal.test.js` recorre la renovación de la sesión (S3,
ADR-0046) contra un doble pequeño de los endpoints de sesión de ELEVANT
(rotación, margen de 60 segundos y detección de reuso), con el almacenamiento,
el servicio de sesión y el reloj del servidor reales: una sola renovación en el
minuto 16, sin señal la sesión sigue, `401` termina la sesión y conserva la
cola, `409`/`429`/`503`, el `401` de una solicitud, el reloj adelantado, un
desfase obsoleto, la respuesta perdida (D-S3b) y los tokens sin `auth_time`.

Siguen pendientes las pruebas de integración en dispositivo para conectividad,
permisos y la futura sincronización de comandos.
