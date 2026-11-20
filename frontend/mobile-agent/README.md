# Elevant Mobile Agent

Aplicación nativa para agentes de rampa en tablets Android/iOS. Usa Expo 54, Expo Router y React Native. La primera distribución prevista es una APK firmada para pruebas; posteriormente se prepararán canales de Play Store y, cuando corresponda, App Store. No se aloja como aplicación web en el VPS.

## Estado actual

La primera lectura canónica de Mobile Agent ya consume `Elevant.Api` mediante
`@elevant/api-client`:

- inicio de sesión, renovación con refresh token rotativo (S3) y revalidación
  de la cuenta actual;
- operaciones/turnarounds y servicios asignados al agente autenticado;
- caché de solo lectura por cuenta para conectividad intermitente;
- registro estable de la instalación y comienzo idempotente de la operación;
- checklist canónico con borrador local por cuenta y envío idempotente;
- ejecución de servicios con transiciones y replay exacto de comandos inciertos;
- incidencias estructuradas con cola local por cuenta y operación, reintento
  idempotente y conciliación contra la lectura canónica de la API.

La entrega final a OCC y el chat por operación ya usan contratos canónicos e
idempotencia. Desde el hueco 3-I el inicio, los servicios, los cargos, el
checklist y el chat viajan por la misma cola del dispositivo que el Reporte de
Vuelo (ver «Escrituras idempotentes y cola sin conexión»); la aplicación no
convierte datos del prototipo en contratos.

En esta rama de integración, la app reconcilia `GET /api/v1/changes` mientras
está en primer plano: al volver de segundo plano y cada 25 segundos. El cursor
se mantiene solo en memoria y se reinicia al cambiar de cuenta o revisión de
sesión. Los cambios de mensajes y notificaciones invalidan sus pantallas,
que vuelven a consultar los endpoints REST. La prueba de bundle Android pasó,
pero falta verificar esta conducta en el Pixel Tablet emulado y contra el VPS.
No hay entrega push con la app cerrada ni cliente SignalR nativo en esta fase.

El observador envía la instalación local en el encabezado del feed. Para las
pistas de asistencia compartida, la API exige el vínculo vigente de esa
instalación: revocar una tablet suprime sus pistas aunque otra tablet de la
misma cuenta continúe activa. En esta rama, el detalle de la operación asignada
muestra una tarjeta de asistencia observada: inicio, fin y nota manuales del
agente y aporte OCC de solo lectura. Consulta el snapshot autorizado al entrar,
volver a primer plano, recibir `attendance_draft`, actualizar a mano y cada
25 segundos en primer plano. No usa la pista como dato ni pretende fichaje
biométrico. Esta captura sigue pendiente de aceptación en el emulador contra
Development después de su promoción.

Un envío de respuesta incierta conserva en AsyncStorage el cuerpo y UUID
originales bajo la sesión, cuenta, operación y asignación actuales; no lo
reenvía automáticamente al reconectar. Una revisión `409` conserva el intento
y muestra la versión canónica para que el agente decida entre descartarlo o
usar la revisión actual antes de guardar otra vez. Desde el hueco 3-N12 cerrar,
vencer o revocar la sesión no elimina ese comando: queda ligado a la cuenta y,
cuando la misma cuenta vuelve a entrar, pasa a la sesión nueva con su clave y su
cuerpo para un reintento deliberado. Otra cuenta no lo ve. Ni la nota ni el
bearer se registran en logs.

El workflow activo `Mobile Agent CI` valida cada cambio del cliente o del paquete
OpenAPI compartido con instalación bloqueada, lint, tipos y dos empaquetados
Metro para Android. Es CI de fuente: no firma, publica ni distribuye una APK.

## Ejecutar

Desde `frontend/mobile-agent`:

```powershell
npm install
npm run start
npm run lint
npm run typecheck
npm run test:unit
npm run test:api-client-bundle
npm run test:app-bundle
```

También puede usar `npm run android` o `npm run ios` para desarrollo. `npm run
web` sirve únicamente para revisión visual: la sesión segura canónica requiere
el runtime nativo de SecureStore. Expo Go sirve para la exploración temprana,
pero las capacidades y permisos finales deben verificarse en un development
build/app firmada.

