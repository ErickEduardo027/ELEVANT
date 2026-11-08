# Elevant Mobile Agent

Aplicación nativa para agentes de rampa en tablets Android/iOS. Usa Expo 54, Expo Router y React Native. La primera distribución prevista es una APK firmada para pruebas; posteriormente se prepararán canales de Play Store y, cuando corresponda, App Store. No se aloja como aplicación web en el VPS.

## Estado actual

La primera lectura canónica de Mobile Agent ya consume `Elevant.Api` mediante
`@elevant/api-client`:

- inicio de sesión y revalidación de la cuenta actual;
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
- Tras la primera carga las pantallas revalidan en segundo plano sin spinner a
  pantalla completa. Los sondeos usan `startForegroundInterval` y se pausan con
  la app en segundo plano.
- Las fechas se formatean con `src/utils/date-format.ts`, que cachea las
  instancias de `Intl`. Las listas largas deben usar `FlatList` con filas
  memoizadas y handlers estables.

## Autorización y almacenamiento

La API determina la cuenta, el perfil de agente y las estaciones autorizadas. El
dispositivo no envía `agentId` ni `stationId` al consultar sus asignaciones. La
sesión solo se conserva cuando la respuesta y la revalidación actual contienen
el rol exacto `RAMP_AGENT` del portal `ramp_mobile_app`, membresía interna de
AVIAM y al menos un scope de estación. Los comandos operativos registran primero
la instalación actual y la API vuelve a validar cuenta, asignación, estación y
vínculo del dispositivo antes de aceptar cualquier escritura.

Las tablets son compartidas (fase 2, bloque E): iniciar sesión vincula la
instalación a la cuenta y la toma de otro agente, salvo que ese agente tenga una
operación en curso (`device_in_use_by_active_agent`). Cerrar sesión libera la
tablet con `POST /api/v1/mobile/device/release` (mejor esfuerzo, con tiempo
límite: sin conexión la sesión se cierra igual y el siguiente inicio de sesión
la toma). OCC puede liberarla o revocarla desde «Tablets»; una tablet revocada
(`device_revoked`) no vuelve a registrarse y la app lo explica al iniciar sesión.
La APK anterior no libera al cerrar sesión, pero el siguiente agente la toma igual.

El bearer token se guarda exclusivamente con `expo-secure-store`; nunca forma
parte del objeto de sesión entregado a la UI, AsyncStorage ni logs. Token y
metadata se enlazan mediante una revisión aleatoria: una pareja incompleta o
inconsistente se rechaza en cerrado. AsyncStorage conserva actor/expiración no
secretos, la caché versionada por `accountId`, borradores del checklist y
comandos pendientes namespaced por cuenta y operación. Nunca conserva el bearer
token. Una sesión vencida se elimina en cerrado. Logout, `401` y `403` eliminan
token, metadata, cachés (operaciones asignadas, cargos y checklist) y todo
estado sensible heredado del prototipo. Desde el hueco 3-N12 no eliminan lo que
el agente registró y ELEVANT aún no confirmó: la cola del Reporte de Vuelo y sus
fotos, las incidencias, los comandos reservados, la entrega y la corrección, los
borradores del checklist y las observaciones de asistencia quedan en la tablet
ligados a su cuenta, y solo esa cuenta los lee y envía al volver a entrar. El
acceso avisa cuántos registros guarda la tablet, el perfil avisa antes de cerrar
sesión que se conservan y «Sincronización» indica los de otra cuenta, que no se
pueden ver ni descartar. Nada se borra solo: el agente descarta únicamente sus
propios registros rechazados.

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
en la hora local de la estación. Si el desfase supera los 2 minutos que tolera
ELEVANT, la insignia de conexión avisa que los registros se corrigen solos y
pide revisar la hora del equipo.

Las horas de los hitos se ajustan dentro de la ventana de la operación que mide
ELEVANT: desde el inicio o la llegada registrada, lo que ocurrió primero, hasta
ahora (huecos 3-N25 y 3-N09). En una ronda de corrección, cuando OCC devolvió la
operación, un hito vacío no se graba con «AHORA»: abre el ajuste en la última
hora registrada, con pasos de hasta una hora, porque los hechos del vuelo
ocurrieron antes de la primera entrega. El reenvío mide el tiempo en tierra
hasta esa primera entrega.

La cola se vacía al abrir la app, al recuperar señal, al volver a primer plano
y cada minuto mientras quede algo pendiente; después salen las incidencias
guardadas. Sin señal o con la sesión revocada se detiene; una foto que ELEVANT
no puede guardar ahora no detiene nada; cualquier otro fallo temporal retiene
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

Play Store/App Store será una fase posterior con identificadores estables, políticas de privacidad, ficha, firma administrada, pruebas internas/cerradas y promoción controlada. La URL privada del tailnet no se usará como endpoint de una app pública de Production.


## Emisión de presencia operativa

La ampliación local de OCC incorpora un emisor efímero en el layout raíz.
Utiliza la identidad atómica de la sesión y el cliente compartido, observa
interacciones táctiles y AppState, y cierra el lease anterior al cambiar de cuenta.
En segundo plano se pausa; al recuperar primer plano se comprueba la identidad
antes de reanudar. Los fallos transitorios de almacenamiento suspenden el envío
y evitan atribuir actividad a una cuenta posiblemente sustituida.

Los heartbeats no se guardan en la outbox ni alteran autenticación, comandos,
idempotencia o esquema. Los indicadores se presentan en Private Web/OCC.
Su comprobación real exige dos cuentas QA, API/SQL de pruebas y un Android de QA;
las pruebas de adaptador o bundles no sustituyen ese recorrido. No se publicó APK.
