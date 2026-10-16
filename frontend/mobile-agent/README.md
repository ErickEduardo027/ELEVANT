# ELEVANT Mobile Agent

Aplicación nativa para agentes de rampa en tablets Android/iOS. Usa Expo 57, Expo Router y React Native. La primera distribución prevista es una APK firmada para pruebas; posteriormente se prepararán canales de Play Store y, cuando corresponda, App Store. No se aloja como aplicación web en el VPS.

## Estado actual

La primera lectura canónica de Mobile Agent ya consume `Elevant.Api` mediante
`@elevant/api-client`:

- inicio de sesión y revalidación de la cuenta actual;
- activación obligatoria al recibir `password_change_required`;
- operaciones/turnarounds y servicios asignados al agente autenticado;
- caché de solo lectura por cuenta para conectividad intermitente;
- registro estable de la instalación y comienzo idempotente de la operación;
- checklist canónico con borrador local por cuenta y envío idempotente;
- ejecución de servicios con transiciones y replay exacto de comandos inciertos;
- incidencias estructuradas con cola local por cuenta y operación, reintento
  idempotente y conciliación contra la lectura canónica de la API.

La entrega final a OCC y el chat por operación ya usan contratos canónicos e
idempotencia. El móvil captura fotografías, firma, responsable, entrega de
llave y observaciones en almacenamiento local por cuenta y operación. El centro
de sincronización enumera las reservas existentes y reintenta los comandos
soportados; la aplicación no convierte datos del prototipo en contratos.

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
usar la revisión actual antes de guardar otra vez. Al cerrar o revocar la sesión
se eliminan esos comandos. Ni la nota ni el bearer se registran en logs.

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

Mientras la API Development no esté disponible puede habilitarse, únicamente
en Metro/desarrollo, una cuenta local para revisar el flujo de activación:

```text
EXPO_PUBLIC_ENABLE_LOCAL_AUTH=true
correo: agente.puj@elevant.local
contraseña temporal: ElevantPUJ2026!
```

El primer acceso obliga a elegir una contraseña nueva de al menos 14 caracteres.
La credencial nueva se conserva como hash en SecureStore. El modo también exige
`__DEV__`, por lo que no sustituye la cuenta del servidor ni funciona en una
compilación de producción.

`EXPO_PUBLIC_ELEVANT_API_URL` configura autenticación y asignaciones mediante el
cliente OpenAPI compartido. `localhost` desde la tablet se refiere a la propia
tablet. La tablet de prueba deberá poder acceder al tailnet para alcanzar la API
privada de Development. `EXPO_PUBLIC_*` se incluye en el binario y nunca
contiene secretos.

## Compilaciones EAS

`eas.json` define tres perfiles Android:

- `development`: APK interna para validación técnica;
- `preview`: APK interna para el equipo de pruebas;
- `production`: Android App Bundle para Google Play, con incremento remoto
  del código de versión.

La primera vez, después de recibir la cuenta Expo del equipo:

```powershell
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest env:create --environment development --name EXPO_PUBLIC_ELEVANT_API_URL --value https://elevant-dev-api.taild2f562.ts.net --visibility plaintext
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_ELEVANT_API_URL --value https://elevant-dev-api.taild2f562.ts.net --visibility plaintext
npx eas-cli@latest build --platform android --profile preview
```

La URL de producción se registra por separado en el ambiente `production`.
No se debe activar la cuenta temporal en Preview ni Production. La primera
ejecución de EAS añadirá el identificador remoto del proyecto y solicitará
definir la custodia de la clave de firma; ninguno de esos valores se inventa
en el repositorio.

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