Copie `.env.example` a su archivo local y use una URL alcanzable desde la tablet:

```text
EXPO_PUBLIC_ELEVANT_API_URL=https://<PRIVATE_API_SERVICE>.<TAILNET_DNS_NAME>.ts.net
```

`EXPO_PUBLIC_ELEVANT_API_URL` configura autenticación y asignaciones mediante el
cliente OpenAPI compartido. `localhost` desde la tablet se refiere a la propia
tablet. La tablet de prueba deberá poder acceder al tailnet para alcanzar la API
privada de Development. `EXPO_PUBLIC_*` se incluye en el binario y nunca
contiene secretos.

## Fluidez y tablet

- La app sigue la orientación del dispositivo. `src/utils/layout-class.ts`
  clasifica el ancho: desde 900 dp el inicio muestra la lista junto al
  manifiesto (`OperationDetail`), y entre 600 y 899 dp usa dos columnas.
  `android/` no se versiona: se regenera con `npx expo prebuild --clean`. Un
  `android/` generado antes de fce328ca, cuando `app.json` decía
  `"orientation": "portrait"`, deja la app bloqueada en vertical; esa fue la
  causa del letterbox en horizontal de la corrida del VPS del 16 de noviembre.
- Tras la primera carga las pantallas revalidan en segundo plano sin spinner a
  pantalla completa. Los sondeos usan `startForegroundInterval` y se pausan con
  la app en segundo plano.
- Las fechas se formatean con `src/utils/date-format.ts`, que cachea las
  instancias de `Intl`. Las listas largas deben usar `FlatList` con filas
  memoizadas y handlers estables.
- Un solo formato de fecha y hora (hallazgo N11): «lun, 16 nov» para el día y
  «16 nov, 19:46» para la fecha con hora, siempre con reloj de 24 horas
  (`hourCycle: 'h23'`; si un motor escribe «24:05», se corrige a «00:05»).
  - `formatStationDate`, `formatStationTime` y `formatStationDateTime` dan la
    hora local de la estación. Si la tablet no conoce su zona IANA (un comando
    guardado por una versión anterior, una estación sin operaciones en la
    tablet), usan `America/Santo_Domingo`, como private-web y
    `BusinessCalendar`, nunca la zona del equipo.
  - El inicio toma la zona de las operaciones asignadas para «última
    actualización» y para «Mis posiciones de hoy».
  - `formatLocalDateTime` da el mismo formato en la hora del equipo; hoy lo
    usan chat y notificaciones.
  - La tarjeta de una operación escribe «Inicio planificado» y el día tal como
    salen, sin mayúsculas forzadas. El rótulo ocupa hasta dos líneas y se
    reduce para caber (`adjustsFontSizeToFit` con un tope de escala de fuente,
    porque Fabric ignora `minimumFontScale` en Android). En el detalle, el
    nombre del aeropuerto ya no se corta en una columna fija de 76 dp.
- Unidades de cobro en español (hallazgo S5, D-S5): `src/utils/billing-units.ts`
  nombra la unidad de un servicio como Finanzas, nunca con su código, y escribe
  el plural: «0 / 1 hora», «1 / 1 operación», «0 / 3 operaciones» y
  «Cantidad ejecutada (horas)».
  - Un nombre heredado («Operación», «Hora», con o sin tilde, en mayúsculas o
    minúsculas) se lee como su código, igual que `billingUnitCode` de
    private-web. Una unidad que la tablet no conoce sale tal cual.
  - Las unidades de conteo (operación, servicio, aeronave y pasajero) piden
    números enteros con el teclado numérico: «Solo números enteros.». La
    cantidad contratada que propone la tarjeta se acepta aunque tenga
    decimales, y un comando ya reservado se reintenta tal como se reservó. Las
    demás unidades, y las desconocidas, admiten hasta cuatro decimales. La
    regla es solo de la tablet: el servidor sigue aceptando cuatro decimales.
  - La Orden de Servicio conserva las abreviaturas de su PDF («1 h»,
    «1 serv.») con `billingUnitAbbreviation`.
