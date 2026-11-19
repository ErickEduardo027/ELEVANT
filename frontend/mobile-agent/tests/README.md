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

`mobile-session-renewal.test.js` recorre la renovación de la sesión (S3,
ADR-0046) contra un doble pequeño de los endpoints de sesión de ELEVANT
(rotación, margen de 60 segundos y detección de reuso), con el almacenamiento,
el servicio de sesión y el reloj del servidor reales: una sola renovación en el
minuto 16, sin señal la sesión sigue, `401` termina la sesión y conserva la
cola, `409`/`429`/`503`, el `401` de una solicitud, el reloj adelantado, un
desfase obsoleto, la respuesta perdida (D-S3b) y los tokens sin `auth_time`.

Siguen pendientes las pruebas de integración en dispositivo para conectividad,
permisos y la futura sincronización de comandos.
