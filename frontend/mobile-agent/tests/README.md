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
tras volver a entrar. Desde N6 también comprueba que la pantalla dice que la
sesión terminó (insignia roja, ENTRAR DE NUEVO, sin salir sola ni pedir
desbloquear), que ENVIAR vuelve a guardar el borrador y lo espera, que
REINTENTAR GUARDADO no entra en bucle, que un guardado `cancelled` se reintenta
una vez y que una cuenta sin acceso abre el acceso con `access_revoked`.

`session-ended-notice.test.js` monta el layout raíz con el almacenamiento y la
sesión reales (N6, D-N6): el aviso global aparece tras el vencimiento, sigue en
todas las pantallas hasta la de acceso, nombra la cuenta sin acceso y no
aparece tras un cierre de sesión a propósito. `flight-screen-notices.test.js`
monta el manifiesto: el inicio, el cambio de un servicio y la entrega que la
tablet no pudo guardar se explican sin «payload» ni «Desbloquea».
`flight-report-panel.test.js` comprueba que los hitos y los datos del vuelo
distinguen la sesión terminada de un fallo del almacenamiento.

`login-screen.test.js` monta la pantalla de acceso con el almacenamiento y la
sesión reales y un doble de ELEVANT con dos cuentas (N7). `useLocalSearchParams`
es mutable, así que el aviso de la ruta cambia con la pantalla montada. Comprueba
que el aviso del fin de sesión está en pasado, nombra la causa del marcador
(vencida, rechazada o sin acceso), se va al reintentar y vuelve con un aviso
nuevo, y que también sale cuando la pantalla encuentra la sesión vencida.
También comprueba el placeholder sin dirección de prueba, que la tablet en uso
remite a OCC sin decir quién la tiene, que los pendientes de otra cuenta no
cuentan y que el logo y el formulario forman un bloque centrado.

`mobile-session-renewal.test.js` recorre la renovación de la sesión (S3,
ADR-0046) contra un doble pequeño de los endpoints de sesión de ELEVANT
(rotación, margen de 60 segundos y detección de reuso), con el almacenamiento,
el servicio de sesión y el reloj del servidor reales: una sola renovación en el
minuto 16, sin señal la sesión sigue, `401` termina la sesión y conserva la
cola, `409`/`429`/`503`, el `401` de una solicitud, el reloj adelantado, un
desfase obsoleto, la respuesta perdida (D-S3b) y los tokens sin `auth_time`.

`date-format.test.js` fija el formato único de fecha y hora (N11, D-N11):
«lun, 16 nov» y «16 nov, 19:46» con reloj de 24 horas, la zona de la estación y,
sin una zona conocida, `America/Santo_Domingo` en lugar de la del equipo. Un
motor simulado que escribe la medianoche como «24:05» comprueba que se lee
«00:05». Las expresiones toleran el punto y la coma que algunas versiones de
ICU añaden.
`assigned-operation-card.test.js` comprueba el riel de la tarjeta: «Inicio
planificado» en dos líneas que se reducen para caber, sin mayúsculas forzadas.
`home-screen.test.js` monta el inicio con una estación fuera de República
Dominicana: «última actualización» y «Mis posiciones de hoy» van en su hora. El
manifiesto (`operation-offline-queue.test.js`), «Sincronización»
(`sync-screen.test.js`) y el ajuste de un hito (`flight-report-panel.test.js`)
comprueban el mismo formato, sin «a. m.» ni «p. m.».

Siguen pendientes las pruebas de integración en dispositivo para conectividad,
permisos y la futura sincronización de comandos.