- Ruta y asignación legibles (hallazgos N10 y N9, D-N10 y D-N9):
  - `operationRouteStops` da las paradas de la escala en orden: origen,
    estación y siguiente destino. La tarjeta las muestra como BWI → PUJ → BWI,
    con la estación resaltada, y `operationRouteDescription` le da al lector
    de pantalla «llega de BWI a PUJ y sale hacia BWI».
  - Un tramo que falta se omite, sin poner la estación en su lugar. Sin vuelos,
    la tarjeta nombra la estación junto a «Ruta por confirmar». El riel de la
    hora ya no repite el código de la estación.
  - En una tarjeta angosta, la ruta pasa a otra línea entre dos paradas.
  - `assignmentRoleLabel` escribe «Agente principal» para `primary`, sin
    distinguir mayúsculas. Un rol desconocido da `null` y el detalle omite esa
    fila. La posición operativa se nombra solo por su nombre, sin el código.
- Códigos internos en segundo plano y una sola numeración (hallazgo N12,
  D-N12). Mientras AVIAM no decida retirarlos, los códigos siguen a la vista
  como texto secundario:
  - La tarjeta de un servicio tiene el nombre como título y el código
    («RAMP-AC») debajo, pequeño y sin negrita.
  - «Cargos aplicados» pone el número de línea delante del nombre,
    «1 · Aire acondicionado», como las tarjetas de servicio, y el código
    debajo. Así se distinguen dos líneas del mismo servicio.
  - El checklist dice «Versión 1» y deja el código de la plantilla debajo, en
    pequeño.
  - Cada control lleva un solo número, el del PDF, con `checklistItemNumber`
    (`src/features/checklist/presentation.ts`). Es el número en que termina
    su código (ARR-01 → 1, PUSH-11 → 11), así que el Reporte de Vuelo va de 1
    a 21. Si el código no termina en un número (PREUSE-EXTERIOR), es su
    posición dentro de la sección. La tarjeta del control
    (`src/components/checklist-item-card.tsx`) ya no muestra el código junto a
    un segundo número.
- Asistencia e incidencias en la hora de la estación (hallazgo S6, D-S6). La
  tarjeta de asistencia ya no edita en la zona del equipo, que además podía
  cambiar a mitad de la operación:
  - Dice «Las horas están en hora local de PUJ» con `stationTimeLabel`, y el
    detalle titula los vuelos «Hora local de PUJ» (`stationTimeTitle`) en
    lugar del identificador IANA. Si falta el código, «hora local de la
    estación».
  - Los campos muestran la hora de la estación, «2026-10-05 10:00», con
    `stationWallClock`. `stationWallClockToInstant` la convierte al instante
    UTC que viaja y se guarda, comprobando que se lee igual de vuelta. Una hora
    que el reloj de la estación salta en un cambio de horario (las 02:30 del
    8 de marzo en Nueva York) no se guarda: nunca se pasa a otra hora. Una
    hora que se repite toma su primera vez.
  - Las dos funciones leen la hora con `formatToParts`. En un motor que no lo
    trae, la leen del texto que escribe `en-US`. Un motor que cuenta hasta 24
    o que escribe «07:46 PM» no cambia la hora guardada.
  - El conflicto muestra las horas con `formatStationDateTime`,
    «5 oct, 10:00»: la versión guardada y tu intento tienen el mismo formato.
    El aporte de OCC también va en la hora de la estación, sin la fecha cuando
    es la del día de la operación (hallazgo N8, abajo).
  - Un reintento envía el comando reservado tal cual, aunque lo haya reservado
    una versión anterior en la zona del equipo.
  - Las incidencias de la operación muestran su hora en la zona de la
    estación.
  - Si la tablet no conoce la zona, usa `America/Santo_Domingo`. La cola y el
    almacenamiento siguen guardando instantes UTC. OCC y Gestión Humana no
    cambian en esta entrega: el panel de OCC edita en la zona del navegador y
    la revisión de Gestión Humana muestra UTC.
