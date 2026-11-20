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
una vez y que una cuenta sin acceso abre el acceso con `access_revoked`. Dentro
del layout raíz, el checklist muestra un solo aviso de sesión terminada, sin
decir que guardó respuestas que no pudo guardar, y uno ya enviado deja el aviso
del layout.

`session-ended-notice.test.js` monta el layout raíz con el almacenamiento y la
sesión reales (N6, D-N6): el aviso global aparece tras el vencimiento, sigue en
todas las pantallas hasta la de acceso, nombra la cuenta sin acceso y no
aparece tras un cierre de sesión a propósito. `flight-screen-notices.test.js`
monta el manifiesto: el inicio, el cambio de un servicio y la entrega que la
tablet no pudo guardar se explican sin «payload» ni «Desbloquea».
`flight-report-panel.test.js` comprueba que los hitos y los datos del vuelo
distinguen la sesión terminada de un fallo del almacenamiento.

`flight-report-panel.test.js` fija también el aviso del push-back (N2, D-N2,
describe «push-back (decisión 23)»), con un catálogo simulado de cuatro fases:
dos hitos en «En posición» y uno en «Salida». La hoja lista los motivos en el
orden del vuelo y el efecto con la posición, sin grabar nada; VOLVER, «Cerrar
sin registrar» y el botón atrás cierran sin grabar; REGISTRAR PUSH-BACK graba
con la hora de ELEVANT del momento en que el agente confirma, con el reloj del
equipo adelantado; sin servicios no hay motivo de servicios, y sin posición el
efecto no habla de liberarla. La Orden con una firma, también la que espera en
la cola, es un motivo; una firma rechazada o desactualizada no lo es. Un
push-back en la cola abre el ajuste, una corrección lo graba desde el ajuste
sin la hoja y una secuencia completa lo graba con un toque. También fija
`pushbackConcerns`: cada motivo una vez, y un servicio iniciado, no realizado o
con excepción quita el de los servicios.

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
desfase obsoleto, la respuesta perdida (D-S3b), también con el access token ya
vencido, cuando las lecturas fallan como `request_failed` y nunca como
`conflict`, y los tokens sin `auth_time`. También cierra sesión con el access
token vencido, incluso en la pausa tras una renovación fallida: renueva una vez
antes de liberar la tablet y termina la familia después.
`mobile-device-release.test.js` comprueba que esa renovación espera 5 segundos
como máximo.

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

`billing-units.test.js` fija las unidades de cobro en español (S5, D-S5): el
plural con 0, 1, 1,5 y 3, los nombres heredados con o sin tilde, que
«constructor» o «__proto__» no son unidades, los decimales de cada unidad y las
abreviaturas de la Orden de Servicio. `ramp-service-execution-card.test.js`
monta la tarjeta de un servicio: «0 / 1 hora» y «1 / 1 operación» en una sola
línea, «Cantidad ejecutada (horas)», que una unidad de conteo rechaza «1,5» y
acepta «2» con el teclado numérico, que la hora acepta «1,5», que una cantidad
contratada de 1,5 operaciones se confirma y que un comando reservado se reintenta
tal cual. El manifiesto (`operation-offline-queue.test.js`) ya no muestra el
código de la unidad.

`operation-presentation.test.js` fija la ruta y el rol de la asignación (N10 y
N9, D-N10 y D-N9). La ruta va en orden, BWI → PUJ → BWI y BWI → PUJ → MIA, y un
tramo que falta se omite. Comprueba también la frase del lector de pantalla y
que solo `primary` se lee «Agente principal», con cualquier mayúscula; un rol
desconocido, «constructor» o «__proto__» dan `null`.
`assigned-operation-card.test.js` comprueba el orden de los códigos en la
tarjeta, que la estación sale una sola vez y resaltada, y que una llegada o una
salida solas siguen en orden. El manifiesto (`operation-offline-queue.test.js`)
lee la tarjeta «Asignación»: «Agente principal» y solo el nombre de la
posición, sin «a. m.» ni «p. m.», sin `primary` ni «RAMP-AGENT»; sin posición
dice «Posición operativa no especificada» y omite un rol desconocido.

