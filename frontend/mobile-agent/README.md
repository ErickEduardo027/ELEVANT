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

El envío final de la operación, chat, evidencias y la sincronización
general permanecen deshabilitados hasta contar con contratos canónicos. La
aplicación no simula esas escrituras ni conserva la outbox prototípica.

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

Las evidencias reales están deshabilitadas hasta definir almacenamiento S3-compatible, tamaño/tipos, retención y autorización. SQL Server no almacenará binarios; una futura tabla conservará solo metadatos y object keys.

## Escrituras idempotentes y próxima sincronización offline

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
revocar la sesión; no incluye fotos ni otras evidencias binarias.

Una futura outbox general para nuevas escrituras offline deberá conservar:

- un identificador estable del dispositivo registrado;
- una clave de idempotencia estable por comando;
- tipo, payload/versionado y momento local;
- estado pendiente/sincronizando/confirmado/requiere intervención;
- intentos y último error sanitizado.

El servidor registra la combinación dispositivo + clave y devuelve el mismo resultado ante reintentos. REST recupera el estado canónico después de reconectar; SignalR solo acelera avisos y puede llegar duplicado o fuera de orden.

## Entrega APK y tiendas

Antes de una APK compartida se deben fijar application ID, perfil Development, custodia de claves, versión, permisos, URL API y estrategia de actualización. Las claves de firma nunca se suben a Git. Un build Development no comparte URL, credenciales, storage ni firma con Production.

Play Store/App Store será una fase posterior con identificadores estables, políticas de privacidad, ficha, firma administrada, pruebas internas/cerradas y promoción controlada. La URL privada del tailnet no se usará como endpoint de una app pública de Production.