- La tarjeta de asistencia con el estilo de la app (hallazgo N8, en parte;
  D-N8):
  - Todos sus textos toman el tamaño y el peso de `type` y el color de la
    paleta (`src/theme/tokens.ts` y `src/theme/colors.ts`). Los campos miden
    56 dp (`touch.min`, ADR-0031) y usan la letra de «Datos del vuelo».
  - Si OCC no registró horas ni nota, su aporte dice «OCC aún no registra
    horas.» en una sola línea, en lugar de cinco líneas vacías. Con datos dice
    «Inicio 19:48 · Fin —», la nota y «Registrado 16 nov, 19:50».
  - Una hora que no cae en el día de la operación en la estación lleva su
    fecha, «Fin 17 nov, 00:30». El detalle le pasa ese día a la tarjeta
    (`operationDate`); sin él, todas las horas llevan su fecha.
  - Se mantienen los contadores de revisión, y las horas se siguen escribiendo
    a mano: D-N8 deja el selector de hora para otra entrega.
- La hoja de firma con los botones siempre al alcance (hallazgo S2, D-S2):
  - `src/components/sheet-frame.tsx` es el marco de las hojas a pantalla
    completa: una cabecera fija con el título y un botón que cierra la hoja
    («Cerrar sin firmar» en la de firma), un cuerpo que se desplaza y un pie
    fijo con las acciones. Desde 600 dp el pie pone su nota y sus botones en
    una fila; en compact los apila. El botón atrás de Android también cierra.
    El marco sigue la orientación también en iOS (`supportedOrientations`) y
    deja la cabecera y el pie fuera de las barras del sistema (`SafeAreaView`),
    que un modal de Android cubre de borde a borde.
  - La hoja de firma lleva en el pie la huella del documento, CANCELAR y
    FIRMAR. El nombre y la cédula van al principio del cuerpo, donde el pie no
    los tapa; después vienen los datos y, al final, el pad. Empezar un trazo no
    cierra el teclado: el cambio de layout movería el pad bajo el primer trazo.
  - El pad (`src/components/documents/signature-pad.tsx`) mide como máximo
    720 dp de ancho, centrado, y conserva la proporción 3:1.
  - Solo un dedo levantado guarda un trazo. Si el desplazamiento de la hoja se
    queda con el gesto (un deslizamiento que empieza sobre el pad), el trazo
    en curso se descarta y la hoja vuelve a desplazarse; los trazos ya hechos
    se conservan. «Borrar firma» borra también el trazo en curso, y un pad que
    sale de la pantalla a mitad de un trazo devuelve el desplazamiento.
  - Sin dos columnas en pantallas anchas (D-S2) y sin
    `react-native-gesture-handler`.

## Autorización y almacenamiento

La API determina la cuenta, el perfil de agente y las estaciones autorizadas. El
dispositivo no envía `agentId` ni `stationId` al consultar sus asignaciones. La
sesión solo se conserva cuando la respuesta y la revalidación actual contienen
el rol exacto `RAMP_AGENT` del portal `ramp_mobile_app`, membresía interna de
AVIAM y al menos un scope de estación. Los comandos operativos registran primero
la instalación actual y la API vuelve a validar cuenta, asignación, estación y
vínculo del dispositivo antes de aceptar cualquier escritura.

Una cuenta creada por Gestión Humana con contraseña temporal recibe `409
password_change_required` al iniciar sesión. La pantalla de acceso pide entonces
cambiarla (`POST /api/v1/auth/password-change`, sin sesión) con la política de la
API visible en vivo. Tras el `204`, inicia sesión con la nueva contraseña y sigue
el flujo normal. Ninguna contraseña se guarda.