`checklist-item-number.test.js` fija la numeración del checklist (N12, D-N12):
ARR-01 da 1 y PUSH-11 da 11, como en el PDF, y un código que no termina en un
número (PREUSE-EXTERIOR, CHOCKS) o cuyo número es solo ceros toma su posición
en la sección. También monta la tarjeta del control: muestra «11» y no
«PUSH-11», con la etiqueta como texto principal, y sus respuestas siguen
funcionando. `checklist-screen.test.js` comprueba en la pantalla real que la
segunda sección sigue en 8 en lugar de volver a 1, sin códigos, y que el resumen
dice «Versión 1» con el código de la plantilla en pequeño.
`ramp-service-execution-card.test.js` y `ramp-operation-charges-card.test.js`
comprueban que el nombre es el texto principal, que el código es un texto
secundario pequeño y sin negrita, y que dos líneas del mismo servicio se
distinguen por su número de línea («1 · Aire acondicionado» y
«2 · Aire acondicionado» en «Cargos aplicados»).

`date-format.test.js` fija también la hora de la estación de la asistencia (S6,
D-S6): las 13:00 de Santo Domingo son las 17:00 UTC; Nueva York en verano y en
invierno; las 02:30 del 8 de marzo no existen allí y dan `undefined`, sin
pasarlas a otra hora; las 01:30 del 1 de noviembre toman su primera vez; una
zona desconocida usa Santo Domingo y un valor vacío da `null`. Motores simulados
sin `formatToParts`, que cuentan hasta 24 o que escriben «07:46 PM» leen la
misma hora. `attendance-draft-card.test.js` monta la tarjeta con estaciones en
otras zonas que el equipo (Katmandú, Nueva York): dice «hora local de KTM» sin
«zona de este dispositivo» ni un identificador IANA, «ahora» y lo escrito se
guardan como el instante de la estación, las 02:30 del 8 de marzo no se
guardan, el reintento envía el comando reservado tal cual, el conflicto muestra
los dos lados con el mismo formato y una zona desconocida no rompe la tarjeta.
`attendance-draft-screen.test.js` comprueba que el detalle pasa la zona y el
código de la estación y titula los vuelos «Hora local de PUJ».
`incident-screen.test.js` monta las incidencias: su hora es la de la estación y,
sin la operación o sin una zona conocida, la de Santo Domingo.

`attendance-draft-card.test.js` fija también el estilo de la tarjeta de
asistencia (N8, D-N8). En cada estado (cargando, no disponible, sin aporte de
OCC, con horas y un error de validación, pendiente de confirmar y los dos
conflictos), todos los textos usan un tamaño y un peso de `type` y un color de
la paleta. Los tres campos miden 56 dp o más con la letra de «Datos del vuelo».
Sin aporte de OCC, su carril dice solo «OCC aún no registra horas.». Una nota
sin horas se muestra con «Inicio — · Fin —», «Registrado …» y su revisión. Las
horas del día de la operación salen sin fecha y las de otro día con ella, según
el día en la estación (Katmandú) y no el de UTC ni el del equipo. Los dos
contadores de revisión siguen. `attendance-draft-screen.test.js` comprueba que
el detalle pasa el día de la operación a la tarjeta.