El bearer token se guarda exclusivamente con `expo-secure-store`; nunca forma
parte del objeto de sesión entregado a la UI, AsyncStorage ni logs. Token y
metadata se enlazan mediante una revisión aleatoria: una pareja incompleta o
inconsistente se rechaza en cerrado. AsyncStorage conserva actor/expiración no
secretos, la caché versionada por `accountId`, borradores del checklist y
comandos pendientes namespaced por cuenta y operación. Nunca conserva el bearer
token. Una sesión vencida se elimina en cerrado. Logout, `401` y `403` eliminan
token, metadata, cachés, borradores, comandos pendientes y todo estado sensible
heredado del prototipo.

La caché se usa como fallback únicamente cuando `fetch` no alcanza la red y su
antigüedad no supera 15 minutos. Un `401`, `403`, otro fallo HTTP, cancelación,
caché vencida o contrato malformado se entrega como error tipado y nunca se
disfraza con datos cacheados. Las solicitudes expiran a los 15 segundos para
evitar que la interfaz quede bloqueada cuando una ruta privada deja de responder.

La captura local de evidencias está habilitada y se muestra como pendiente en
`/sync`. Su carga remota permanece deshabilitada hasta definir almacenamiento
S3-compatible, tamaño/tipos, retención, autorización y contrato API. SQL Server
no almacenará binarios; una futura tabla conservará solo metadatos y object keys.

## Escrituras idempotentes y sincronización offline

El inicio de operación, el envío del checklist, cada transición de servicio y
la entrega final a OCC
reservan el payload y la clave de idempotencia antes de tocar la red. Ante
timeout, desconexión, `429` o `5xx`, la interfaz bloquea la edición incompatible
y el siguiente intento reutiliza exactamente el mismo comando. Un rechazo
determinístico descarta la reserva y obliga a consultar nuevamente el estado
canónico.

La entrega a OCC requiere conexión, checklist enviado, servicios terminados y
cola de incidencias sincronizada. El agente confirma explícitamente el cierre
y puede agregar una nota opcional. Si se pierde la respuesta, la app congela la
nota y reintenta el mismo comando; nunca genera una segunda entrega por
incertidumbre. El estado confirmado pasa a `PendingReview`, donde la ejecución
queda cerrada a nuevas escrituras del agente.

Cada incidencia se guarda primero en una cola local acotada de 25 reportes por
operación. Incluye tipo, impacto, descripción, hora UTC de ocurrencia y una
clave estable. Se envía en orden y se conserva si falla la red, hay timeout o
una respuesta incierta; la lectura canónica puede confirmar un envío cuya
respuesta se perdió. Un rechazo determinístico queda visible como bloqueado,
sin descartar un posible evento de seguridad. La cola se borra al cerrar o
revocar la sesión. Las evidencias se administran en una cola local separada y
no se presentan como cargadas mientras no exista un recibo del backend.

La pantalla `/sync` muestra reservas pendientes y casos que requieren volver a
su operación. Reintenta automáticamente incidencias y mensajes conservando la
clave original. Checklist, servicios, cargos, cierre, corrección y asistencia
mantienen su comando congelado para conciliación desde su pantalla canónica.

Toda nueva escritura offline deberá conservar:

- un identificador estable del dispositivo registrado;
- una clave de idempotencia estable por comando;
- tipo, payload/versionado y momento local;
- estado pendiente/sincronizando/confirmado/requiere intervención;
- intentos y último error sanitizado.

El servidor registra la combinación dispositivo + clave y devuelve el mismo resultado ante reintentos. REST recupera el estado canónico después de reconectar; SignalR solo acelera avisos y puede llegar duplicado o fuera de orden.

## Entrega APK y tiendas

Antes de una APK compartida se deben fijar application ID, perfil Development, custodia de claves, versión, permisos, URL API y estrategia de actualización. Las claves de firma nunca se suben a Git. Un build Development no comparte URL, credenciales, storage ni firma con Production.

Play Store/App Store será una fase posterior con identificadores estables, políticas de privacidad, ficha, firma administrada, pruebas internas/cerradas y promoción controlada. La URL privada del tailnet no se usará como endpoint de una app pública de Production.