Las tablets son compartidas (fase 2, bloque E): iniciar sesión vincula la
instalación a la cuenta y la toma de otro agente, salvo que ese agente tenga una
operación en curso (`device_in_use_by_active_agent`). Cerrar sesión libera la
tablet con `POST /api/v1/mobile/device/release` (mejor esfuerzo, con tiempo
límite: sin conexión la sesión se cierra igual y el siguiente inicio de sesión
la toma). Cada inicio de sesión abre su propio vínculo con la tablet (la API lo
reconoce por el inicio de la sesión, `auth_time`, que la renovación conserva) y
la liberación lleva como versión esperada el `lastSeenAt` del registro más
reciente que confirmó la sesión, también después de renovar su token: si llega
tarde, después de que el agente volvió a iniciar sesión en la misma tablet,
responde `version_conflict` y no libera nada; las escrituras de la propia sesión
nunca la rechazan. OCC puede liberarla o revocarla desde «Tablets»; una tablet
revocada (`device_revoked`) no vuelve a registrarse y la app lo explica al
iniciar sesión. El vínculo sigue mientras la operación del otro agente esté en
curso, aunque su sesión ya haya vencido, así que con
`device_in_use_by_active_agent` el acceso no le pide que cierre sesión: dice
que la tablet sigue a nombre de otro agente y pide a OCC que la libere en
«Tablets» antes de volver a intentarlo. No muestra quién la tiene ni precarga
el correo (N7, D-N7). La APK anterior no libera al cerrar sesión, pero el
siguiente agente la toma igual.

La sesión se renueva como en AVIAM Web (S3,
[ADR-0046](../../docs/adr/0046-renewable-sessions-on-shared-tablets.md)): el
inicio de sesión guarda el refresh token y, en el último minuto del access token
(o ya vencido), la siguiente solicitud lo renueva con
`POST /api/v1/auth/session/refresh`. Una sola renovación atiende a todas las
solicitudes que la esperan. Con `200` se reemplaza la credencial de la misma
cuenta sin cambiar la revisión de la sesión, así que cachés, borradores,
reservas y el vínculo de la tablet siguen; con `409` se relee lo guardado; con
`401` la sesión termina con esa causa (`session_expired`, estado 401); sin señal,
con `429` o `5xx` la sesión sigue con su credencial y la siguiente renovación
espera 30 segundos. Un `401` de una solicitud fuerza una renovación y la
solicitud se repite una vez; una credencial que ELEVANT rechaza recién renovada
termina la sesión. Solo se renueva si el JWT trae `auth_time`: frente a una API
anterior la sesión termina con su access token, como antes. Todo se compara con
el reloj de ELEVANT (3-N18), así que un reloj adelantado no impide entrar y un
desfase viejo solo adelanta la renovación. No hay tope de horas: la sesión
termina al cerrar sesión, con la revocación de OCC o tras 30 días sin uso. Si se
pierde la respuesta de una renovación (D-S3b), la tablet sigue con su access
token; si ya venció, lo que no puede leer ni enviar falla como una solicitud
que se puede reintentar (`request_failed`), nunca como un cambio de la
operación. Pasado el minuto de margen ELEVANT trata el refresh token viejo como
reuso, revoca la familia y el agente vuelve a entrar sin perder lo registrado.

El bearer token y el refresh token se guardan exclusivamente con
`expo-secure-store` (sobre v2; el v1 de la APK anterior se sigue leyendo, sin
refresh); nunca forman parte del objeto de sesión entregado a la UI,
AsyncStorage ni logs. Token y metadata se enlazan mediante una revisión
aleatoria: una pareja incompleta o inconsistente se rechaza en cerrado.
AsyncStorage conserva actor/expiración no secretos (y hasta cuándo renueva el
refresh token), la caché versionada por `accountId`, borradores del checklist y
comandos pendientes namespaced por cuenta y operación. Nunca conserva el bearer
token ni el refresh token. Encolar un toque, guardar un borrador y reservar la
asistencia solo necesitan la identidad de la sesión guardada en la tablet, sin
red ni renovación. Una sesión vencida, sin un refresh token vigente, se elimina
en cerrado; un access token vencido con el refresh vigente no borra nada.
Cerrar sesión libera la tablet y termina la familia en ELEVANT
(`POST /api/v1/auth/session/logout`), cada uno con un límite de 5 segundos. Si
el access token venció o está en su último minuto, antes lo renueva una vez,
aunque sea durante la pausa de 30 segundos y con el mismo límite, para que
ELEVANT acepte la liberación; la familia termina después de esa renovación. Un
inicio de sesión que la tablet no conserva (por ejemplo, si falla el registro
de la tablet) también termina la familia recién emitida. Logout, el `401` de una
renovación rechazada y `403` eliminan token, refresh token, metadata, cachés
(operaciones asignadas, cargos y checklist) y todo estado sensible heredado del
prototipo. Desde el hueco 3-N12 no eliminan lo que
el agente registró y ELEVANT aún no confirmó: la cola del Reporte de Vuelo y sus
fotos, las incidencias, los comandos reservados, la entrega y la corrección, los
borradores del checklist y las observaciones de asistencia quedan en la tablet
ligados a su cuenta, y solo esa cuenta los lee y envía al volver a entrar. El
acceso avisa cuántos registros guarda la tablet, el perfil avisa antes de cerrar
sesión que se conservan y «Sincronización» indica los de otra cuenta, que no se
pueden ver ni descartar. Nada se borra solo: el agente descarta únicamente sus
propios registros rechazados.