`operation-documents-sheet.test.js` monta el panel de formularios y abre la hoja
de firma con el FIRMAR de la fila del rol (S2, D-S2). Comprueba que FIRMAR,
CANCELAR y la huella quedan en el pie fijo, fuera del `ScrollView`, también en
compact; que el pie va en fila desde medium; que la hoja sigue la orientación y
usa el área segura; que el cuerpo y el pie van dentro de un
`KeyboardAvoidingView` con `padding` en iOS y en Android, que con eventos de
teclado simulados deja el pie sobre el teclado y vuelve a 0 al cerrarlo; que
«Cerrar sin firmar» y el botón atrás cierran sin firmar, y que el nombre va
antes de los datos y del pad. Si los eventos del teclado llegan al modal de
Android solo se puede ver en una tablet. Con el `PanResponder` real y
eventos de toque simulados, comprueba que un trazo que termina en
`onResponderTerminate` (el `ScrollView` se queda con el gesto) devuelve el
desplazamiento y no deja trazo, que los trazos ya hechos se conservan, que
«Borrar firma» deja solo la línea base aunque haya un trazo en curso, que un pad
que se desmonta a mitad de un trazo devuelve el desplazamiento y que el pad mide
como máximo 720 dp en 3:1. Las guardas: solo se firman los trazos visibles, el
charter exige la cédula normalizada y empezar un trazo no cierra el teclado.
`react-native-svg` se simula con componentes host para contar los trazos.

`operation-documents-sheet.test.js` fija también el monto de la Orden y las
firmas que la entrega no espera (N4 y N3, D-N4 y D-N3). Bajo el total de la
Orden comprueba la nota exacta, con y sin recargos; un total nulo dice
«Pendiente de valoración» sin la nota, y ni el Reporte de Vuelo ni la
Solicitud de un charter ni su Orden la llevan. Solo el Reporte de Vuelo y el
Check-List del puente dicen «No hace falta para entregar a OCC», con su icono;
su FIRMAR es secundario y azul marino, con el contraste AA calculado sobre los
estilos, y los demás siguen en naranja. Cada FIRMAR se anuncia «Firmar: {rol}».
El aviso se va con el formulario firmado, con la firma guardada en el
dispositivo, con `editable=false` y con la ejecución cerrada. También fija los
exports de `handoff.ts`. Las guardas: el manifiesto
(`operation-offline-queue.test.js`) entrega con el Reporte de Vuelo y el
Check-List del puente sin firmar y le dice al panel si la ejecución está
abierta, y `ramp-operation-submission.test.js` envía la entrega con ellos sin
firmar.

`handoff-requirements.test.js` fija los requisitos de la entrega (N1): el orden
(servicios, checklist, incidencias, Orden firmada y cola), cada texto con su
plural, que lo que la tablet no puede comprobar no bloquea, que un envío del
checklist en la cola lo cubre el requisito de la cola, dónde queda el checklist
(`checklistStanding`, también con la copia guardada) y los cuatro códigos
locales. `ramp-operation-submission.test.js` comprueba `checklist_not_submitted`
y `pending_incidents`, que la cola sale antes de leer los servicios y el
checklist, de modo que lo recién enviado cuenta, y que una copia guardada del
checklist espera la señal en lugar de darlo por no enviado. `ramp-incidents.test.js` cuenta
las incidencias que siguen en la tablet sin red ni renovación, y
`ramp-operation-charges-card.test.js`, la nota única de la ejecución cerrada y la
de la corrección. El manifiesto (`operation-offline-queue.test.js`, con dobles de
`ramp-operation-checklist` y `ramp-incidents`) recorre la lista: dos requisitos
pendientes apagan ENTREGAR y el ABRIR CHECKLIST de la lista navega y se anuncia
distinto del de la tarjeta; ENTREGAR abre la hoja propia sin `Alert.alert` y su
ENTREGAR A OCC entrega; SEGUIR REVISANDO y el botón atrás cierran sin entregar;
REINTENTAR ENTREGA va sin hoja; VER CHECKLIST después de la entrega; los tres
estados de la tarjeta del checklist; una incidencia pendiente; el checklist que
vuelve a faltar al abrir la corrección; una lectura con la sesión terminada va
al acceso y una sin red no bloquea, y el checklist se lee al enfocar y al
moverse la cola, nunca con el feed. `flight-screen-notices.test.js` confirma la
entrega en la hoja. Las demás pruebas que montan el manifiesto simulan los dos
servicios nuevos.