Lo que el agente marca en el checklist después de que su sesión terminó tampoco
se pierde (N5). Al borrar una sesión vencida o rechazada (`401` de la
renovación o `403`), la tablet deja el marcador no secreto
`elevant:mobile:ended-session:v1` con la cuenta, la causa (`expired`,
`refused` o `forbidden`) y la hora del fin según el reloj de ELEVANT; una
sesión vencida terminó cuando venció su access token, no cuando la tablet lo
notó. La pantalla del checklist fija la cuenta al cargar el borrador y guarda
siempre para ella: con su sesión activa responde `saved`, y sin sesión, si el
marcador nombra esa cuenta y no pasaron más de 2 horas desde el fin (D-N5),
`kept-until-sign-in`, también si la sesión termina mientras el guardado espera
al almacenamiento. Las respuestas vuelven cuando esa cuenta inicia sesión de
nuevo. Con otra cuenta activa, después de un cierre de sesión a propósito o
fuera de ese plazo el borrador no se guarda (`session_expired`), y solo un fallo
real del almacenamiento da `storage_unavailable`. El cierre de sesión a
propósito y un inicio de sesión confirmado borran el marcador; un intento
fallido no. El esquema del borrador no cambia y los comandos de la cola siguen
exigiendo una sesión (D-N5).

La app dice cuándo terminó la sesión y deja de culpar al dispositivo (N6). Cada
vez que la tablet borra una sesión que el agente no cerró (vencida, rechazada
por ELEVANT o de una cuenta que perdió el acceso), el almacenamiento lo anuncia
(`subscribeMobileSessionEnd` en el servicio de sesión) y el layout raíz muestra
en todas las pantallas, salvo la de acceso, el aviso persistente «Tu sesión
terminó» con ENTRAR DE NUEVO (D-N6); el cierre de sesión a propósito no se
anuncia. El checklist ya no salta solo al acceso: muestra la insignia roja
«Sesión terminada», dice «Tu sesión terminó · Tus respuestas quedaron guardadas
en esta tablet…», apaga ENVIAR y ofrece ENTRAR DE NUEVO, con `access_revoked`
si la cuenta perdió el acceso. Mientras muestra ese aviso propio, el layout no
repite el suyo: la pantalla tiene un solo aviso, un solo ENTRAR DE NUEVO y un
solo anuncio, y nunca dice que guardó respuestas que no pudo guardar. Si el envío encontró el fin de la sesión, las
respuestas quedan como se enviaron: el envío espera en la cola y sale al volver
a entrar. ENVIAR vuelve a guardar el borrador y espera ese guardado antes de
decidir. Un fallo del almacenamiento ofrece REINTENTAR GUARDADO, un intento por
toque, y si vuelve a fallar pide cerrar la app y avisar a OCC; un guardado
cancelado se reintenta una vez para la misma cuenta. Los hitos y los datos del
vuelo distinguen la sesión terminada (`session_expired`, `unauthenticated`) de
un fallo del almacenamiento (`storage_unavailable`). Ningún texto pide
desbloquear el dispositivo, que en Android nunca es la causa, ni habla de
«payload».

La pantalla de acceso dice cómo terminó la sesión anterior (N7). El aviso está
en pasado y nombra la causa del marcador de fin: «La sesión anterior venció»,
«ELEVANT cerró la sesión anterior» o, con `access_revoked`, que la cuenta perdió
el acceso a la aplicación de rampa; sin marcador solo dice que terminó. Sale al
llegar con ENTRAR DE NUEVO y también cuando la propia pantalla encuentra la
sesión vencida. Dura hasta el siguiente intento, así que no convive con el
error de ese intento, y vuelve con un aviso nuevo. Tras ENTRAR DE NUEVO, el
aviso de pendientes cuenta solo los registros de la cuenta que terminó
(`countPendingEvidence` los separa mientras nadie inició sesión): nunca le
atribuye los de otra cuenta. El campo de correo no usa una dirección de prueba
(«Correo de tu cuenta AVIAM») y el logo y el formulario forman un solo bloque
centrado, también en vertical, con el pie al final.

La caché se usa como fallback únicamente cuando `fetch` no alcanza la red y su
antigüedad no supera 15 minutos. Un `401`, `403`, otro fallo HTTP, cancelación,
caché vencida o contrato malformado se entrega como error tipado y nunca se
disfraza con datos cacheados. Las solicitudes expiran a los 15 segundos para
evitar que la interfaz quede bloqueada cuando una ruta privada deja de responder.

Las evidencias reales están deshabilitadas hasta definir almacenamiento S3-compatible, tamaño/tipos, retención y autorización. SQL Server no almacenará binarios; una futura tabla conservará solo metadatos y object keys.

## Escrituras idempotentes y cola sin conexión

Desde el hueco 3-I la tablet tiene una sola cola persistente por cuenta
(`src/synchronization/flight-report-outbox.ts`). Cada toque se guarda primero
en el dispositivo, con su clave de idempotencia estable, y sale después en
orden FIFO por operación: inicio, transiciones de servicio, cargos, envío del
checklist, chat, hitos, datos del vuelo, firmas, walk-around y charter. El
inicio y los servicios llevan la hora del toque, corregida con el reloj de
ELEVANT: el servidor la conserva aunque el comando llegue minutos u horas
después, dentro de la ventana de la operación. La misma clave con el mismo
cuerpo repite el mismo resultado; un comando que reservó una versión anterior
se importa una vez con su clave y sin hora, para que su recibo coincida.

Desde el hueco 3-N18 la tablet corrige su reloj con el de ELEVANT
(`src/synchronization/server-clock.ts`). Cada respuesta trae la cabecera
`Date`; si la ida y vuelta tardó menos de 5 segundos, la tablet calcula su
desfase y lo guarda en el dispositivo, fuera de la sesión, para que «AHORA»
siga corregido sin señal. Toda hora que captura la tablet sale de ese reloj:
hitos y su ajuste, inicio, servicios, daños del walk-around, incidencias,
desviaciones y observaciones de asistencia. Las pantallas siguen mostrándolas
en la hora local de la estación. Hasta el hallazgo S6, la asistencia y las
incidencias eran la excepción: se mostraban, y la asistencia se editaba, en la
zona del equipo. Ahora también usan la hora de la estación, y la tarjeta de
asistencia lo dice: «Las horas están en hora local de PUJ». Si el desfase supera
los 2 minutos que tolera ELEVANT, la insignia de conexión avisa que los
registros se corrigen solos y pide revisar la hora del equipo.

Las horas de los hitos se ajustan dentro de la ventana de la operación que mide
ELEVANT: desde el inicio o la llegada registrada, lo que ocurrió primero, hasta
ahora (huecos 3-N25 y 3-N09). En una ronda de corrección, cuando OCC devolvió la
operación, un hito vacío no se graba con «AHORA»: abre el ajuste en la última
hora registrada, con pasos de hasta una hora, porque los hechos del vuelo
ocurrieron antes de la primera entrega; ELEVANT acepta los hitos hasta esa
entrega y el ajuste lo indica. El reenvío mide el tiempo en tierra hasta esa
primera entrega. Los daños del walk-around, las incidencias y las desviaciones
se registran con la hora actual, sin selector, y ELEVANT también los acepta
durante la corrección.