`flight-data.test.js` fija la lectura de los datos del vuelo (S1, D-S1):
`parseWholeNumber` con los bordes 0, 999, 1000, «1 000» y 700000, los miles
con coma, espacio o espacio de no separación, y el rechazo de «1.500», «78.5»,
«78,00», «-0», «1e5» y los dígitos no ASCII; un campo vacío es null, nunca 0.
`validateFlightDataDraft` da un mensaje por campo con su rango y pregunta
«¿Toneladas?» con un MTOW de 1 a 999; también fija «Faltan: …» y los avisos de
la Orden. `flight-data-card.test.js` monta la tarjeta con una cola simulada que
anuncia lo guardado antes de resolver, como el servicio: «142138» pasajeros y un
MTOW de 78 dan un mensaje cada uno, no guardan nada y llevan el foco a
«Pasajeros que llegan» (el contexto de `TextInput.prototype.focus`); «-5»,
«1.5» y «abc» se rechazan; `maxLength` se comprueba por prop, porque
react-test-renderer no lo aplica; «351,500» se guarda como 351500; 0 pasajeros
vale; borrar un valor confirmado envía null; la cola que llega después del
primer render se ve sin pisar lo escrito, y «Faltan» y «Sin guardar» no cambian
la insignia. `handoff-requirements.test.js` fija el requisito «Datos del vuelo
completos», que avisa y nunca bloquea, `operation-offline-queue.test.js` lo
recorre en el cierre y en su hoja, y `operation-documents-sheet.test.js`
comprueba el aviso en la fila de la Orden y al principio de su hoja sin apagar
FIRMAR. En las tres, una Orden firmada menciona volver a firmar y un formulario
sin `summary` no falla.

Los textos de N13 (D-N13) se fijan donde se ven. `operation-documents-sheet.test.js`
comprueba el tuteo del walk-around, de su hoja y del panel de formularios, el
texto neutro del firmante (el pad conserva «Firme aquí con el dedo») y los
conteos en palabras (`damageCountLabel`, «4 hitos»), con una expresión de usted
que solo cuenta palabras enteras. `charter-card.test.js` comprueba «Lo que
agregues aquí». `flight-report-panel.test.js` fija «Hitos del vuelo» y la ayuda
de «JB» solo en la fase que la muestra; su doble del catálogo trae «Retiro
escalera / JB». `operation-presentation.test.js` fija cada frase de
`serviceChangeSentence`, con la hora de la estación, «a la 01:20» y sin hora
legible. `ramp-operation-execution.test.js` comprueba que la confirmación
devuelve el `occurredAt` que envió. `operation-offline-queue.test.js` recorre los
avisos de servicio: la frase con la hora, la segunda confirmación que borra la
primera, la siguiente acción que la quita, el rechazo que se queda y la
corrección. `ramp-service-execution-card.test.js` comprueba que el formulario
abierto oculta la confirmación y que no vuelve al cerrarlo, que una advertencia
se queda y que la tarjeta no dice «comando» ni «payload».
`checklist-screen.test.js` y `flight-screen-notices.test.js` amplían su guarda
de jerga con `/canónic|comando|fuente de verdad/` y recorren los estados que la
mostraban: el envío sin confirmar con la copia ilegible (ACTUALIZAR), el
conflicto, sin señal ni copia y la operación cambiada en el checklist; el
servicio cambiado o rechazado, el otro servicio en curso, el inicio cambiado o
sin respuesta, la entrega y la corrección sin confirmar en el detalle.
`attendance-draft-card.test.js`, `assigned-operation-card.test.js` y
`sync-screen.test.js` cubren la tarjeta de asistencia sin «comando», «1
servicio» y «1 pendiente de envío».

Siguen pendientes las pruebas de integración en dispositivo para conectividad,
permisos y la futura sincronización de comandos.