La cola se vacía al abrir la app, al recuperar señal, al volver a primer plano
y cada minuto mientras quede algo pendiente; después salen las incidencias
guardadas. Sin señal o con la sesión revocada se detiene; una foto que ELEVANT
no puede guardar ahora no detiene nada y sigue saliendo sola, y el agente puede
descartarla en «Sincronización» para entregar la operación sin ella; una foto
que la tablet no puede leer, o la de una marca de daño que ELEVANT rechazó, no
se envía y espera allí, con su motivo, a que el agente la descarte; al
reintentar la marca, su foto la sigue. Cualquier otro fallo temporal retiene
solo el resto de su operación. Un rechazo conserva su código de Problem
Details, se explica en español y espera en «Sincronización» a que el agente lo
revise. La pantalla de la operación muestra lo que espera en la cola aplicado
sobre la vista de ELEVANT o su copia guardada, marcado «En el dispositivo».

La entrega final a OCC sigue reservando su payload y su clave antes de tocar la
red y requiere conexión, checklist enviado, servicios terminados y cola de
incidencias sincronizada. Desde el hueco 3-N06 la tablet vacía antes su cola y
no entrega mientras quede un registro pendiente o rechazado de la operación, ni
mientras la Orden de Servicio no tenga las firmas de la aerolínea y de AVIAM
sobre su contenido actual; la tarjeta de entrega dice qué falta. El servidor no
rechaza esa entrega (la APK anterior sigue funcionando): mientras OCC revisa,
acepta los hitos y daños capturados antes de la entrega, recalcula los recargos
y la evidencia y OCC debe releer. El agente confirma explícitamente el cierre y
puede agregar una nota opcional. Si se pierde la respuesta, la app congela la nota y
reintenta el mismo comando; nunca genera una segunda entrega por
incertidumbre. El estado confirmado pasa a `PendingReview`.

Cada incidencia se guarda primero en una cola local acotada de 25 reportes por
operación. Incluye tipo, impacto, descripción, hora UTC de ocurrencia y una
clave estable. Se envía en orden y se conserva si falla la red, hay timeout o
una respuesta incierta; la lectura canónica puede confirmar un envío cuya
respuesta se perdió. Un rechazo determinístico queda visible como bloqueado,
sin descartar un posible evento de seguridad.

El servidor registra la combinación dispositivo + clave y devuelve el mismo resultado ante reintentos. REST recupera el estado canónico después de reconectar; SignalR solo acelera avisos y puede llegar duplicado o fuera de orden.

## Entrega APK y tiendas

Antes de una APK compartida se deben fijar application ID, perfil Development, custodia de claves, versión, permisos, URL API y estrategia de actualización. Las claves de firma nunca se suben a Git. Un build Development no comparte URL, credenciales, storage ni firma con Production.

Antes de construir una APK, `android/` se regenera desde `app.json` con `npx expo prebuild --clean`. Como no se versiona, una copia local puede quedar vieja: una generada antes de fce328ca fija `"orientation": "portrait"` y deja la app bloqueada en vertical, aunque `app.json` diga `"default"` y las pantallas sigan la orientación del dispositivo.

Play Store/App Store será una fase posterior con identificadores estables, políticas de privacidad, ficha, firma administrada, pruebas internas/cerradas y promoción controlada. La URL privada del tailnet no se usará como endpoint de una app pública de Production.


## Emisión de presencia operativa

La ampliación local de OCC incorpora un emisor efímero en el layout raíz.
Utiliza la identidad atómica de la sesión y el cliente compartido, observa
interacciones táctiles y AppState, y cierra el lease anterior al cambiar de cuenta.
La identidad del lease es la sesión y su cuenta, no el token: renovar el token
conserva el lease y cada latido lee el token vigente (S3).
En segundo plano se pausa; al recuperar primer plano se comprueba la identidad
antes de reanudar. Los fallos transitorios de almacenamiento suspenden el envío
y evitan atribuir actividad a una cuenta posiblemente sustituida.

Los heartbeats no se guardan en la outbox ni alteran autenticación, comandos,
idempotencia o esquema. Los indicadores se presentan en Private Web/OCC.
Su comprobación real exige dos cuentas QA, API/SQL de pruebas y un Android de QA;
las pruebas de adaptador o bundles no sustituyen ese recorrido. No se publicó APK.
